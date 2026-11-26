/**
 * "Solo red del local": Proyecta serves the guest page itself on the venue network, for
 * venues without internet or that prefer not to use the relay. Same page and same API as
 * the Lantify Música relay (`/api/info`, `/api/search`, `/api/requests`), handled by
 * `GuestGateway`, so the phone page is identical in both modes.
 *
 * Exposure is kept small: only the guest page and four JSON endpoints, every API call
 * needs the access key carried by the QR (rotating it invalidates printed codes), bodies
 * are capped at 2 KB, and each phone has a cooldown and a cap on open requests.
 */
import crypto from 'crypto';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import os from 'os';
import { z } from 'zod';
import type { LocalRequestSettings, LocalRequestStatus, NowPlayingInfo } from '../../shared/types';
import { clientKeyOf, type GuestGateway, type GuestReply } from './GuestGateway';
import { GUEST_CSS, GUEST_HTML, GUEST_JS } from './localRequestPage';
import { buildQrSheet, qrImages } from './requestQr';
import type { RequestConnector, RequestStatusUpdate, SettingsStore, SongRequestsService } from './SongRequestsService';

export const LOCAL_REQUEST_PORT = 8765;
const SETTING_LOCAL = 'requests.local';
const MAX_BODY_BYTES = 2048;

interface StoredLocalSettings extends LocalRequestSettings {
  accessKey: string;
  port: number;
}

export const LocalSettingsPatchSchema = z.object({ address: z.string().trim().max(64) }).partial();

type NetIfaces = ReturnType<typeof os.networkInterfaces>;

const VIRTUAL_IFACE = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|npcap)/i;

function isPrivateIPv4(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** LAN IPv4 addresses guests can reach, the likely WiFi/Ethernet one first. */
export function listLanAddresses(ifaces: NetIfaces = os.networkInterfaces()): string[] {
  const scored: Array<{ ip: string; score: number }> = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIPv4(a.address)) continue;
      let score = 0;
      if (VIRTUAL_IFACE.test(name)) score -= 10;
      if (/wi-?fi|wlan|inal[aá]mbrica|wireless/i.test(name)) score += 3;
      if (/ethernet|^eth|^en/i.test(name)) score += 2;
      if (a.address.startsWith('192.168.')) score += 1;
      scored.push({ ip: a.address, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.ip);
}

/** Security headers for the guest page (the relay sends the same CSP). */
export const GUEST_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://i.ytimg.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export interface LocalRequestServerDeps {
  hub: SongRequestsService;
  gateway: GuestGateway;
  settings: SettingsStore;
  onChange?: () => void;
  /** Bind address (all interfaces by default; tests use 127.0.0.1). */
  host?: string;
  /** First port to try; 0 = any free port (tests). */
  port?: number;
  getAddresses?: () => string[];
}

export class LocalRequestServer implements RequestConnector {
  readonly origin = 'local' as const;
  private server: http.Server | null = null;
  private boundPort: number | null = null;
  private error: string | null = null;
  private stored: StoredLocalSettings;
  private qrSvg: string | null = null;
  private qrPng: string | null = null;

  constructor(private readonly deps: LocalRequestServerDeps) {
    const raw = deps.settings.getSetting<Partial<StoredLocalSettings>>(SETTING_LOCAL, {});
    this.stored = {
      address: typeof raw.address === 'string' ? raw.address : '',
      accessKey: typeof raw.accessKey === 'string' && raw.accessKey.length >= 16 ? raw.accessKey : newKey(),
      port: typeof raw.port === 'number' ? raw.port : (deps.port ?? LOCAL_REQUEST_PORT)
    };
    this.save();
    deps.hub.registerConnector(this);
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<LocalRequestStatus> {
    if (this.server) return this.getStatus();
    this.error = null;
    const first = this.deps.port === 0 ? 0 : this.stored.port;
    const host = this.deps.host ?? '0.0.0.0';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const port = first === 0 ? 0 : first + attempt;
      const server = http.createServer((req, res) => void this.handle(req, res));
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, host, () => resolve());
        });
        this.server = server;
        const addr = server.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : port;
        break;
      } catch (err) {
        server.close();
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          this.error = 'No se pudo abrir el QR en esta red.';
          break;
        }
      }
    }
    if (!this.server && !this.error) this.error = 'Los puertos 8765–8774 están ocupados.';
    await this.refreshQr();
    this.emit();
    return this.getStatus();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    this.qrSvg = null;
    this.qrPng = null;
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.emit();
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  addresses(): string[] {
    return (this.deps.getAddresses ?? (() => listLanAddresses()))();
  }

  /** What the QR points to, optionally for one table. */
  guestUrl(table?: string): string | null {
    if (!this.boundPort) return null;
    const list = this.addresses();
    const ip = this.stored.address && list.includes(this.stored.address) ? this.stored.address : list[0];
    if (!ip) return null;
    const qs = new URLSearchParams({ k: this.stored.accessKey });
    if (table) qs.set('mesa', table);
    return `http://${ip}:${this.boundPort}/?${qs.toString()}`;
  }

  getStatus(): LocalRequestStatus {
    const url = this.guestUrl();
    return {
      running: this.isRunning(),
      url,
      addresses: this.addresses(),
      port: this.boundPort,
      qrSvgDataUrl: this.qrSvg,
      qrPngDataUrl: this.qrPng,
      error: this.isRunning() && !url ? 'Este computador no está conectado a una red WiFi o cableada.' : this.error,
      settings: { address: this.stored.address }
    };
  }

  async updateSettings(patch: z.infer<typeof LocalSettingsPatchSchema>): Promise<LocalRequestStatus> {
    this.stored = { ...this.stored, ...LocalSettingsPatchSchema.parse(patch) };
    this.save();
    await this.refreshQr();
    this.emit();
    return this.getStatus();
  }

  /** New access key: printed and shown QR codes stop working. */
  async rotateKey(): Promise<LocalRequestStatus> {
    this.stored.accessKey = newKey();
    this.save();
    await this.refreshQr();
    this.emit();
    return this.getStatus();
  }

  async buildTableSheet(tables: number): Promise<string> {
    if (!this.guestUrl()) throw new Error('Activa «Solo red del local» y conecta el computador a la red del local.');
    return buildQrSheet((t) => this.guestUrl(t)!, tables, this.deps.hub.getPageSettings(), true);
  }

  // ---------------------------------------------------------------- RequestConnector

  /** Guests read their request's state when they ask; nothing to push. */
  reportStatus(_externalId: string, _update: RequestStatusUpdate): void {}

  reportNowPlaying(_np: NowPlayingInfo): void {}

  // ---------------------------------------------------------------- HTTP

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const path = url.pathname;
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        return this.send(res, 200, GUEST_HTML, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && path === '/app.js') return this.send(res, 200, GUEST_JS, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && path === '/app.css') return this.send(res, 200, GUEST_CSS, 'text/css; charset=utf-8');
      if (!path.startsWith('/api/')) return this.reply(res, { status: 404, body: { error: 'No encontrado' } });

      const key = req.headers['x-proyecta-key'];
      if (typeof key !== 'string' || !safeEqual(key, this.stored.accessKey)) {
        return this.reply(res, {
          status: 403,
          body: { error: 'Este QR ya no es válido. Escanea el código que está en el local.' }
        });
      }
      if (this.deps.hub.getMode() !== 'local') {
        return this.reply(res, { status: 503, body: { error: 'Los pedidos están cerrados en este momento.' } });
      }
      const gateway = this.deps.gateway;
      const address = req.socket.remoteAddress ?? 'unknown';

      if (req.method === 'GET' && path === '/api/info') {
        return this.reply(res, { status: 200, body: { ...gateway.info(), online: true, theme: null } });
      }
      if (req.method === 'GET' && path === '/api/search') {
        return this.reply(res, await gateway.search(url.searchParams.get('q')));
      }
      if (req.method === 'POST' && path === '/api/requests') {
        const raw = await readBody(req, MAX_BODY_BYTES);
        if (raw === null) return this.reply(res, { status: 413, body: { error: 'Pedido demasiado largo' } });
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return this.reply(res, { status: 400, body: { error: 'Datos no válidos' } });
        }
        const client = (body as { client?: unknown })?.client;
        return this.reply(res, await gateway.request('local', body, clientKeyOf(address, client)));
      }
      const m = /^\/api\/requests\/([a-f0-9]{32})$/.exec(path);
      if (req.method === 'GET' && m) return this.reply(res, gateway.status('local', m[1]));
      return this.reply(res, { status: 404, body: { error: 'No encontrado' } });
    } catch {
      if (!res.headersSent) this.reply(res, { status: 500, body: { error: 'Algo falló. Intenta de nuevo.' } });
    }
  }

  private send(res: ServerResponse, status: number, body: string, type: string): void {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Security-Policy': GUEST_PAGE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  private reply(res: ServerResponse, r: GuestReply): void {
    this.send(res, r.status, JSON.stringify(r.body), 'application/json; charset=utf-8');
  }

  // ---------------------------------------------------------------- helpers

  private async refreshQr(): Promise<void> {
    const url = this.guestUrl();
    if (!url) {
      this.qrSvg = null;
      this.qrPng = null;
      return;
    }
    const images = await qrImages(url);
    this.qrSvg = images.svg;
    this.qrPng = images.png;
  }

  private save(): void {
    this.deps.settings.setSetting(SETTING_LOCAL, this.stored);
  }

  private emit(): void {
    this.deps.onChange?.();
  }
}

function newKey(): string {
  return crypto.randomBytes(12).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
