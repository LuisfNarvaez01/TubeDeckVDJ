/**
 * Lantify POS connector for song requests (the business runs the whole Lantify
 * ecosystem: guests scan the table QR, Lantify Cloud stores the request).
 *
 * Pairs with the owner's 8-character code, polls every 5 s while the request mode is
 * "lantify", backs off up to 60 s on network errors and never blocks the booth: status
 * updates that could not be sent wait in an outbox. The pairing token lives in
 * `app_settings` and is never sent to the renderer or logged. Matching, decisions and
 * the request list belong to `SongRequestsService`.
 */
import { z } from 'zod';
import type { LantifyConnection, LantifyStatus, NowPlayingInfo } from '../../shared/types';
import type { RequestConnector, RequestStatusUpdate, SettingsStore, SongRequestsService } from './SongRequestsService';

export const LANTIFY_BASE_URL = 'https://api.lantifypos.com';
export const LANTIFY_POLL_MS = 5_000;
export const LANTIFY_MAX_BACKOFF_MS = 60_000;

const SETTING_TOKEN = 'lantify.token';
const SETTING_BUSINESS = 'lantify.business';
const SETTING_CURSOR = 'lantify.cursor';

export interface LantifyHttpResponse {
  status: number;
  json(): Promise<unknown>;
}

export type LantifyHttp = (
  url: string,
  init: { method: 'GET' | 'POST' | 'PUT'; headers: Record<string, string>; body?: string }
) => Promise<LantifyHttpResponse>;

export interface LantifyRequestsDeps {
  http: LantifyHttp;
  settings: SettingsStore;
  hub: SongRequestsService;
  onChange?: () => void;
  baseUrl?: string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 5 s normally; after N consecutive failures 10, 20, 40, then 60 s at most. */
export function nextPollDelayMs(failures: number, baseMs = LANTIFY_POLL_MS, maxMs = LANTIFY_MAX_BACKOFF_MS): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 10));
}

/** Owner's 8-character code, typed with or without spaces / dashes. */
export function normalizePairCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

const PairResponseSchema = z.object({
  token: z.string().min(8).max(4096),
  business: z.object({ name: z.string().max(200), slug: z.string().max(200) })
});

const RequestItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  table: z.union([z.string(), z.number()]).transform((v) => String(v).trim().slice(0, 40)),
  guest: z.string().max(200).nullish().transform((v) => (v ?? '').trim().slice(0, 60)),
  query: z.string().max(500).transform((v) => v.trim()),
  createdAt: z.string().max(64)
});
const RequestsResponseSchema = z.object({
  items: z.array(z.unknown()).max(500),
  cursor: z.union([z.string(), z.number()]).nullish()
});

interface OutboxEntry {
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown>;
  /** Entries with the same key replace each other (only the latest now-playing matters). */
  coalesceKey?: string;
}

class UnauthorizedError extends Error {
  constructor() {
    super('Lantify revocó la vinculación');
  }
}

export class LantifyRequestsService implements RequestConnector {
  readonly origin = 'lantify' as const;
  private readonly http: LantifyHttp;
  private readonly settings: SettingsStore;
  private readonly hub: SongRequestsService;
  private readonly baseUrl: string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private token: string | null;
  private business: { name: string; slug: string } | null;
  private cursor: string | null;
  private outbox: OutboxEntry[] = [];
  private connection: LantifyConnection;
  private lastError: string | null = null;
  private failures = 0;
  private timer: unknown = null;
  private polling = false;
  private flushing = false;
  private started = false;

  constructor(private readonly deps: LantifyRequestsDeps) {
    this.http = deps.http;
    this.settings = deps.settings;
    this.hub = deps.hub;
    this.baseUrl = (deps.baseUrl ?? LANTIFY_BASE_URL).replace(/\/+$/, '');
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

    const storedToken = this.settings.getSetting<string | null>(SETTING_TOKEN, null);
    this.token = typeof storedToken === 'string' && storedToken ? storedToken : null;
    this.business = this.settings.getSetting<{ name: string; slug: string } | null>(SETTING_BUSINESS, null);
    this.cursor = this.settings.getSetting<string | null>(SETTING_CURSOR, null);
    this.connection = this.token ? 'ok' : this.business ? 'revoked' : 'unpaired';
    this.hub.registerConnector(this);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Polls while paired and the request mode is "lantify". Safe to call more than once. */
  start(): void {
    this.started = true;
    if (this.token && this.hub.getMode() === 'lantify') this.schedule(0);
  }

  stop(): void {
    this.started = false;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  getStatus(): LantifyStatus {
    return {
      paired: Boolean(this.token),
      business: this.business,
      connection: this.connection,
      lastError: this.lastError,
      pollDelayMs: nextPollDelayMs(this.failures)
    };
  }

  // ---------------------------------------------------------------- pairing

  async pair(rawCode: string): Promise<LantifyStatus> {
    const code = normalizePairCode(rawCode);
    if (!code) throw new Error('El código tiene 8 letras o números. Lo ves en Lantify → Mi página → Pedir canciones.');
    let res: LantifyHttpResponse;
    try {
      res = await this.http(`${this.baseUrl}/v1/proyecta/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code })
      });
    } catch {
      throw new Error('No hay conexión con Lantify. Revisa internet e intenta de nuevo.');
    }
    if (res.status >= 400 && res.status < 500) {
      throw new Error('Código no válido o vencido. Genera uno nuevo en Lantify → Mi página → Pedir canciones.');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Lantify no respondió bien (error ${res.status}). Intenta en un momento.`);
    }
    const parsed = PairResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Error('Lantify respondió algo inesperado al vincular.');

    this.token = parsed.data.token;
    this.business = parsed.data.business;
    this.cursor = null;
    this.outbox = [];
    this.failures = 0;
    this.lastError = null;
    this.connection = 'ok';
    this.settings.setSetting(SETTING_TOKEN, this.token);
    this.settings.setSetting(SETTING_BUSINESS, this.business);
    this.settings.setSetting(SETTING_CURSOR, null);
    this.hub.removeOrigin('lantify');
    this.hub.setMode('lantify'); // pairing means the business uses Lantify's table QR
    this.emit();
    if (this.started) this.schedule(0);
    return this.getStatus();
  }

  unpair(): LantifyStatus {
    this.clearPairing('unpaired');
    this.business = null;
    this.settings.setSetting(SETTING_BUSINESS, null);
    this.hub.removeOrigin('lantify');
    this.emit();
    return this.getStatus();
  }

  /** The request mode changed: poll only while it is "lantify". */
  handleModeChange(): void {
    if (this.hub.getMode() === 'lantify') {
      if (this.started && this.token) this.schedule(0);
    } else {
      this.cancelTimer();
    }
  }

  // ---------------------------------------------------------------- polling

  /** One poll cycle (exposed for tests): fetch new requests, match them, flush the outbox. */
  async pollOnce(): Promise<void> {
    if (!this.token || this.polling) return;
    this.polling = true;
    try {
      await this.flushOutbox();
      await this.fetchNewRequests();
      await this.flushOutbox();
      this.failures = 0;
      this.lastError = null;
      this.connection = 'ok';
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.handleUnauthorized();
      } else {
        this.failures += 1;
        this.connection = 'retrying';
        this.lastError = 'Sin conexión con Lantify: reintentando';
      }
    } finally {
      this.polling = false;
      this.emit();
      if (this.token && this.started && this.hub.getMode() === 'lantify') {
        this.schedule(nextPollDelayMs(this.failures));
      }
    }
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.pollOnce();
    }, ms);
  }

  private async fetchNewRequests(): Promise<void> {
    const qs = this.cursor ? `?since=${encodeURIComponent(this.cursor)}` : '';
    const res = await this.call('GET', `/v1/proyecta/requests${qs}`);
    const body = RequestsResponseSchema.safeParse(await res.json().catch(() => null));
    if (!body.success) throw new Error('Respuesta inesperada de Lantify');
    const items = [];
    for (const raw of body.data.items) {
      const item = RequestItemSchema.safeParse(raw);
      if (!item.success) continue;
      const { id, ...rest } = item.data;
      items.push({ externalId: id, ...rest });
    }
    if (body.data.cursor !== undefined && body.data.cursor !== null) {
      this.cursor = String(body.data.cursor);
      this.settings.setSetting(SETTING_CURSOR, this.cursor);
    }
    await this.hub.ingest('lantify', items); // resolves once matched (NO_MATCH lands in the outbox)
  }

  // ---------------------------------------------------------------- RequestConnector

  reportStatus(externalId: string, update: RequestStatusUpdate): void {
    if (!this.token) return;
    const body: Record<string, unknown> = { status: update.status };
    if (update.title !== undefined) body.title = update.title;
    if (update.artist !== undefined) body.artist = update.artist;
    if (update.videoId !== undefined) body.videoId = update.videoId;
    if (update.reason !== undefined) body.reason = update.reason;
    this.outbox.push({ method: 'POST', path: `/v1/proyecta/requests/${encodeURIComponent(externalId)}`, body });
    void this.flushOutboxSafely();
  }

  reportNowPlaying(np: NowPlayingInfo): void {
    if (!this.token) return;
    this.outbox = this.outbox.filter((e) => e.coalesceKey !== 'now-playing');
    this.outbox.push({
      method: 'PUT',
      path: '/v1/proyecta/now-playing',
      body: { title: np.title.slice(0, 300), artist: np.artist.slice(0, 200), videoId: np.videoId },
      coalesceKey: 'now-playing'
    });
    void this.flushOutboxSafely();
  }

  // ---------------------------------------------------------------- network

  private async call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: Record<string, unknown>
  ): Promise<LantifyHttpResponse> {
    if (!this.token) throw new UnauthorizedError();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json'
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      throw new Error(`Lantify ${res.status}`);
    }
    return res;
  }

  /** Sends queued status updates in order; stops at the first network error (kept for later). */
  private async flushOutbox(): Promise<void> {
    while (this.outbox.length > 0 && this.token) {
      const entry = this.outbox[0];
      await this.call(entry.method, entry.path, entry.body); // throws → entry stays queued
      this.outbox.shift(); // sent, or a 4xx that retrying will not fix
    }
  }

  private async flushOutboxSafely(): Promise<void> {
    if (this.flushing || this.polling) return;
    this.flushing = true;
    try {
      await this.flushOutbox();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.handleUnauthorized();
        this.emit();
      }
      // network: the next poll retries
    } finally {
      this.flushing = false;
    }
  }

  /** 401: the owner revoked Proyecta in Lantify. Forget the token, keep the name for the hint. */
  private handleUnauthorized(): void {
    this.clearPairing('revoked');
    this.lastError = 'Lantify desvinculó Proyecta. Vincula de nuevo con un código nuevo.';
  }

  private clearPairing(connection: LantifyConnection): void {
    this.cancelTimer();
    this.token = null;
    this.cursor = null;
    this.outbox = [];
    this.failures = 0;
    this.connection = connection;
    this.lastError = null;
    this.settings.setSetting(SETTING_TOKEN, null);
    this.settings.setSetting(SETTING_CURSOR, null);
  }

  private emit(): void {
    this.deps.onChange?.();
  }
}
