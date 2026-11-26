/**
 * Proyecta's own song-request QR, for venues without Lantify POS (the stand-alone
 * module). A small HTTP server on the venue's network serves a phone page; guests on the
 * same WiFi scan the QR, type a song and follow its status. Requests go into
 * `SongRequestsService` exactly like Lantify's, so the DJ approves them the same way.
 *
 * Exposure is kept small: only the guest page and four JSON endpoints, every API call
 * needs the access key carried by the QR (rotating it invalidates printed codes), bodies
 * are capped at 2 KB, and each phone has a cooldown and a cap on open requests.
 */
import crypto from 'crypto';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import os from 'os';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { LocalRequestSettings, LocalRequestStatus, NowPlayingInfo, SongRequest } from '../../shared/types';
import { GUEST_CSS, GUEST_HTML, GUEST_JS } from './localRequestPage';
import { primaryArtist, type RequestConnector, type RequestStatusUpdate, type SettingsStore, type SongRequestsService } from './SongRequestsService';

export const LOCAL_REQUEST_PORT = 8765;
const SETTING_LOCAL = 'requests.local';
const MAX_BODY_BYTES = 2048;
/** One request per phone every 30 s, at most 3 open at once, at most 60 open overall. */
export const CLIENT_COOLDOWN_MS = 30_000;
export const MAX_OPEN_PER_CLIENT = 3;
const MAX_OPEN_TOTAL = 60;

interface StoredLocalSettings extends LocalRequestSettings {
  accessKey: string;
  port: number;
}

const DEFAULT_SETTINGS: LocalRequestSettings = {
  venueName: '',
  wifiName: '',
  address: '',
  qrOnScreen: true
};

export const LocalSettingsPatchSchema = z
  .object({
    venueName: z.string().trim().max(60),
    wifiName: z.string().trim().max(60),
    address: z.string().trim().max(64),
    qrOnScreen: z.boolean()
  })
  .partial();

const GuestRequestSchema = z.object({
  table: z.string().trim().max(40).optional().default(''),
  guest: z.string().trim().max(60).optional().default(''),
  query: z.string().trim().min(2, 'Escribe el nombre de la canción').max(120)
});

/** Readable text for guests (never the internal code). */
export function guestReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'NO_MATCH':
      return 'No encontramos esa canción. Prueba con el artista y el título.';
    case 'ALREADY_PLAYED':
      return 'Esa canción ya sonó hace poco o ya está en la lista.';
    case 'DJ_DECLINED':
    case undefined:
    case '':
      return 'El DJ no pudo ponerla esta vez.';
    default:
      return reason;
  }
}

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

export interface GuestRequestView {
  id: string;
  state: SongRequest['state'];
  query: string;
  title?: string;
  artist?: string;
  reason?: string;
}

export interface LocalRequestServerDeps {
  hub: SongRequestsService;
  settings: SettingsStore;
  onChange?: () => void;
  /** Bind address (all interfaces by default; tests use 127.0.0.1). */
  host?: string;
  /** First port to try; 0 = any free port (tests). */
  port?: number;
  getAddresses?: () => string[];
  now?: () => number;
}

export class LocalRequestServer implements RequestConnector {
  readonly origin = 'local' as const;
  private server: http.Server | null = null;
  private boundPort: number | null = null;
  private error: string | null = null;
  private stored: StoredLocalSettings;
  private qrSvg: string | null = null;
  private qrPng: string | null = null;
  private readonly clients = new Map<string, { lastAtMs: number; ids: string[] }>();
  private readonly now: () => number;

  constructor(private readonly deps: LocalRequestServerDeps) {
    this.now = deps.now ?? Date.now;
    const raw = deps.settings.getSetting<Partial<StoredLocalSettings>>(SETTING_LOCAL, {});
    this.stored = {
      ...DEFAULT_SETTINGS,
      ...raw,
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
          this.error = 'No se pudo abrir el QR propio en esta red.';
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
    const { accessKey: _k, port: _p, ...settings } = this.stored;
    return {
      running: this.isRunning(),
      url,
      addresses: this.addresses(),
      port: this.boundPort,
      qrSvgDataUrl: this.qrSvg,
      qrPngDataUrl: this.qrPng,
      error: this.isRunning() && !url ? 'Este computador no está conectado a una red WiFi o cableada.' : this.error,
      settings
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

  /** Printable page with a general QR and one per table (1..tables). */
  async buildTableSheet(tables: number): Promise<string> {
    const general = this.guestUrl();
    if (!general) throw new Error('Activa el QR propio y conecta el computador a la red del local.');
    const count = Math.max(0, Math.min(100, Math.round(tables)));
    const cards: string[] = [await sheetCard(general, 'Pide tu canción', this.stored)];
    for (let i = 1; i <= count; i += 1) {
      cards.push(await sheetCard(this.guestUrl(String(i))!, `Mesa ${i}`, this.stored));
    }
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR para pedir canciones</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:12mm;font-family:Segoe UI,system-ui,sans-serif;color:#111;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
.card{border:1px solid #ccc;border-radius:4mm;padding:6mm;text-align:center;break-inside:avoid}
.card svg{width:100%;height:auto;max-width:55mm}
h2{margin:0 0 2mm;font-size:16pt}p{margin:1.5mm 0;font-size:10pt;color:#333}.venue{font-weight:600;color:#111}
.hint{font-size:11pt;margin-bottom:8mm}@media print{.hint{display:none}body{padding:8mm}}
</style></head><body>
<p class="hint">Imprime esta página (Ctrl + P). Cada QR funciona mientras Proyecta esté abierto con «QR propio» activo y el celular esté en la misma red WiFi.</p>
<div class="grid">${cards.join('')}</div></body></html>`;
  }

  // ---------------------------------------------------------------- RequestConnector

  /** Guests read their request's state from the hub; nothing to push. */
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
      if (!path.startsWith('/api/')) return this.json(res, 404, { error: 'No encontrado' });

      const key = req.headers['x-proyecta-key'];
      if (typeof key !== 'string' || !safeEqual(key, this.stored.accessKey)) {
        return this.json(res, 403, { error: 'Este QR ya no es válido. Escanea el código que está en el local.' });
      }
      if (this.deps.hub.getMode() !== 'local') {
        return this.json(res, 503, { error: 'Los pedidos están cerrados en este momento.' });
      }

      if (req.method === 'GET' && path === '/api/info') {
        const np = this.deps.hub.getNowPlaying();
        return this.json(res, 200, {
          venueName: this.stored.venueName,
          nowPlaying: np ? { title: np.title, artist: np.artist } : null
        });
      }
      if (req.method === 'POST' && path === '/api/requests') return await this.createRequest(req, res);
      const m = /^\/api\/requests\/([a-f0-9]{32})$/.exec(path);
      if (req.method === 'GET' && m) {
        const view = this.view(m[1]);
        return view ? this.json(res, 200, view) : this.json(res, 404, { error: 'Pedido no encontrado' });
      }
      return this.json(res, 404, { error: 'No encontrado' });
    } catch {
      if (!res.headersSent) this.json(res, 500, { error: 'Algo falló. Intenta de nuevo.' });
    }
  }

  private async createRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return this.json(res, 413, { error: 'Pedido demasiado largo' });
    let parsed: z.infer<typeof GuestRequestSchema>;
    try {
      parsed = GuestRequestSchema.parse(JSON.parse(raw));
    } catch (err) {
      const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? 'Datos no válidos') : 'Datos no válidos';
      return this.json(res, 400, { error: msg });
    }

    const clientId = req.socket.remoteAddress ?? 'unknown';
    const now = this.now();
    const client = this.clients.get(clientId) ?? { lastAtMs: -Infinity, ids: [] };
    client.ids = client.ids.filter((id) => {
      const r = this.deps.hub.find('local', id);
      return r !== null && r.state !== 'played' && r.state !== 'rejected';
    });
    if (now - client.lastAtMs < CLIENT_COOLDOWN_MS) {
      const wait = Math.ceil((CLIENT_COOLDOWN_MS - (now - client.lastAtMs)) / 1000);
      return this.json(res, 429, { error: `Espera ${wait} s antes de pedir otra canción.` });
    }
    if (client.ids.length >= MAX_OPEN_PER_CLIENT) {
      return this.json(res, 429, { error: 'Ya tienes 3 canciones pedidas. Espera a que suenen.' });
    }
    if (this.deps.hub.openCount('local') >= MAX_OPEN_TOTAL) {
      return this.json(res, 429, { error: 'Hay muchos pedidos en espera. Intenta en unos minutos.' });
    }

    const externalId = crypto.randomBytes(16).toString('hex');
    client.lastAtMs = now;
    client.ids.push(externalId);
    this.clients.set(clientId, client);
    // ingest() adds the request synchronously; the YouTube match continues in the background
    void this.deps.hub.ingest('local', [
      {
        externalId,
        table: parsed.table.slice(0, 40),
        guest: parsed.guest.slice(0, 60),
        query: parsed.query,
        createdAt: new Date(now).toISOString()
      }
    ]);
    return this.json(res, 201, this.view(externalId) ?? { id: externalId, state: 'searching', query: parsed.query });
  }

  private view(externalId: string): GuestRequestView | null {
    const r = this.deps.hub.find('local', externalId);
    if (!r) return null;
    const chosen = r.chosenVideoId ? r.candidates.find((c) => c.videoId === r.chosenVideoId) : undefined;
    return {
      id: externalId,
      state: r.state,
      query: r.query,
      title: chosen?.title,
      artist: chosen ? primaryArtist(chosen) : undefined,
      reason: r.state === 'rejected' ? guestReasonText(r.rejectReason) : undefined
    };
  }

  private send(res: ServerResponse, status: number, body: string, type: string): void {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    this.send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
  }

  // ---------------------------------------------------------------- helpers

  private async refreshQr(): Promise<void> {
    const url = this.guestUrl();
    if (!url) {
      this.qrSvg = null;
      this.qrPng = null;
      return;
    }
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    this.qrSvg = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    this.qrPng = await QRCode.toDataURL(url, { margin: 2, width: 360, errorCorrectionLevel: 'M' });
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function sheetCard(url: string, heading: string, s: LocalRequestSettings): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `<div class="card">${s.venueName ? `<p class="venue">${escapeHtml(s.venueName)}</p>` : ''}<h2>${escapeHtml(heading)}</h2>${svg}<p>Escanea y pide tu canción</p>${
    s.wifiName ? `<p>Conéctate al WiFi «${escapeHtml(s.wifiName)}»</p>` : ''
  }</div>`;
}
