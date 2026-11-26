/**
 * Guests' song requests, whatever their source. Connectors bring requests in
 * (`CloudMusicConnector` through the Lantify Música relay, `LocalRequestServer` on the
 * venue WiFi) and get told about every status change. This hub owns the
 * request list, the YouTube matching, the DJ's decisions and the shared preferences,
 * so the booth works the same with or without Lantify POS.
 */
import { z } from 'zod';
import type {
  AutopilotRules,
  DeskState,
  GuestPageSettings,
  GuestRequestView,
  NowPlayingInfo,
  SongRequest,
  SongRequestDecision,
  SongRequestMode,
  SongRequestOrigin,
  SongRequestPrefs,
  YouTubeTrack
} from '../../shared/types';
import { passesSongFilter } from './RecommendationEngine';
import type { TasteSnapshot } from './TasteFeedbackService';

/** Valid matches kept per request ("Otra versión" walks them). */
export const MAX_REQUEST_CANDIDATES = 5;
const MAX_KEPT_REQUESTS = 80;
const SEARCH_RETRY_MS = 15_000;

const SETTING_MODE = 'requests.mode';
const SETTING_PREFS = 'requests.prefs';
const SETTING_ITEMS = 'requests.items';
const SETTING_PAGE = 'requests.page';
const SETTING_DESK = 'requests.desk';
const LEGACY_PREFS = 'lantify.prefs';
const LEGACY_LOCAL = 'requests.local';

export const DEFAULT_PAGE_SETTINGS: GuestPageSettings = { venueName: '', wifiName: '', qrOnScreen: true, logoDataUrl: '' };
/** PNG, JPEG or WebP as a data URL; about 400 KB of image at most. */
export const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_LOGO_DATA_URL = 560_000;

export const DEFAULT_AUTOPILOT: AutopilotRules = { enabled: false, maxPerHour: 12, maxPerTable: 3, skipOnLoadError: true };
export const AutopilotRulesSchema = z.object({
  enabled: z.boolean(),
  maxPerHour: z.number().int().min(1).max(60),
  maxPerTable: z.number().int().min(1).max(20),
  skipOnLoadError: z.boolean()
});

export const GuestPageSettingsSchema = z.object({
  venueName: z.string().trim().max(60),
  wifiName: z.string().trim().max(60),
  qrOnScreen: z.boolean(),
  logoDataUrl: z.union([z.literal(''), z.string().max(MAX_LOGO_DATA_URL).regex(LOGO_DATA_URL)])
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

/** Settings the renderer must never read or write through `db:get/set-setting`. */
export function isPrivateRequestSetting(key: string): boolean {
  return key.startsWith('lantify.') || key.startsWith('requests.');
}

export const DEFAULT_SONG_REQUEST_PREFS: SongRequestPrefs = {
  autoApprove: false,
  maxPerHour: 12,
  maxPerTable: 3,
  overlayEnabled: true,
  autoPlay: true
};

export const SongRequestPrefsSchema = z.object({
  autoApprove: z.boolean(),
  maxPerHour: z.number().int().min(1).max(120),
  maxPerTable: z.number().int().min(1).max(30),
  overlayEnabled: z.boolean(),
  autoPlay: z.boolean()
});

/** Autopilot rules from the relay, cleaned (anything odd falls back to the defaults). */
export function cleanAutopilot(raw: unknown): AutopilotRules {
  const parsed = AutopilotRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_AUTOPILOT };
}

export interface SettingsStore {
  getSetting<T>(key: string, fallback: T): T;
  setSetting<T>(key: string, value: T): void;
}

/** What a connector reports back for a request it brought in. */
export interface RequestStatusUpdate {
  status: 'QUEUED' | 'PLAYING' | 'PLAYED' | 'REJECTED';
  title?: string;
  artist?: string;
  videoId?: string;
  reason?: string;
}

export interface RequestConnector {
  readonly origin: SongRequestOrigin;
  reportStatus(externalId: string, update: RequestStatusUpdate): void;
  reportNowPlaying(np: NowPlayingInfo): void;
}

export interface IncomingSongRequest {
  externalId: string;
  table: string;
  guest: string;
  query: string;
  createdAt: string;
  /** The exact video the guest picked from the search (skips the YouTube search). */
  track?: YouTubeTrack;
}

export interface SongRequestsDeps {
  settings: SettingsStore;
  /** YouTube search for what the guest typed (raw results; filtering happens here). */
  search: (query: string) => Promise<YouTubeTrack[]>;
  /** Dislikes and blocked channels from `TasteFeedbackService`. */
  getTasteSnapshot: () => Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>;
  onChange?: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
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

/** Artist line sent to Lantify and shown to guests. */
export function primaryArtist(t: YouTubeTrack): string {
  return t.artists?.[0] ?? t.channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

const TERMINAL: ReadonlySet<SongRequest['state']> = new Set(['played', 'rejected']);

export class SongRequestsService {
  private readonly settings: SettingsStore;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly connectors = new Map<SongRequestOrigin, RequestConnector>();
  private requests: SongRequest[];
  private prefs: SongRequestPrefs;
  private mode: SongRequestMode;
  private page: GuestPageSettings;
  private nowPlaying: NowPlayingInfo | null = null;
  private matching: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private readonly modeListeners: Array<(mode: SongRequestMode) => void> = [];
  private readonly pageListeners: Array<(page: GuestPageSettings) => void> = [];
  private readonly changeListeners: Array<() => void> = [];
  private djPresent: boolean;
  private autopilot: AutopilotRules;

  constructor(private readonly deps: SongRequestsDeps) {
    this.settings = deps.settings;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

    const stored = SongRequestPrefsSchema.safeParse({
      ...DEFAULT_SONG_REQUEST_PREFS,
      ...this.settings.getSetting<Partial<SongRequestPrefs>>(LEGACY_PREFS, {}),
      ...this.settings.getSetting<Partial<SongRequestPrefs>>(SETTING_PREFS, {})
    });
    this.prefs = stored.success ? stored.data : { ...DEFAULT_SONG_REQUEST_PREFS };
    const items = this.settings.getSetting<SongRequest[]>(SETTING_ITEMS, []);
    this.requests = Array.isArray(items) ? items.filter((r) => r && typeof r.id === 'string' && r.origin) : [];
    const mode = this.settings.getSetting<string | null>(SETTING_MODE, null);
    // v3.3.0 called the internet mode "lantify" (it polled an API that never shipped).
    this.mode = mode === 'off' || mode === 'cloud' || mode === 'local' ? mode : mode === 'lantify' ? 'cloud' : 'off';
    const legacyLocal = this.settings.getSetting<Partial<GuestPageSettings>>(LEGACY_LOCAL, {});
    const page = GuestPageSettingsSchema.safeParse({
      ...DEFAULT_PAGE_SETTINGS,
      venueName: legacyLocal.venueName ?? '',
      wifiName: legacyLocal.wifiName ?? '',
      qrOnScreen: legacyLocal.qrOnScreen ?? true,
      ...this.settings.getSetting<Partial<GuestPageSettings>>(SETTING_PAGE, {})
    });
    this.page = page.success ? page.data : { ...DEFAULT_PAGE_SETTINGS };
    const desk = this.settings.getSetting<Partial<{ djPresent: boolean; autopilot: unknown }>>(SETTING_DESK, {});
    // A DJ is in the booth unless they said otherwise: the POS never gets surprise notifications.
    this.djPresent = desk.djPresent !== false;
    this.autopilot = cleanAutopilot(desk.autopilot);
    // Requests of the old polling connector cannot be answered any more.
    this.requests = this.requests.filter((r) => r.origin === 'cloud' || r.origin === 'local');
  }

  getPageSettings(): GuestPageSettings {
    return { ...this.page };
  }

  setPageSettings(patch: Partial<GuestPageSettings>): GuestPageSettings {
    this.page = GuestPageSettingsSchema.parse({ ...this.page, ...patch });
    this.settings.setSetting(SETTING_PAGE, this.page);
    for (const l of this.pageListeners) l(this.page);
    this.emit();
    return this.getPageSettings();
  }

  onPageChange(listener: (page: GuestPageSettings) => void): void {
    this.pageListeners.push(listener);
  }

  /** Any change (requests, booth, page). Connectors use it to keep the relay up to date. */
  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  // ---------------------------------------------------------------- the booth

  getDesk(): Omit<DeskState, 'posLinked'> {
    return { djPresent: this.djPresent, autopilot: { ...this.autopilot } };
  }

  setDjPresent(present: boolean): void {
    if (present === this.djPresent) return;
    this.djPresent = present;
    this.persistDesk();
    this.emit();
  }

  /** New rules from Lantify POS (through the relay). */
  setAutopilot(raw: unknown): AutopilotRules {
    this.autopilot = cleanAutopilot(raw);
    this.persistDesk();
    this.emit();
    return { ...this.autopilot };
  }

  /**
   * Lantify POS decided a request while no DJ was in the booth. A rejection happens here;
   * an approval is marked so the renderer queues it (the queue lives there).
   */
  async remoteDecide(origin: SongRequestOrigin, externalId: string, action: 'approve' | 'reject', by: string): Promise<boolean> {
    const req = this.requests.find((r) => r.origin === origin && r.externalId === externalId);
    if (!req || req.state !== 'pending' || this.djPresent) return false;
    if (action === 'reject') {
      await this.decide(req.id, { action: 'reject', reason: 'DJ_DECLINED' });
      return true;
    }
    req.approvedBy = by.slice(0, 40) || 'Caja';
    this.persist();
    this.emit();
    return true;
  }

  private persistDesk(): void {
    this.settings.setSetting(SETTING_DESK, { djPresent: this.djPresent, autopilot: this.autopilot });
  }

  /** What the guest's phone shows about one of its requests. */
  view(origin: SongRequestOrigin, externalId: string): GuestRequestView | null {
    const r = this.requests.find((x) => x.origin === origin && x.externalId === externalId);
    if (!r) return null;
    const chosen = r.chosenVideoId ? r.candidates.find((c) => c.videoId === r.chosenVideoId) : undefined;
    const shown = chosen ?? (r.candidates.length === 1 ? r.candidates[0] : undefined);
    const v: GuestRequestView = { id: externalId, state: r.state, query: r.query };
    if (shown) {
      v.title = shown.title;
      v.artist = primaryArtist(shown);
      v.thumbnailUrl = shown.thumbnailUrl;
    }
    if (r.state === 'rejected') v.reason = guestReasonText(r.rejectReason);
    return v;
  }

  // ---------------------------------------------------------------- connectors & mode

  registerConnector(connector: RequestConnector): void {
    this.connectors.set(connector.origin, connector);
  }

  getMode(): SongRequestMode {
    return this.mode;
  }

  setMode(mode: SongRequestMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.settings.setSetting(SETTING_MODE, mode);
    for (const l of this.modeListeners) l(mode);
    this.emit();
  }

  onModeChange(listener: (mode: SongRequestMode) => void): void {
    this.modeListeners.push(listener);
  }

  getPrefs(): SongRequestPrefs {
    return { ...this.prefs };
  }

  setPrefs(patch: Partial<SongRequestPrefs>): SongRequestPrefs {
    this.prefs = SongRequestPrefsSchema.parse({ ...this.prefs, ...patch });
    this.settings.setSetting(SETTING_PREFS, this.prefs);
    this.emit();
    return this.getPrefs();
  }

  // ---------------------------------------------------------------- requests

  getRequests(): SongRequest[] {
    return this.requests.map((r) => ({ ...r, candidates: [...r.candidates] }));
  }

  find(origin: SongRequestOrigin, externalId: string): SongRequest | null {
    const r = this.requests.find((x) => x.origin === origin && x.externalId === externalId);
    return r ? { ...r, candidates: [...r.candidates] } : null;
  }

  /** Requests of this origin that are still open (not played or rejected). */
  openCount(origin: SongRequestOrigin, predicate: (r: SongRequest) => boolean = () => true): number {
    return this.requests.filter((r) => r.origin === origin && !TERMINAL.has(r.state) && predicate(r)).length;
  }

  /** Adds new requests (duplicates by id are ignored) and resolves after they were matched. */
  async ingest(origin: SongRequestOrigin, items: IncomingSongRequest[]): Promise<void> {
    const known = new Set(this.requests.map((r) => r.id));
    let added = 0;
    for (const item of items) {
      const id = `${origin}:${item.externalId}`;
      if (known.has(id)) continue;
      known.add(id);
      added += 1;
      this.requests.push({
        id,
        origin,
        externalId: item.externalId,
        table: item.table,
        guest: item.guest,
        query: item.query || item.track?.title || '',
        createdAt: item.createdAt,
        receivedAtMs: this.now(),
        // A video picked on the phone needs no search: it goes straight to the DJ.
        state: item.track ? 'pending' : 'searching',
        candidates: item.track ? [item.track] : [],
        candidateIndex: 0
      });
    }
    if (added === 0) return;
    this.trim();
    this.persist();
    this.emit();
    await this.matchPending();
  }

  /** Drops every request of one origin (e.g. after unpairing Lantify). */
  removeOrigin(origin: SongRequestOrigin): void {
    const before = this.requests.length;
    this.requests = this.requests.filter((r) => r.origin !== origin);
    if (this.requests.length !== before) {
      this.persist();
      this.emit();
    }
  }

  /** Searches YouTube for requests still waiting for a match; NO_MATCH when nothing fits. */
  matchPending(): Promise<void> {
    if (!this.matching) {
      this.matching = this.runMatching().finally(() => {
        this.matching = null;
      });
    }
    return this.matching;
  }

  private async runMatching(): Promise<void> {
    let failed = false;
    for (const req of this.requests.filter((r) => r.state === 'searching')) {
      if (!req.query) {
        this.reject(req, 'NO_MATCH');
        continue;
      }
      let results: YouTubeTrack[];
      try {
        results = await this.deps.search(req.query);
      } catch {
        failed = true; // YouTube or the network failed: retried below
        continue;
      }
      if (req.state !== 'searching') continue; // the DJ rejected it meanwhile
      const candidates = pickRequestCandidates(results, this.deps.getTasteSnapshot());
      if (candidates.length === 0) {
        this.reject(req, 'NO_MATCH');
      } else {
        req.candidates = candidates;
        req.candidateIndex = 0;
        req.state = 'pending';
      }
      this.persist();
      this.emit();
    }
    if (failed && this.retryTimer === null) {
      this.retryTimer = this.setTimer(() => {
        this.retryTimer = null;
        void this.matchPending();
      }, SEARCH_RETRY_MS);
    }
  }

  async decide(id: string, decision: SongRequestDecision): Promise<SongRequest> {
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
        this.reject(req, (decision.reason ?? '').trim().slice(0, 80) || 'DJ_DECLINED');
        break;
      }
      case 'queued': {
        if (req.state !== 'pending') throw new Error('Este pedido ya fue atendido');
        const track = req.candidates.find((c) => c.videoId === decision.videoId);
        if (!track) throw new Error('Esa versión no está entre las encontradas');
        req.state = 'queued';
        req.chosenVideoId = track.videoId;
        this.report(req, { status: 'QUEUED', title: track.title, artist: primaryArtist(track), videoId: track.videoId });
        break;
      }
      case 'playing': {
        if (req.state !== 'queued') break;
        req.state = 'playing';
        this.report(req, { status: 'PLAYING' });
        break;
      }
      case 'played': {
        if (req.state !== 'playing' && req.state !== 'queued') break;
        req.state = 'played';
        this.report(req, { status: 'PLAYED' });
        break;
      }
    }
    this.persist();
    this.emit();
    return { ...req, candidates: [...req.candidates] };
  }

  /** The song on air changed (any song, not only requests). */
  setNowPlaying(np: NowPlayingInfo): void {
    this.nowPlaying = { ...np };
    const connector = this.mode === 'off' ? null : this.connectors.get(this.mode);
    connector?.reportNowPlaying(this.nowPlaying);
  }

  getNowPlaying(): NowPlayingInfo | null {
    return this.nowPlaying ? { ...this.nowPlaying } : null;
  }

  private reject(req: SongRequest, reason: string): void {
    req.state = 'rejected';
    req.rejectReason = reason;
    this.report(req, { status: 'REJECTED', reason });
  }

  private report(req: SongRequest, update: RequestStatusUpdate): void {
    this.connectors.get(req.origin)?.reportStatus(req.externalId, update);
  }

  // ---------------------------------------------------------------- storage

  private trim(): void {
    if (this.requests.length <= MAX_KEPT_REQUESTS) return;
    const active = this.requests.filter((r) => !TERMINAL.has(r.state));
    const done = this.requests.filter((r) => TERMINAL.has(r.state));
    this.requests = [...done.slice(-Math.max(0, MAX_KEPT_REQUESTS - active.length)), ...active].sort(
      (a, b) => a.receivedAtMs - b.receivedAtMs
    );
  }

  private persist(): void {
    this.settings.setSetting(SETTING_ITEMS, this.requests);
  }

  dispose(): void {
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private emit(): void {
    this.deps.onChange?.();
    for (const l of this.changeListeners) l();
  }
}
