/**
 * Song requests from Lantify POS (guests scan the table QR, Lantify Cloud stores the
 * request, Proyecta pulls it, the DJ approves it and it plays).
 *
 * Runs in the main process. It polls every 5 s while paired, backs off up to 60 s when
 * the network fails, and never blocks the booth: every call is async, failures only
 * delay the next poll, and status updates that could not be sent wait in an outbox.
 * The pairing token lives in `app_settings` and is never sent to the renderer or logged.
 */
import { z } from 'zod';
import type {
  LantifyConnection,
  LantifyDecision,
  LantifyNowPlaying,
  LantifyPrefs,
  LantifySnapshot,
  LantifySongRequest,
  LantifyStatus,
  YouTubeTrack
} from '../../shared/types';
import { passesSongFilter } from './RecommendationEngine';
import type { TasteSnapshot } from './TasteFeedbackService';

export const LANTIFY_BASE_URL = 'https://api.lantifypos.com';
export const LANTIFY_POLL_MS = 5_000;
export const LANTIFY_MAX_BACKOFF_MS = 60_000;
/** Valid matches kept per request ("Otra versión" walks them). */
export const MAX_REQUEST_CANDIDATES = 5;
const MAX_KEPT_REQUESTS = 60;

const SETTING_TOKEN = 'lantify.token';
const SETTING_BUSINESS = 'lantify.business';
const SETTING_CURSOR = 'lantify.cursor';
const SETTING_PREFS = 'lantify.prefs';
const SETTING_REQUESTS = 'lantify.requests';

/** Settings keys the renderer must never read or write through `db:get/set-setting`. */
export function isPrivateLantifySetting(key: string): boolean {
  return key.startsWith('lantify.');
}

export const DEFAULT_LANTIFY_PREFS: LantifyPrefs = {
  autoApprove: false,
  maxPerHour: 12,
  maxPerTable: 3,
  overlayEnabled: true
};

export interface LantifyHttpResponse {
  status: number;
  json(): Promise<unknown>;
}

export type LantifyHttp = (
  url: string,
  init: { method: 'GET' | 'POST' | 'PUT'; headers: Record<string, string>; body?: string }
) => Promise<LantifyHttpResponse>;

export interface LantifySettingsStore {
  getSetting<T>(key: string, fallback: T): T;
  setSetting<T>(key: string, value: T): void;
}

export interface LantifyRequestsDeps {
  http: LantifyHttp;
  settings: LantifySettingsStore;
  /** YouTube search for what the guest typed (raw results; filtering happens here). */
  search: (query: string) => Promise<YouTubeTrack[]>;
  /** Dislikes and blocked channels from `TasteFeedbackService`. */
  getTasteSnapshot: () => Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>;
  onChange?: (snapshot: LantifySnapshot) => void;
  baseUrl?: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 5 s normally; after N consecutive failures 10, 20, 40, then 60 s at most. */
export function nextPollDelayMs(failures: number, baseMs = LANTIFY_POLL_MS, maxMs = LANTIFY_MAX_BACKOFF_MS): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 10));
}

/**
 * Picks the songs worth offering for a guest's request: YouTube's relevance order, kept
 * only when they pass the same filters as the radio (90–600 s, no reactions, tutorials,
 * shorts or long mixes, no dislikes, no blocked channels).
 */
export function pickRequestCandidates(
  results: YouTubeTrack[],
  snapshot: Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>,
  max = MAX_REQUEST_CANDIDATES
): YouTubeTrack[] {
  const seen = new Set<string>();
  const picked: YouTubeTrack[] = [];
  for (const t of results) {
    if (seen.has(t.videoId) || t.source === 'local') continue;
    seen.add(t.videoId);
    if (!passesSongFilter(t, snapshot)) continue;
    picked.push(t);
    if (picked.length >= max) break;
  }
  return picked;
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

const PrefsSchema = z.object({
  autoApprove: z.boolean(),
  maxPerHour: z.number().int().min(1).max(120),
  maxPerTable: z.number().int().min(1).max(30),
  overlayEnabled: z.boolean()
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

const TERMINAL: ReadonlySet<LantifySongRequest['state']> = new Set(['played', 'rejected']);

function primaryArtist(t: YouTubeTrack): string {
  return t.artists?.[0] ?? t.channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

export class LantifyRequestsService {
  private readonly http: LantifyHttp;
  private readonly settings: LantifySettingsStore;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private token: string | null;
  private business: { name: string; slug: string } | null;
  private cursor: string | null;
  private prefs: LantifyPrefs;
  private requests: LantifySongRequest[];
  private outbox: OutboxEntry[] = [];
  private connection: LantifyConnection;
  private lastError: string | null = null;
  private failures = 0;
  private timer: unknown = null;
  private polling = false;
  private stopped = true;

  constructor(private readonly deps: LantifyRequestsDeps) {
    this.http = deps.http;
    this.settings = deps.settings;
    this.baseUrl = (deps.baseUrl ?? LANTIFY_BASE_URL).replace(/\/+$/, '');
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

    const storedToken = this.settings.getSetting<string | null>(SETTING_TOKEN, null);
    this.token = typeof storedToken === 'string' && storedToken ? storedToken : null;
    this.business = this.settings.getSetting<{ name: string; slug: string } | null>(SETTING_BUSINESS, null);
    this.cursor = this.settings.getSetting<string | null>(SETTING_CURSOR, null);
    const storedPrefs = PrefsSchema.safeParse({
      ...DEFAULT_LANTIFY_PREFS,
      ...this.settings.getSetting<Partial<LantifyPrefs>>(SETTING_PREFS, {})
    });
    this.prefs = storedPrefs.success ? storedPrefs.data : { ...DEFAULT_LANTIFY_PREFS };
    const stored = this.settings.getSetting<LantifySongRequest[]>(SETTING_REQUESTS, []);
    this.requests = Array.isArray(stored) ? stored : [];
    this.connection = this.token ? 'ok' : this.business ? 'revoked' : 'unpaired';
  }

  // ---------------------------------------------------------------- lifecycle

  /** Starts polling if a pairing exists. Safe to call more than once. */
  start(): void {
    this.stopped = false;
    if (this.token) this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  getStatus(): LantifyStatus {
    return {
      paired: Boolean(this.token),
      business: this.business,
      connection: this.connection,
      lastError: this.lastError,
      pollDelayMs: nextPollDelayMs(this.failures),
      prefs: { ...this.prefs }
    };
  }

  getRequests(): LantifySongRequest[] {
    return this.requests.map((r) => ({ ...r, candidates: [...r.candidates] }));
  }

  getSnapshot(): LantifySnapshot {
    return { status: this.getStatus(), requests: this.getRequests() };
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
    this.requests = [];
    this.outbox = [];
    this.failures = 0;
    this.lastError = null;
    this.connection = 'ok';
    this.settings.setSetting(SETTING_TOKEN, this.token);
    this.settings.setSetting(SETTING_BUSINESS, this.business);
    this.settings.setSetting(SETTING_CURSOR, null);
    this.persistRequests();
    this.emit();
    if (!this.stopped) this.schedule(0);
    return this.getStatus();
  }

  unpair(): LantifyStatus {
    this.clearPairing('unpaired');
    this.business = null;
    this.settings.setSetting(SETTING_BUSINESS, null);
    this.requests = [];
    this.persistRequests();
    this.emit();
    return this.getStatus();
  }

  setPrefs(patch: Partial<LantifyPrefs>): LantifyStatus {
    this.prefs = PrefsSchema.parse({ ...this.prefs, ...patch });
    this.settings.setSetting(SETTING_PREFS, this.prefs);
    this.emit();
    return this.getStatus();
  }

  // ---------------------------------------------------------------- polling

  /** One poll cycle (exposed for tests): fetch new requests, match them, flush the outbox. */
  async pollOnce(): Promise<void> {
    if (!this.token || this.polling) return;
    this.polling = true;
    try {
      await this.flushOutbox();
      await this.fetchNewRequests();
      await this.matchPendingSearches();
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
      if (this.token && !this.stopped) this.schedule(nextPollDelayMs(this.failures));
    }
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clearTimer(this.timer);
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
    const known = new Set(this.requests.map((r) => r.id));
    for (const raw of body.data.items) {
      const item = RequestItemSchema.safeParse(raw);
      if (!item.success || known.has(item.data.id)) continue;
      known.add(item.data.id);
      this.requests.push({
        ...item.data,
        receivedAtMs: this.now(),
        state: 'searching',
        candidates: [],
        candidateIndex: 0
      });
    }
    if (body.data.cursor !== undefined && body.data.cursor !== null) {
      this.cursor = String(body.data.cursor);
      this.settings.setSetting(SETTING_CURSOR, this.cursor);
    }
    this.trimRequests();
    this.persistRequests();
    this.emit();
  }

  /** Searches YouTube for requests still waiting for a match; NO_MATCH when nothing fits. */
  private async matchPendingSearches(): Promise<void> {
    for (const req of this.requests.filter((r) => r.state === 'searching')) {
      if (!req.query) {
        this.reject(req, 'NO_MATCH');
        continue;
      }
      let results: YouTubeTrack[];
      try {
        results = await this.deps.search(req.query);
      } catch {
        continue; // YouTube or the network failed: try again on the next poll
      }
      const candidates = pickRequestCandidates(results, this.deps.getTasteSnapshot());
      if (candidates.length === 0) {
        this.reject(req, 'NO_MATCH');
      } else {
        req.candidates = candidates;
        req.candidateIndex = 0;
        req.state = 'pending';
      }
      this.persistRequests();
      this.emit();
    }
  }

  // ---------------------------------------------------------------- decisions

  async decide(id: string, decision: LantifyDecision): Promise<LantifySongRequest> {
    const req = this.requests.find((r) => r.id === id);
    if (!req) throw new Error('Ese pedido ya no existe');
    switch (decision.action) {
      case 'next-candidate': {
        if (req.state !== 'pending' || req.candidates.length === 0) break;
        req.candidateIndex = (req.candidateIndex + 1) % req.candidates.length;
        break;
      }
      case 'reject': {
        if (TERMINAL.has(req.state)) break;
        const reason = (decision.reason ?? '').trim().slice(0, 80) || 'DJ_DECLINED';
        this.reject(req, reason);
        break;
      }
      case 'queued': {
        if (req.state !== 'pending') throw new Error('Este pedido ya fue atendido');
        const track = req.candidates.find((c) => c.videoId === decision.videoId);
        if (!track) throw new Error('Esa versión no está entre las encontradas');
        req.state = 'queued';
        req.chosenVideoId = track.videoId;
        this.enqueueStatus(req.id, {
          status: 'QUEUED',
          title: track.title,
          artist: primaryArtist(track),
          videoId: track.videoId
        });
        break;
      }
      case 'playing': {
        if (req.state !== 'queued') break;
        req.state = 'playing';
        this.enqueueStatus(req.id, { status: 'PLAYING' });
        break;
      }
      case 'played': {
        if (req.state !== 'playing' && req.state !== 'queued') break;
        req.state = 'played';
        this.enqueueStatus(req.id, { status: 'PLAYED' });
        break;
      }
    }
    this.persistRequests();
    this.emit();
    void this.flushOutboxSafely();
    return { ...req, candidates: [...req.candidates] };
  }

  /** The song on air changed (any song, not only requests). */
  setNowPlaying(np: LantifyNowPlaying): void {
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

  private reject(req: LantifySongRequest, reason: string): void {
    req.state = 'rejected';
    req.rejectReason = reason;
    this.enqueueStatus(req.id, { status: 'REJECTED', reason });
  }

  private enqueueStatus(id: string, body: Record<string, unknown>): void {
    this.outbox.push({ method: 'POST', path: `/v1/proyecta/requests/${encodeURIComponent(id)}`, body });
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

  private flushing = false;
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
    const wasStopped = this.stopped;
    this.stop();
    this.stopped = wasStopped;
    this.token = null;
    this.cursor = null;
    this.outbox = [];
    this.failures = 0;
    this.connection = connection;
    this.lastError = null;
    this.settings.setSetting(SETTING_TOKEN, null);
    this.settings.setSetting(SETTING_CURSOR, null);
  }

  // ---------------------------------------------------------------- storage

  private trimRequests(): void {
    if (this.requests.length <= MAX_KEPT_REQUESTS) return;
    const active = this.requests.filter((r) => !TERMINAL.has(r.state));
    const done = this.requests.filter((r) => TERMINAL.has(r.state));
    this.requests = [...done.slice(-(MAX_KEPT_REQUESTS - active.length)), ...active].sort(
      (a, b) => a.receivedAtMs - b.receivedAtMs
    );
  }

  private persistRequests(): void {
    this.settings.setSetting(SETTING_REQUESTS, this.requests);
  }

  private emit(): void {
    this.deps.onChange?.(this.getSnapshot());
  }
}
