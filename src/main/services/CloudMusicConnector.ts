/**
 * "Por internet": guests reach Proyecta from any network through the Lantify Música relay
 * (contract: docs/integraciones/lantify-musica.md). Proyecta keeps one outgoing WebSocket
 * with its venue's Durable Object on api.lantifypos.com — no open ports — and answers the
 * phones' searches and requests through `GuestGateway`. Works stand-alone (Proyecta
 * registers its own venue) or linked to a Lantify POS business (code from the POS; the
 * page then uses the business theme and the POS can chat with the DJ).
 *
 * The host secret lives in `app_settings` (`requests.cloud`, private to the main process)
 * and is never sent to the renderer or logged.
 *
 * Linked to a business, it also tells the POS about the booth (`desk`): with a DJ in the
 * booth, nothing; without one, the requests waiting for a decision (the POS approves or
 * rejects them, `decide`) and load errors (`alert`). The POS's autopilot rules come back
 * as `autopilot` and the hub applies them only while no DJ is in the booth.
 */
import { z } from 'zod';
import type { ChatMessage, CloudConnection, CloudRequestStatus, NowPlayingInfo, UpNextInfo } from '../../shared/types';
import type { GuestGateway } from './GuestGateway';
import { buildQrSheet, qrImages } from './requestQr';
import type { RequestConnector, RequestStatusUpdate, SettingsStore, SongRequestsService } from './SongRequestsService';

export const MUSIC_API_BASE = 'https://api.lantifypos.com';
export const MUSIC_PAGE_BASE = 'https://musica.lantifypos.com';
export const MUSIC_PROTOCOL = 1;
const SETTING_CLOUD = 'requests.cloud';
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_CHAT = 200;
const DESK_PENDING = 30;
export const MAX_CHAT_TEXT = 280;

export interface MusicHttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type MusicHttp = (
  url: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; headers: Record<string, string>; body?: string }
) => Promise<MusicHttpResponse>;

/** The bits of a WebSocket the connector uses (Node's global WebSocket, or a fake in tests). */
export interface HostSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface StoredCloud {
  venueId: string;
  hostSecret: string;
  business: { name: string; slug: string } | null;
}

export interface CloudMusicDeps {
  hub: SongRequestsService;
  gateway: GuestGateway;
  settings: SettingsStore;
  http: MusicHttp;
  openSocket: (url: string) => HostSocket;
  appVersion?: string;
  apiBase?: string;
  pageBase?: string;
  onChange?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const VenueSchema = z.object({
  venueId: z.string().regex(/^[a-z0-9]{8}$/),
  hostSecret: z.string().min(16).max(200),
  business: z.object({ name: z.string().max(200), slug: z.string().max(200) }).nullish()
});

const ChatSchema = z.object({
  id: z.string().max(80),
  from: z.enum(['dj', 'pos']),
  author: z.string().max(80),
  text: z.string().max(1000),
  at: z.string().max(40)
});

/** 1, 2, 4… up to 60 s between reconnection attempts. */
export function reconnectDelayMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, Math.min(failures, 6)));
}

/** Lantify POS link code, typed with or without spaces / dashes. */
export function normalizeLinkCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export class CloudMusicConnector implements RequestConnector {
  readonly origin = 'cloud' as const;
  private stored: StoredCloud | null;
  private socket: HostSocket | null = null;
  private connection: CloudConnection;
  private error: string | null = null;
  private failures = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private wanted = false;
  private chat: ChatMessage[] = [];
  private lastDesk = '';
  private qrSvg: string | null = null;
  private qrPng: string | null = null;
  private readonly apiBase: string;
  private readonly pageBase: string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: CloudMusicDeps) {
    this.apiBase = (deps.apiBase ?? MUSIC_API_BASE).replace(/\/+$/, '');
    this.pageBase = (deps.pageBase ?? MUSIC_PAGE_BASE).replace(/\/+$/, '');
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const raw = VenueSchema.safeParse(deps.settings.getSetting<unknown>(SETTING_CLOUD, null));
    this.stored = raw.success ? { ...raw.data, business: raw.data.business ?? null } : null;
    this.connection = this.stored ? 'offline' : 'unregistered';
    deps.hub.registerConnector(this);
    deps.hub.onPageChange(() => this.sendInfo());
    deps.hub.onChange(() => this.sendDesk());
  }

  /** Linked to Lantify POS and connected: the POS can see the booth and chat. */
  posLinked(): boolean {
    return Boolean(this.stored?.business) && this.connection === 'online';
  }

  // ---------------------------------------------------------------- status

  getStatus(): CloudRequestStatus {
    return {
      registered: Boolean(this.stored),
      venueId: this.stored?.venueId ?? null,
      business: this.stored?.business ?? null,
      connection: this.connection,
      url: this.guestUrl(),
      qrSvgDataUrl: this.qrSvg,
      qrPngDataUrl: this.qrPng,
      error: this.error
    };
  }

  getChat(): ChatMessage[] {
    return this.chat.map((m) => ({ ...m }));
  }

  guestUrl(table?: string): string | null {
    if (!this.stored) return null;
    return `${this.pageBase}/${this.stored.venueId}${table ? `?mesa=${encodeURIComponent(table)}` : ''}`;
  }

  async buildTableSheet(tables: number): Promise<string> {
    if (!this.stored) throw new Error('Primero activa los pedidos por internet.');
    return buildQrSheet((t) => this.guestUrl(t)!, tables, this.deps.hub.getPageSettings(), false);
  }

  // ---------------------------------------------------------------- registration

  /** Stand-alone module: Proyecta creates its own venue on the relay. */
  async register(): Promise<CloudRequestStatus> {
    const name = this.deps.hub.getPageSettings().venueName || 'Proyecta';
    const res = await this.post('/v1/music/venues', { name });
    if (res.status === 429) throw new Error('Demasiados intentos desde esta conexión. Espera una hora.');
    await this.adopt(res, 'No se pudo activar los pedidos por internet.');
    return this.getStatus();
  }

  /** Linked to a Lantify POS business with the code shown in Lantify → Proyecta. */
  async link(rawCode: string): Promise<CloudRequestStatus> {
    const code = normalizeLinkCode(rawCode);
    if (!code) throw new Error('El código tiene 8 letras o números. Lo ves en Lantify → Proyecta · música.');
    const res = await this.post('/v1/music/link', { code });
    if (res.status === 404 || res.status === 400) {
      throw new Error('Código no válido o vencido. Genera uno nuevo en Lantify → Proyecta · música.');
    }
    if (res.status === 429) throw new Error('Demasiados intentos. Espera 15 minutos.');
    await this.adopt(res, 'No se pudo vincular con Lantify POS.');
    return this.getStatus();
  }

  /** Linked with the Lantify account Proyecta is signed in with: no code needed (v3.5). */
  async linkWithAccount(licenseToken: string | null): Promise<CloudRequestStatus> {
    if (!licenseToken) throw new Error('Entra con tu cuenta de Lantify para vincular sin código.');
    let res: MusicHttpResponse;
    try {
      res = await this.deps.http(`${this.apiBase}/v1/music/link-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${licenseToken}` },
        body: '{}'
      });
    } catch {
      throw new Error('No hay conexión a internet. Revisa la red e intenta de nuevo.');
    }
    await this.adopt(res, 'No se pudo vincular con Lantify POS.');
    return this.getStatus();
  }

  /** Stops using the venue (the relay forgets it; printed QR codes stop working). */
  async unregister(): Promise<CloudRequestStatus> {
    const stored = this.stored;
    this.disconnect();
    this.stored = null;
    this.deps.settings.setSetting(SETTING_CLOUD, null);
    this.connection = 'unregistered';
    this.chat = [];
    this.qrSvg = null;
    this.qrPng = null;
    this.error = null;
    this.emit();
    if (stored) {
      try {
        await this.deps.http(`${this.apiBase}/v1/music/venues/${stored.venueId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${stored.hostSecret}` }
        });
      } catch {
        // offline: the venue simply stays unused on the relay
      }
    }
    return this.getStatus();
  }

  private async post(path: string, body: Record<string, unknown>): Promise<MusicHttpResponse> {
    try {
      return await this.deps.http(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error('No hay conexión a internet. Revisa la red e intenta de nuevo.');
    }
  }

  private async adopt(res: MusicHttpResponse, fallback: string): Promise<void> {
    if (res.status < 200 || res.status >= 300) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(typeof body?.error === 'string' ? body.error : fallback);
    }
    const parsed = VenueSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Error(fallback);
    this.disconnect();
    this.stored = { ...parsed.data, business: parsed.data.business ?? null };
    this.deps.settings.setSetting(SETTING_CLOUD, this.stored);
    this.chat = [];
    this.error = null;
    this.connection = 'offline';
    await this.refreshQr();
    this.emit();
    if (this.wanted) this.connect();
  }

  // ---------------------------------------------------------------- connection

  /** Keep connected while the request mode is "cloud". */
  setActive(active: boolean): void {
    this.wanted = active;
    if (active) {
      void this.refreshQr().then(() => this.emit());
      this.connect();
    } else {
      this.disconnect();
      this.emit();
    }
  }

  private connect(): void {
    if (!this.stored || this.socket || !this.wanted) return;
    this.cancelRetry();
    const venueId = this.stored.venueId;
    const url = `${this.apiBase.replace(/^http/, 'ws')}/v1/music/${venueId}/host`;
    this.connection = 'connecting';
    this.emit();
    let socket: HostSocket;
    try {
      socket = this.deps.openSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.sendRaw({ t: 'auth', secret: this.stored?.hostSecret ?? '', v: MUSIC_PROTOCOL, app: `proyecta/${this.deps.appVersion ?? 'dev'}` });
    };
    socket.onmessage = (ev) => void this.onFrame(ev.data);
    socket.onerror = () => undefined; // onclose follows
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (ev.code === 4003) {
        // secret rotated elsewhere or venue deleted: needs a new link / registration
        this.stored = null;
        this.deps.settings.setSetting(SETTING_CLOUD, null);
        this.connection = 'revoked';
        this.error = 'Lantify desconectó este Proyecta. Vuelve a activarlo o a vincularlo.';
        this.qrSvg = null;
        this.qrPng = null;
        this.emit();
        return;
      }
      if (ev.code === 4001) {
        this.connection = 'offline';
        this.error = 'Otro computador con este mismo Proyecta tomó los pedidos.';
        this.emit();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private disconnect(): void {
    this.cancelRetry();
    this.stopPing();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.close(1000, 'bye');
      } catch {
        // already closed
      }
    }
    if (this.stored && this.connection !== 'revoked') this.connection = 'offline';
  }

  private scheduleReconnect(): void {
    this.failures += 1;
    this.connection = 'offline';
    this.emit();
    if (!this.wanted || !this.stored) return;
    this.cancelRetry();
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.connect();
    }, reconnectDelayMs(this.failures));
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private startPing(): void {
    this.stopPing();
    const tick = (): void => {
      this.sendRaw({ t: 'ping' });
      this.pingTimer = this.setTimer(tick, PING_MS);
    };
    this.pingTimer = this.setTimer(tick, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.pingTimer = null;
  }

  private sendRaw(frame: Record<string, unknown>): void {
    const s = this.socket;
    if (!s || s.readyState !== 1) return;
    try {
      s.send(JSON.stringify(frame));
    } catch {
      // the close handler reconnects
    }
  }

  private async onFrame(data: unknown): Promise<void> {
    if (typeof data !== 'string' || data.length > 900_000) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (frame.t) {
      case 'ready': {
        this.failures = 0;
        this.connection = 'online';
        this.error = null;
        const list = Array.isArray(frame.chat) ? frame.chat : [];
        this.chat = list.flatMap((m) => {
          const p = ChatSchema.safeParse(m);
          return p.success ? [p.data] : [];
        });
        this.startPing();
        this.sendInfo();
        this.pushOpenViews();
        if (frame.autopilot) this.deps.hub.setAutopilot(frame.autopilot);
        this.lastDesk = '';
        this.sendDesk();
        this.emit();
        return;
      }
      case 'autopilot':
        this.deps.hub.setAutopilot(frame.rules);
        return;
      case 'decide': {
        const id = typeof frame.id === 'string' ? frame.id.slice(0, 64) : '';
        const action = frame.action === 'approve' || frame.action === 'reject' ? frame.action : null;
        if (!id || !action) return;
        const by = typeof frame.by === 'string' ? frame.by.replace(/\s+/g, ' ').trim().slice(0, 40) : 'Caja';
        await this.deps.hub.remoteDecide('cloud', id, action, by);
        return;
      }
      case 'req':
        return this.onGuestRequest(frame);
      case 'chat': {
        const p = ChatSchema.safeParse(frame.msg);
        if (!p.success || this.chat.some((m) => m.id === p.data.id)) return;
        this.chat = [...this.chat, p.data].slice(-MAX_CHAT);
        this.emit();
        return;
      }
      default:
        return;
    }
  }

  private async onGuestRequest(frame: Record<string, unknown>): Promise<void> {
    const rid = typeof frame.rid === 'string' ? frame.rid.slice(0, 80) : null;
    if (!rid) return;
    const gateway = this.deps.gateway;
    const reply =
      frame.op === 'search'
        ? await gateway.search(frame.q)
        : frame.op === 'request'
          ? await gateway.request('cloud', frame.body, typeof frame.clientKey === 'string' ? frame.clientKey : 'unknown')
          : { status: 400, body: { error: 'Operación desconocida' } };
    this.sendRaw({ t: 'res', rid, status: reply.status, body: reply.body });
  }

  /** Venue name, song on air and the next one for the page (on connect, song, queue and name changes). */
  private sendInfo(): void {
    const info = this.deps.gateway.info();
    this.sendRaw({ t: 'info', info });
  }

  /** After a reconnection, the relay's cache gets the latest state of open requests. */
  private pushOpenViews(): void {
    for (const r of this.deps.hub.getRequests()) {
      if (r.origin !== 'cloud') continue;
      const view = this.deps.hub.view('cloud', r.externalId);
      if (view) this.sendRaw({ t: 'view', view });
    }
  }

  // ---------------------------------------------------------------- the booth

  /** What the POS sees of the booth; sent only when it changes and only when linked. */
  private sendDesk(): void {
    if (!this.stored?.business || this.connection !== 'online') return;
    const desk = this.deps.hub.getDesk();
    const pending = desk.djPresent
      ? []
      : this.deps.hub
          .getRequests()
          .filter((r) => r.origin === 'cloud' && r.state === 'pending' && !r.approvedBy)
          .slice(-DESK_PENDING)
          .map((r) => {
            const t = r.candidates[r.candidateIndex] ?? r.candidates[0];
            return {
              id: r.externalId,
              title: t?.title ?? r.query,
              artist: t ? (t.artists?.[0] ?? t.channel) : undefined,
              table: r.table || undefined,
              guest: r.guest || undefined,
              thumbnailUrl: t?.thumbnailUrl,
              at: r.createdAt
            };
          });
    const payload = JSON.stringify({ djPresent: desk.djPresent, pending });
    if (payload === this.lastDesk) return;
    this.lastDesk = payload;
    this.sendRaw({ t: 'desk', desk: { djPresent: desk.djPresent, pending } });
  }

  /** A song failed to load or was skipped: the POS hears about it only when no DJ is in the booth. */
  sendAlert(kind: 'load_failed' | 'skipped' | 'info', rawText: string): void {
    if (this.deps.hub.getDesk().djPresent || !this.posLinked()) return;
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (text) this.sendRaw({ t: 'alert', alert: { kind, text } });
  }

  // ---------------------------------------------------------------- chat

  sendChat(rawText: string): ChatMessage[] {
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_TEXT);
    if (!text) throw new Error('Escribe un mensaje');
    if (!this.stored?.business) throw new Error('El chat funciona cuando Proyecta está vinculado a Lantify POS.');
    if (this.connection !== 'online') throw new Error('Sin conexión con Lantify: el mensaje no se envió.');
    this.sendRaw({ t: 'chat', text });
    // The relay does not echo the DJ's own messages; the next "ready" brings the stored copy.
    const venueName = this.deps.hub.getPageSettings().venueName;
    this.chat = [
      ...this.chat,
      { id: `dj-${Date.now()}-${this.chat.length}`, from: 'dj' as const, author: venueName || 'DJ', text, at: new Date().toISOString() }
    ].slice(-MAX_CHAT);
    this.emit();
    return this.getChat();
  }

  // ---------------------------------------------------------------- RequestConnector

  reportStatus(externalId: string, _update: RequestStatusUpdate): void {
    // The hub already holds the new state; the relay caches what the phone will read.
    const view = this.deps.hub.view('cloud', externalId);
    if (view) this.sendRaw({ t: 'view', view });
  }

  reportNowPlaying(_np: NowPlayingInfo): void {
    this.sendInfo();
  }

  reportUpNext(_next: UpNextInfo | null): void {
    this.sendInfo();
  }

  private async refreshQr(): Promise<void> {
    const url = this.guestUrl();
    if (!url) {
      this.qrSvg = null;
      this.qrPng = null;
      return;
    }
    if (this.qrSvg) return; // the venue URL never changes
    const images = await qrImages(url);
    this.qrSvg = images.svg;
    this.qrPng = images.png;
  }

  dispose(): void {
    this.wanted = false;
    this.disconnect();
  }

  private emit(): void {
    this.deps.onChange?.();
  }
}
