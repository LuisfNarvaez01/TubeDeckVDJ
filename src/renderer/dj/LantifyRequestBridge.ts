/**
 * Renderer side of Lantify song requests: turns an approved request into a queue item,
 * applies "Aprobar automáticamente" with its limits, and reports PLAYING / PLAYED and
 * now-playing as the song on air changes. The DJ always decides: nothing here removes
 * or reorders what is already in the queue, it only adds approved requests at the end.
 */
import type {
  LantifyDecision,
  LantifyNowPlaying,
  LantifyPrefs,
  LantifySnapshot,
  LantifySongRequest,
  Result,
  YouTubeTrack
} from '../../shared/types';
import type { QueueItem, QueueRequestInfo, QueueSource } from './QueueAndAutomixEngine';
import { isYouTubeVideoId } from './QueueAndAutomixEngine';

export interface LantifyBridgeApi {
  decide: (id: string, decision: LantifyDecision) => Promise<Result<LantifySongRequest>>;
  nowPlaying: (np: LantifyNowPlaying) => Promise<unknown>;
}

export interface LantifyBridgeQueue {
  enqueue: (track: YouTubeTrack, source: QueueSource, request: QueueRequestInfo) => QueueItem;
  requestConflict: (track: YouTubeTrack, nowMs?: number) => 'queued' | 'played' | null;
}

export type ApproveOutcome = 'queued' | 'already-played' | 'already-queued' | 'no-candidate' | 'error';

/** A song must stay the loudest on air this long before it counts as "now playing". */
export const ON_AIR_SETTLE_MS = 1500;
const HOUR_MS = 60 * 60 * 1000;

export function currentCandidate(req: LantifySongRequest): YouTubeTrack | null {
  return req.candidates[req.candidateIndex] ?? req.candidates[0] ?? null;
}

export function trackArtist(track: YouTubeTrack): string {
  return track.artists?.[0] ?? track.channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

interface TrackedRequest extends QueueRequestInfo {
  state: 'queued' | 'playing';
}

export class LantifyRequestBridge {
  private paired = false;
  private prefs: LantifyPrefs | null = null;
  private approvals: Array<{ table: string; atMs: number }> = [];
  private byVideoId = new Map<string, TrackedRequest>();
  private autoHandled = new Set<string>();
  private onAirId: string | null = null;
  private pendingOnAir: { id: string; sinceMs: number; track: YouTubeTrack } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      api: LantifyBridgeApi;
      queue: LantifyBridgeQueue;
      onQueueChanged: () => void;
      now?: () => number;
    }
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** New snapshot from the main process: remember the tracked songs, run auto-approve. */
  async sync(snapshot: LantifySnapshot): Promise<void> {
    this.paired = snapshot.status.paired;
    this.prefs = snapshot.status.prefs;
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
    if (!this.paired || !this.prefs.autoApprove) return;
    for (const req of snapshot.requests) {
      if (req.state !== 'pending' || this.autoHandled.has(req.id)) continue;
      if (this.overLimit(req.table)) continue; // waits for the DJ; retried on the next snapshot
      this.autoHandled.add(req.id);
      await this.approve(req);
    }
  }

  /** Approved requests in the last hour: all tables and this table. */
  countsFor(table: string): { hour: number; table: number } {
    const since = this.now() - HOUR_MS;
    this.approvals = this.approvals.filter((a) => a.atMs >= since);
    return { hour: this.approvals.length, table: this.approvals.filter((a) => a.table === table).length };
  }

  /** True when auto-approve must leave this table's request to the DJ. */
  overLimit(table: string): boolean {
    if (!this.prefs) return false;
    const counts = this.countsFor(table);
    return counts.hour >= this.prefs.maxPerHour || counts.table >= this.prefs.maxPerTable;
  }

  /** Queues the request's current candidate, or rejects it with ALREADY_PLAYED if it would repeat. */
  async approve(req: LantifySongRequest): Promise<ApproveOutcome> {
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
    this.approvals.push({ table: req.table, atMs: this.now() });
    this.deps.onQueueChanged();
    return 'queued';
  }

  async reject(req: LantifySongRequest, reason?: string): Promise<void> {
    this.autoHandled.add(req.id);
    await this.deps.api.decide(req.id, { action: 'reject', reason: reason?.trim() || undefined });
  }

  async nextCandidate(req: LantifySongRequest): Promise<void> {
    await this.deps.api.decide(req.id, { action: 'next-candidate' });
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
    if (this.paired) {
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
