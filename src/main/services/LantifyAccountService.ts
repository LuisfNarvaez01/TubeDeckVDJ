/**
 * Proyecta account = the business's Lantify account (v3.5). Proyecta is part of the Lantify
 * ecosystem: it opens with the same business code, username and password as Lantify POS,
 * or by itself when Lantify POS runs on this same computer (the POS hands over a Proyecta
 * licence for its signed-in user). A business that only pays for Proyecta has its own
 * "Proyecta" plan, created at lantifypos.com/registro?producto=proyecta.
 *
 * The licence is a JWS signed by Lantify Cloud with Ed25519. Proyecta only holds the PUBLIC
 * key: it can check a licence but never forge one. It works offline until the licence's
 * offline window (`olu`, 72 h after it was issued) and renews itself while online.
 *
 * Contract (cloud/api-worker in Lantify POS):
 *   POST {api}/v1/auth/login        { app:'proyecta', tenantCode, username, password, device }
 *   POST {api}/v1/license/refresh   Bearer licence
 *   POST {pos}/api/cloud/proyecta-handoff { device }  (Lantify POS on 127.0.0.1, this computer only)
 *
 * The licence and the device id live in `app_settings` (`lantify.*`, private to the main
 * process): the renderer only sees `AccountStatus`.
 */
import crypto from 'node:crypto';
import type { AccountStatus } from '../../shared/types';
import type { SettingsStore } from './SongRequestsService';

export const ACCOUNT_API_BASE = 'https://api.lantifypos.com';
/** Lantify POS's local server (desktop install). */
export const LOCAL_POS_URL = 'http://127.0.0.1:5000';
export const PROYECTA_SIGNUP_URL = 'https://lantifypos.com/registro?producto=proyecta';

/** Lantify Cloud licence public key (same one Lantify POS ships with). */
export const LICENSE_PUBLIC_JWK = { kty: 'OKP', crv: 'Ed25519', x: 'X60yvFMS69-CEZOo6OqymzopFDZDP7IS3gHPmX0LZpE' } as const;

const SETTING_LICENSE = 'lantify.account';
const SETTING_DEVICE = 'lantify.device';
/** Renew while online when the licence is older than this. */
const REFRESH_AFTER_MS = 6 * 3600_000;
const CHECK_EVERY_MS = 30 * 60_000;
/** A clock set back more than this (vs. the last time we saw it) does not get offline time. */
const CLOCK_TOLERANCE_MS = 10 * 60_000;

export interface LicenseClaims {
  iss: 'lantify-cloud';
  typ: 'license';
  sub: string;
  tid: string;
  tcode: string;
  tname: string;
  usr: string;
  name: string;
  role: string;
  plan: string;
  features: string[];
  subStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'SUSPENDED';
  periodEnd: string | null;
  graceUntil: string | null;
  iat: number;
  exp: number;
  olu: number;
  app?: 'proyecta';
}

export interface AccountHttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type AccountHttp = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body?: string; timeoutMs?: number }
) => Promise<AccountHttpResponse>;

export interface AccountDeps {
  settings: SettingsStore;
  http: AccountHttp;
  deviceName: string;
  apiBase?: string;
  localPosUrl?: string;
  /** Tests sign with their own key. */
  publicKey?: crypto.KeyObject;
  now?: () => number;
  onChange?: (status: AccountStatus) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface StoredLicense {
  token: string;
  /** Latest wall clock seen with this licence (detects a clock set back to stretch offline time). */
  lastSeenAt: number;
  viaPos: boolean;
}

/** Readable Spanish text for a cloud error code. */
export function accountErrorText(code: string | undefined, extra: Record<string, unknown> = {}): string {
  switch (code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'El código del negocio, el usuario o la contraseña no coinciden.';
    case 'CLOUD_LOCKED':
      return 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.';
    case 'CLOUD_USER_DISABLED':
      return 'Tu usuario está desactivado. Pídele al administrador del negocio que lo active.';
    case 'CLOUD_SUBSCRIPTION_SUSPENDED':
      return 'La suscripción del negocio está suspendida. Revisa el pago en lantifypos.com/cuenta.';
    case 'CLOUD_DEVICE_LIMIT':
      return `El plan permite ${typeof extra.maxDevices === 'number' ? extra.maxDevices : 'pocos'} computador(es) con Proyecta y ya están en uso.`;
    case 'CLOUD_DEVICE_REVOKED':
      return 'Este computador fue desvinculado del negocio.';
    case 'PLAN_FEATURE_REQUIRED':
      return 'El plan del negocio no incluye Proyecta.';
    case 'CLOUD_LICENSE_REVOKED':
    case 'CLOUD_LICENSE_INVALID':
    case 'CLOUD_LICENSE_EXPIRED':
      return 'La sesión venció. Vuelve a entrar.';
    case 'PROYECTA_NO_SESSION':
      return 'Abre Lantify POS en este computador e inicia sesión, o entra con tu usuario.';
    case 'CLOUD_UNREACHABLE':
      return 'Lantify POS no pudo conectarse a internet.';
    default:
      return 'No se pudo entrar. Revisa la conexión e intenta de nuevo.';
  }
}

const b64urlJson = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf-8'));

export class LantifyAccountService {
  private readonly publicKey: crypto.KeyObject;
  private readonly now: () => number;
  private readonly apiBase: string;
  private readonly localPosUrl: string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private stored: StoredLicense | null;
  private claims: LicenseClaims | null = null;
  private busy = false;
  private error: string | null = null;
  private timer: unknown = null;

  constructor(private readonly deps: AccountDeps) {
    this.publicKey = deps.publicKey ?? crypto.createPublicKey({ key: LICENSE_PUBLIC_JWK, format: 'jwk' });
    this.now = deps.now ?? Date.now;
    this.apiBase = (deps.apiBase ?? ACCOUNT_API_BASE).replace(/\/+$/, '');
    this.localPosUrl = (deps.localPosUrl ?? LOCAL_POS_URL).replace(/\/+$/, '');
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const raw = deps.settings.getSetting<Partial<StoredLicense> | null>(SETTING_LICENSE, null);
    this.stored = raw && typeof raw.token === 'string' ? { token: raw.token, lastSeenAt: Number(raw.lastSeenAt) || 0, viaPos: raw.viaPos === true } : null;
    this.claims = this.stored ? this.verify(this.stored.token) : null;
    if (this.stored && !this.claims) this.clear();
  }

  /** Signature and shape check. null = not a Lantify licence (or tampered with). */
  verify(token: string): LicenseClaims | null {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      if ((b64urlJson(parts[0]) as { alg?: string }).alg !== 'EdDSA') return null;
      const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), this.publicKey, Buffer.from(parts[2], 'base64url'));
      if (!ok) return null;
      const c = b64urlJson(parts[1]) as LicenseClaims;
      if (c.iss !== 'lantify-cloud' || c.typ !== 'license' || !c.sub || !c.tid || !Array.isArray(c.features)) return null;
      return c;
    } catch {
      return null;
    }
  }

  /** Stable id of this installation (not the person): the cloud counts Proyecta computers with it. */
  deviceFingerprint(): string {
    let id = this.deps.settings.getSetting<string | null>(SETTING_DEVICE, null);
    if (typeof id !== 'string' || !/^proyecta-[a-f0-9]{32}$/.test(id)) {
      id = `proyecta-${crypto.randomBytes(16).toString('hex')}`;
      this.deps.settings.setSetting(SETTING_DEVICE, id);
    }
    return id;
  }

  // ---------------------------------------------------------------- status

  /** Can Proyecta be used right now with the stored licence (online or within the offline window)? */
  private usable(now = this.now()): boolean {
    const c = this.claims;
    if (!c || !this.stored) return false;
    if (c.subStatus === 'SUSPENDED') return false;
    if (!c.features.includes('proyecta')) return false;
    if (now + CLOCK_TOLERANCE_MS < this.stored.lastSeenAt) return false;
    return now < c.olu * 1000 || now < c.exp * 1000;
  }

  getStatus(): AccountStatus {
    const c = this.claims;
    const signedIn = this.usable();
    return {
      state: signedIn ? 'signed-in' : this.busy ? 'checking' : 'signed-out',
      business: c && signedIn ? { code: c.tcode, name: c.tname } : null,
      user: c && signedIn ? { name: c.name, username: c.usr, role: c.role } : null,
      plan: c && signedIn ? c.plan : null,
      subscription: c && signedIn ? c.subStatus : null,
      offlineUntil: c && signedIn ? new Date(c.olu * 1000).toISOString() : null,
      viaPos: signedIn ? Boolean(this.stored?.viaPos) : false,
      error: this.error
    };
  }

  /** The licence token for Lantify APIs that accept Proyecta (e.g. linking Lantify Música). */
  licenseToken(): string | null {
    return this.usable() ? (this.stored?.token ?? null) : null;
  }

  // ---------------------------------------------------------------- sign in / out

  /** On start: renew the stored licence, or sign in through Lantify POS on this computer. */
  async start(): Promise<AccountStatus> {
    if (this.claims) {
      await this.refresh(false);
    } else {
      await this.signInWithLocalPos(true);
    }
    this.schedule();
    return this.getStatus();
  }

  async signIn(input: { tenantCode: string; username: string; password: string }): Promise<AccountStatus> {
    const tenantCode = input.tenantCode.trim().toUpperCase().slice(0, 40);
    const username = input.username.trim().toLowerCase().slice(0, 64);
    if (tenantCode.length < 3 || !username || !input.password) throw new Error('Escribe el código del negocio, tu usuario y tu contraseña.');
    return this.run(() =>
      this.post(`${this.apiBase}/v1/auth/login`, {
        app: 'proyecta',
        tenantCode,
        username,
        password: input.password.slice(0, 256),
        device: { fingerprint: this.deviceFingerprint(), name: this.deps.deviceName.slice(0, 80) }
      }),
      false
    );
  }

  /** Lantify POS on this computer hands over a licence for its signed-in user. */
  async signInWithLocalPos(quiet = false): Promise<AccountStatus> {
    try {
      return await this.run(
        () =>
          this.post(`${this.localPosUrl}/api/cloud/proyecta-handoff`, {
            device: { fingerprint: this.deviceFingerprint(), name: this.deps.deviceName.slice(0, 80) }
          }, undefined, 20_000),
        true
      );
    } catch (err) {
      if (quiet) {
        this.error = null; // no POS here: the sign-in screen simply shows up
        this.emit();
        return this.getStatus();
      }
      throw err;
    }
  }

  signOut(): AccountStatus {
    this.clear();
    this.error = null;
    this.emit();
    return this.getStatus();
  }

  /** Renews the licence. Offline keeps the current one; a revoked licence signs out. */
  async refresh(force = true): Promise<AccountStatus> {
    const stored = this.stored;
    if (!stored || !this.claims) return this.getStatus();
    if (!force && this.now() - this.claims.iat * 1000 < REFRESH_AFTER_MS) {
      this.touch();
      return this.getStatus();
    }
    let res: AccountHttpResponse;
    try {
      res = await this.deps.http(`${this.apiBase}/v1/license/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
        body: '{}'
      });
    } catch {
      this.touch(); // offline: the current licence keeps working inside its window
      return this.getStatus();
    }
    const body = (await res.json().catch(() => null)) as { license?: unknown; code?: string } | null;
    if (res.status === 200 && typeof body?.license === 'string') {
      const claims = this.verify(body.license);
      if (claims) this.adopt(body.license, claims, stored.viaPos);
      return this.getStatus();
    }
    if (res.status === 401 || res.status === 403 || res.status === 402) {
      this.clear();
      this.error = accountErrorText(body?.code);
      this.emit();
    }
    return this.getStatus();
  }

  // ---------------------------------------------------------------- internals

  private async run(call: () => Promise<AccountHttpResponse>, viaPos: boolean): Promise<AccountStatus> {
    if (this.busy) throw new Error('Ya estamos entrando. Espera un momento.');
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      let res: AccountHttpResponse;
      try {
        res = await call();
      } catch {
        throw new Error(viaPos ? 'No se encontró Lantify POS abierto en este computador.' : 'No hay conexión a internet. Revisa la red e intenta de nuevo.');
      }
      const body = (await res.json().catch(() => null)) as ({ license?: unknown; code?: string } & Record<string, unknown>) | null;
      if (res.status !== 200 || typeof body?.license !== 'string') {
        throw new Error(accountErrorText(body?.code, body ?? {}));
      }
      const claims = this.verify(body.license);
      if (!claims) throw new Error('Lantify respondió con una licencia no válida.');
      if (!claims.features.includes('proyecta')) throw new Error(accountErrorText('PLAN_FEATURE_REQUIRED'));
      this.adopt(body.license, claims, viaPos);
      this.schedule();
      return this.getStatus();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private post(url: string, body: unknown, bearer?: string, timeoutMs?: number): Promise<AccountHttpResponse> {
    return this.deps.http(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
      timeoutMs
    });
  }

  private adopt(token: string, claims: LicenseClaims, viaPos: boolean): void {
    this.claims = claims;
    this.stored = { token, lastSeenAt: Math.max(this.now(), this.stored?.lastSeenAt ?? 0), viaPos };
    this.deps.settings.setSetting(SETTING_LICENSE, this.stored);
    this.error = null;
    this.emit();
  }

  private touch(): void {
    if (!this.stored) return;
    const now = this.now();
    if (now > this.stored.lastSeenAt) {
      this.stored = { ...this.stored, lastSeenAt: now };
      this.deps.settings.setSetting(SETTING_LICENSE, this.stored);
    }
  }

  private clear(): void {
    this.stored = null;
    this.claims = null;
    this.deps.settings.setSetting(SETTING_LICENSE, null);
  }

  private schedule(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh(false).finally(() => this.schedule());
    }, CHECK_EVERY_MS);
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private emit(): void {
    this.deps.onChange?.(this.getStatus());
  }
}
