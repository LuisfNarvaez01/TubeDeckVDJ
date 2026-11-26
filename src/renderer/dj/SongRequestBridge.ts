/**
 * Renderer side of guest song requests (Lantify POS or Proyecta's own QR): turns an approved request into a queue item,
 * applies "Aprobar automáticamente" with its limits, and reports PLAYING / PLAYED and
 * now-playing as the song on air changes. The DJ always decides: nothing here removes
 * or reorders what is already in the queue, it only adds approved requests at the end.
 *
 * Who approves on their own: with a DJ in the booth, "Aprobar automáticamente" with the
 * DJ's limits; without a DJ, the autopilot set from Lantify POS (its own limits). Requests
 * approved from the POS while no DJ is in the booth (`approvedBy`) are queued right away.
 */
import type {
  AutopilotRules,
  DeskState,
  SongRequestDecision,
  NowPlayingInfo,
  SongRequestPrefs,
  SongRequestsSnapshot,
  SongRequest,
  Result,
  UpNextInfo,
  YouTubeTrack
} from '../../shared/types';
import type { QueueItem, QueueRequestInfo, QueueSource } from './QueueAndAutomixEngine';
import { isYouTubeVideoId } from './QueueAndAutomixEngine';

export interface SongRequestBridgeApi {
  decide: (id: string, decision: SongRequestDecision) => Promise<Result<SongRequest>>;
  nowPlaying: (np: NowPlayingInfo) => Promise<unknown>;
  /** The next song in the queue (contract `upNext`); optional for older test fakes. */
  upNext?: (next: UpNextInfo | null) => Promise<unknown>;
}

export interface SongRequestBridgeQueue {
  enqueue: (track: YouTubeTrack, source: QueueSource, request: QueueRequestInfo) => QueueItem;
  requestConflict: (track: YouTubeTrack, nowMs?: number) => 'queued' | 'played' | null;
}

export type ApproveOutcome = 'queued' | 'already-played' | 'already-queued' | 'no-candidate' | 'error';

/** A song must stay the loudest on air this long before it counts as "now playing". */
export const ON_AIR_SETTLE_MS = 1500;
const HOUR_MS = 60 * 60 * 1000;

export function currentCandidate(req: SongRequest): YouTubeTrack | null {
  return req.candidates[req.candidateIndex] ?? req.candidates[0] ?? null;
}

export function trackArtist(track: YouTubeTrack): string {
  return track.artists?.[0] ?? track.channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

/**
 * The song that follows the one on air: a song the DJ loaded by hand on the idle deck
 * (Automix mixes into it), otherwise the first queue item that is not on air and did not
 * fail. Null when nothing is lined up.
 */
export function pickUpNext(
  queue: ReadonlyArray<Pick<QueueItem, 'track' | 'status'>>,
  onAirVideoId: string | null,
  manualIdleTrack: YouTubeTrack | null = null
): UpNextInfo | null {
  if (manualIdleTrack && manualIdleTrack.videoId !== onAirVideoId) {
    return { title: manualIdleTrack.title, artist: trackArtist(manualIdleTrack) };
  }
  const item = queue.find((q) => q.status !== 'failed' && q.track.videoId !== onAirVideoId);
  return item ? { title: item.track.title, artist: trackArtist(item.track) } : null;
}

interface TrackedRequest extends QueueRequestInfo {
  state: 'queued' | 'playing';
}

export class SongRequestBridge {
  /** A request source is active (Lantify or the local QR): now-playing is worth sending. */
  private active = false;
  private prefs: SongRequestPrefs | null = null;
  private desk: DeskState | null = null;
  private approvals: Array<{ table: string; atMs: number }> = [];
  private byVideoId = new Map<string, TrackedRequest>();
  private autoHandled = new Set<string>();
  private onAirId: string | null = null;
  /** Last `upNext` sent (title + artist); null = nothing sent yet since requests turned on. */
  private sentUpNextKey: string | null = null;
  private pendingOnAir: { id: string; sinceMs: number; track: YouTubeTrack } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      api: SongRequestBridgeApi;
      queue: SongRequestBridgeQueue;
      onQueueChanged: () => void;
      now?: () => number;
    }
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** New snapshot from the main process: remember the tracked songs, run auto-approve. */
  async sync(snapshot: SongRequestsSnapshot): Promise<void> {
    this.active = snapshot.mode !== 'off';
    if (!this.active) this.sentUpNextKey = null; // resend when requests turn back on
    this.prefs = snapshot.prefs;
    this.desk = snapshot.desk ?? null;
    for (const req of snapshot.requests) {
      if ((req.state === 'queued' || req.state === 'playing') && req.chosenVideoId && !this.byVideoId.has(req.chosenVideoId)) {
        this.byVideoId.set(req.chosenVideoId, {
          requestId: req.id,
          table: req.table,
          guest: req.guest,
          state: req.state
        });
      }
    }
    if (!this.active) return;
    // Approved from Lantify POS (no DJ in the booth): no limits, the POS already decided.
    for (const req of snapshot.requests) {
      if (req.state !== 'pending' || !req.approvedBy || this.autoHandled.has(req.id)) continue;
      this.autoHandled.add(req.id);
      await this.approve(req);
    }
    if (!this.autoRules()) return;
    for (const req of snapshot.requests) {
      if (req.state !== 'pending' || this.autoHandled.has(req.id)) continue;
      if (this.overLimit(this.whoKey(req))) continue; // waits for the DJ / the POS; retried on the next snapshot
      this.autoHandled.add(req.id);
      await this.approve(req);
    }
  }

  /** Limits of whoever approves on their own right now; null = a person decides. */
  autoRules(): Pick<AutopilotRules, 'maxPerHour' | 'maxPerTable'> | null {
    if (!this.prefs) return null;
    if (!this.desk || this.desk.djPresent) return this.prefs.autoApprove ? this.prefs : null;
    return this.desk.autopilot.enabled ? this.desk.autopilot : null;
  }

  /** Per-table limit: the table, or the guest's name when the table is unknown. */
  private whoKey(req: SongRequest): string {
    return req.table || (req.guest ? `@${req.guest.toLowerCase()}` : '');
  }

  /** Approved requests in the last hour: all tables and this table. */
  countsFor(table: string): { hour: number; table: number } {
    const since = this.now() - HOUR_MS;
    this.approvals = this.approvals.filter((a) => a.atMs >= since);
    return { hour: this.approvals.length, table: this.approvals.filter((a) => a.table === table).length };
  }

  /** True when auto-approve must leave this table's request to the DJ (or the POS). */
  overLimit(table: string): boolean {
    const rules = this.autoRules() ?? this.prefs;
    if (!rules) return false;
    const counts = this.countsFor(table);
    return counts.hour >= rules.maxPerHour || counts.table >= rules.maxPerTable;
  }

  /** Queues the request's current candidate, or rejects it with ALREADY_PLAYED if it would repeat. */
  async approve(req: SongRequest): Promise<ApproveOutcome> {
    const track = currentCandidate(req);
    if (!track) return 'no-candidate';
    const conflict = this.deps.queue.requestConflict(track, this.now());
    if (conflict) {
      await this.deps.api.decide(req.id, { action: 'reject', reason: 'ALREADY_PLAYED' });
      return conflict === 'queued' ? 'already-queued' : 'already-played';
    }
    const res = await this.deps.api.decide(req.id, { action: 'queued', videoId: track.videoId });
    if (!res.success) return 'error';
    const info: QueueRequestInfo = { requestId: req.id, table: req.table, guest: req.guest };
    this.deps.queue.enqueue({ ...track, recommendReason: undefined }, 'request', info);
    this.byVideoId.set(track.videoId, { ...info, state: 'queued' });
    this.approvals.push({ table: this.whoKey(req), atMs: this.now() });
    this.deps.onQueueChanged();
    return 'queued';
  }

  async reject(req: SongRequest, reason?: string): Promise<void> {
    this.autoHandled.add(req.id);
    await this.deps.api.decide(req.id, { action: 'reject', reason: reason?.trim() || undefined });
  }

  async nextCandidate(req: SongRequest): Promise<void> {
    await this.deps.api.decide(req.id, { action: 'next-candidate' });
  }

  /** Song on air (settled), or null before the first one. */
  getOnAirId(): string | null {
    return this.onAirId;
  }

  /**
   * Reports the next song (queue edits, a new song on air, a hand-loaded deck). Called
   * often; only a change is sent, and only while a request source is on.
   */
  observeUpNext(next: UpNextInfo | null): void {
    if (!this.active) return;
    const key = next ? `${next.title}\u0000${next.artist}` : '';
    if (key === this.sentUpNextKey) return;
    this.sentUpNextKey = key;
    void this.deps.api.upNext?.(next ? { title: next.title, artist: next.artist } : null);
  }

  /** Request info for a queued/playing song (queue rows and the Screen 2 banner). */
  requestFor(videoId: string): QueueRequestInfo | null {
    return this.byVideoId.get(videoId) ?? null;
  }

  /**
   * Called every frame with the loudest song on air (null while nothing is audible).
   * Once a new song has held the air for ON_AIR_SETTLE_MS: the previous request song is
   * PLAYED, now-playing is sent, and a request song becomes PLAYING. Returns the request
   * that just started (for the "Pedida por la mesa 7" banner).
   */
  observeOnAir(track: YouTubeTrack | null, nowMs = this.now()): QueueRequestInfo | null {
    if (!track) {
      this.pendingOnAir = null; // a pause or a gap is not a new song
      return null;
    }
    const id = track.videoId;
    if (id === this.onAirId) {
      this.pendingOnAir = null;
      return null;
    }
    if (!this.pendingOnAir || this.pendingOnAir.id !== id) {
      this.pendingOnAir = { id, sinceMs: nowMs, track };
      return null;
    }
    if (nowMs - this.pendingOnAir.sinceMs < ON_AIR_SETTLE_MS) return null;

    const previous = this.onAirId;
    this.onAirId = id;
    this.pendingOnAir = null;

    if (previous) {
      const prevReq = this.byVideoId.get(previous);
      if (prevReq && prevReq.state === 'playing') {
        this.byVideoId.delete(previous);
        void this.deps.api.decide(prevReq.requestId, { action: 'played' });
      }
    }
    if (this.active) {
      void this.deps.api.nowPlaying({
        title: track.title,
        artist: trackArtist(track),
        videoId: isYouTubeVideoId(id) ? id : null
      });
    }
    const req = this.byVideoId.get(id);
    if (req && req.state === 'queued') {
      req.state = 'playing';
      void this.deps.api.decide(req.requestId, { action: 'playing' });
      return { requestId: req.requestId, table: req.table, guest: req.guest };
    }
    return null;
  }
}
