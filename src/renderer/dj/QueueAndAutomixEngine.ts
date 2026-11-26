import { looseSongKey } from '../../shared/songIdentity';
import { pickSimilarTrack } from './localFallback';
import type { DeckId, YouTubeTrack } from '../../shared/types';

export type QueueSource = 'user' | 'youtube-radio' | 'local' | 'request';

/** A guest asked for this song from the table QR (Lantify POS). */
export interface QueueRequestInfo {
  requestId: string;
  table: string;
  guest: string;
}

/** A request song that played this recently counts as a repeat. */
export const REQUEST_REPEAT_WINDOW_MS = 60 * 60 * 1000;
export type AutomixFadeType = 'smart-crossfade' | 'fade-out-in' | 'cut' | 'backspin';
export type PreloadMode = 'immediate' | '90s' | '60s' | '30s';
/**
 * Where Automix finds songs when the queue runs dry: only the local library, YouTube radio
 * (with local songs as backup), or Autopilot, which mixes both and picks what fits.
 */
export type AutomixSourceMode = 'youtube' | 'local' | 'autopilot';

export interface QueueItem {
  queueId: string;
  track: YouTubeTrack;
  status: 'pending' | 'preloading' | 'loaded' | 'failed';
  source?: QueueSource;
  errorMessage?: string;
  /** Only for `source: 'request'`: table and guest shown in the queue. */
  request?: QueueRequestInfo;
}

export interface AutomixOptions {
  enabled: boolean;
  preloadLeadSec: number;
  preloadMode?: PreloadMode;
  crossfadeDurationSec: number;
  outroTriggerSec: number;
  autoRadioEnabled: boolean;
  fadeType: AutomixFadeType;
  sourceMode?: AutomixSourceMode;
}

export interface AutomixTickContext {
  activeDeck: DeckId;
  activeVideoId: string | null;
  otherDeckVideoId: string | null;
  elapsedSec?: number;
  remainingSec: number;
  isActivePlaying: boolean;
  isActiveEnded: boolean;
  isTransitioning?: boolean;
  /** On-air song text, used to find a similar backup song. */
  activeTitle?: string;
  activeChannel?: string;
}

export interface AutomixCallbacks {
  loadDeck: (deck: DeckId, track: YouTubeTrack) => Promise<void>;
  startTransition: (
    fromDeck: DeckId,
    toDeck: DeckId,
    durationSec: number,
    fadeType: AutomixFadeType
  ) => Promise<void>;
  onTrackSkipped: (item: QueueItem, reason: string) => void;
  fetchSuggestedTracks?: (seedVideoId: string, excludeIds: string[]) => Promise<YouTubeTrack[]>;
  onRadioQueued?: (track: YouTubeTrack) => void;
  /** True while the computer has no internet: failed loads wait instead of being skipped. */
  isOffline?: () => boolean;
  /** Radio found nothing new from any seed this round (shown to the DJ). */
  onRadioEmpty?: () => void;
  /**
   * Songs that play without internet: the local library plus YouTube songs saved in the
   * media cache. Used as backup so the music never stops.
   */
  getFallbackTracks?: () => YouTubeTrack[];
  /** True when a YouTube song is saved in the media cache and can play offline. */
  canPlayOffline?: (track: YouTubeTrack) => boolean;
  /** A backup song was queued (offline, a failure, or the queue ran out). */
  onFallbackQueued?: (track: YouTubeTrack, reason: FallbackReason) => void;
}

export type FallbackReason = 'offline' | 'empty' | 'failed' | 'local-mode' | 'autopilot';

const RADIO_RETRY_COOLDOWN_MS = 8000;
/** A deck load (resolve + buffer) slower than this is treated as failed so Automix keeps going. */
export const LOAD_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_EXCLUDE_IDS = 300;
const MAX_RECENT_SEEDS = 12;

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export function isYouTubeVideoId(id: string | null | undefined): id is string {
  return Boolean(id && YOUTUBE_ID_RE.test(id));
}

export class AutomixTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: tardó más de ${Math.round(ms / 1000)} s`);
    this.name = 'AutomixTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AutomixTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Marks a deck the DJ loaded by hand: Automix must not overwrite it and will mix into it. */
export const MANUAL_DECK_CLAIM = 'manual';

/** Thrown by a deck loader when a newer load for the same deck replaced this one. */
export class DeckLoadSupersededError extends Error {
  readonly superseded = true;
  constructor(deck: DeckId) {
    super(`Deck ${deck}: carga reemplazada por una más reciente`);
    this.name = 'DeckLoadSupersededError';
  }
}

function isSuperseded(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { superseded?: boolean }).superseded);
}

export class QueueAndAutomixEngine {
  private queue: QueueItem[] = [];
  private tickLocked = false;
  private preloadedForDeck: Partial<Record<DeckId, string>> = {};
  private transitionedForDeck: Partial<Record<DeckId, boolean>> = {};
  private playedVideoIds = new Set<string>();
  private playedSongKeys = new Set<string>();
  /** When each song (by id and by loose key) last went to a deck. */
  private lastPlayedAtById = new Map<string, number>();
  private lastPlayedAtByKey = new Map<string, number>();
  /** Songs the DJ took out this session (not a dislike: just "not this one"). */
  private dismissedVideoIds = new Set<string>();
  private dismissedSongKeys = new Set<string>();
  private radioSeedVideoId: string | null = null;
  private radioPool: YouTubeTrack[] = [];
  private lastRadioFetchMs = -Infinity;
  /** Consecutive radio rounds that found nothing new: rotates to another seed song. */
  private radioMissCount = 0;
  /** Autopilot alternates sources; this is the one it will try next. */
  private autopilotNext: 'local' | 'youtube' = 'youtube';
  random: () => number = Math.random;
  /** YouTube songs that played recently, newest last: fallback radio seeds. */
  private recentSeedIds: string[] = [];
  /** Deck that was on air at the previous tick (to notice manual crossfader moves). */
  private lastActiveDeck: DeckId | null = null;
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `q-${Date.now()}-${this.idCounter}`;
  }

  enqueue(track: YouTubeTrack, source?: QueueSource, request?: QueueRequestInfo): QueueItem {
    const resolvedSource: QueueSource = source ?? (track.source === 'local' ? 'local' : 'user');
    const item: QueueItem = {
      queueId: this.nextId(),
      track,
      status: 'pending',
      source: resolvedSource
    };
    if (resolvedSource === 'request' && request) item.request = { ...request };
    this.queue.push(item);
    return item;
  }

  enqueueMany(tracks: YouTubeTrack[], source?: QueueSource): QueueItem[] {
    return tracks.map((t) => this.enqueue(t, source));
  }

  reorder(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);
  }

  moveToNext(queueId: string): void {
    const idx = this.queue.findIndex((q) => q.queueId === queueId);
    if (idx <= 0) return;
    const item = this.queue[idx];
    if (item.status === 'loaded' || item.status === 'preloading') return;

    // Insert at the first pending slot so already-preloaded deck stays undisturbed
    let targetIdx = this.queue.findIndex((q) => q.status === 'pending' || q.status === 'failed');
    if (targetIdx === -1) targetIdx = 0;
    if (idx === targetIdx) return;
    this.queue.splice(idx, 1);
    const adjusted = idx < targetIdx ? targetIdx - 1 : targetIdx;
    this.queue.splice(adjusted, 0, item);
  }

  interleaveBySource(): void {
    const pinned = this.queue.filter((q) => q.status === 'loaded' || q.status === 'preloading');
    const pending = this.queue.filter((q) => q.status !== 'loaded' && q.status !== 'preloading');
    const yt = pending.filter((q) => q.track.source !== 'local');
    const local = pending.filter((q) => q.track.source === 'local');
    const zipped: QueueItem[] = [];
    const maxLen = Math.max(yt.length, local.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (yt[i]) zipped.push(yt[i]);
      if (local[i]) zipped.push(local[i]);
    }
    this.queue = [...pinned, ...zipped];
  }

  remove(queueId: string): void {
    this.queue = this.queue.filter((q) => q.queueId !== queueId);
    for (const deck of ['A', 'B'] as DeckId[]) {
      if (this.preloadedForDeck[deck] === queueId) {
        delete this.preloadedForDeck[deck];
      }
    }
  }

  dequeueById(queueId: string): QueueItem | null {
    const found = this.queue.find((q) => q.queueId === queueId) ?? null;
    if (found) {
      this.remove(queueId);
    }
    return found;
  }

  clear(): void {
    this.queue = [];
    this.preloadedForDeck = {};
    this.transitionedForDeck = {};
    this.radioPool = [];
  }

  getQueue(): QueueItem[] {
    return this.queue.map((item) => ({ ...item }));
  }

  /**
   * Why a guest's request would repeat a song: it is already in the queue (any upload of
   * it), or it went on a deck less than `windowMs` ago. Null when it is fine to queue.
   */
  requestConflict(
    track: YouTubeTrack,
    nowMs = Date.now(),
    windowMs = REQUEST_REPEAT_WINDOW_MS
  ): 'queued' | 'played' | null {
    const key = looseSongKey(track.title);
    if (this.queue.some((q) => q.track.videoId === track.videoId || (key && looseSongKey(q.track.title) === key))) {
      return 'queued';
    }
    const at = Math.max(
      this.lastPlayedAtById.get(track.videoId) ?? -Infinity,
      key ? (this.lastPlayedAtByKey.get(key) ?? -Infinity) : -Infinity
    );
    return nowMs - at < windowMs ? 'played' : null;
  }

  recordPlayed(videoId: string, title?: string, nowMs = Date.now()): void {
    if (videoId) {
      this.lastPlayedAtById.set(videoId, nowMs);
      this.playedVideoIds.add(videoId);
      if (isYouTubeVideoId(videoId)) {
        this.recentSeedIds = [...this.recentSeedIds.filter((id) => id !== videoId), videoId].slice(
          -MAX_RECENT_SEEDS
        );
      }
    }
    if (title) {
      const key = looseSongKey(title);
      if (key) {
        this.lastPlayedAtByKey.set(key, nowMs);
        this.playedSongKeys.add(key);
        if (videoId) this.titleKeys.set(videoId, key);
      }
    }
  }

  /** The DJ removed this song from the queue or ejected it: never suggest it again this session. */
  dismissSong(track: YouTubeTrack): void {
    this.dismissedVideoIds.add(track.videoId);
    const key = looseSongKey(track.title);
    if (key) this.dismissedSongKeys.add(key);
    this.radioPool = this.radioPool.filter((t) => !this.isDismissed(t));
  }

  isDismissed(track: YouTubeTrack): boolean {
    if (this.dismissedVideoIds.has(track.videoId)) return true;
    const key = looseSongKey(track.title);
    return key.length > 0 && this.dismissedSongKeys.has(key);
  }

  /** User removal from the queue (as opposed to the engine consuming an item). */
  removeByUser(queueId: string): QueueItem | null {
    const item = this.queue.find((q) => q.queueId === queueId) ?? null;
    if (item) {
      this.dismissSong(item.track);
      this.remove(queueId);
    }
    return item;
  }

  /** Keeps only suggestions that are new: not played, queued, dismissed or a re-upload of those. */
  filterFreshSuggestions(tracks: YouTubeTrack[]): YouTubeTrack[] {
    const seen = new Set<string>();
    return tracks.filter((t) => {
      if (this.isQueuedOrPlayedSong(t)) return false;
      const key = looseSongKey(t.title) || t.videoId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getDismissedVideoIds(): string[] {
    return Array.from(this.dismissedVideoIds);
  }

  /** True when this song (any upload of it) already played this session. */
  wasSongPlayed(track: YouTubeTrack): boolean {
    if (this.playedVideoIds.has(track.videoId)) return true;
    const key = looseSongKey(track.title);
    return key.length > 0 && this.playedSongKeys.has(key);
  }

  /**
   * The DJ loaded `track` onto `deck` by hand. Automix keeps its hands off that deck
   * (it will mix into it instead of overwriting it), a queue item that was preloaded
   * there goes back to waiting, and pending copies of the same song leave the queue.
   */
  claimDeckForManualLoad(deck: DeckId, track: YouTubeTrack): void {
    const previous = this.preloadedForDeck[deck];
    if (previous && previous !== MANUAL_DECK_CLAIM) {
      const item = this.queue.find((q) => q.queueId === previous);
      if (item && item.track.videoId === track.videoId) {
        return; // reloading the very queue item that is already there (e.g. retry)
      }
      if (item) {
        item.status = 'pending';
        item.errorMessage = undefined;
      }
    }
    const key = looseSongKey(track.title);
    this.queue = this.queue.filter(
      (q) =>
        q.status === 'loaded' ||
        q.status === 'preloading' ||
        (q.track.videoId !== track.videoId && (!key || looseSongKey(q.track.title) !== key))
    );
    this.preloadedForDeck[deck] = MANUAL_DECK_CLAIM;
    this.transitionedForDeck[deck] = false;
  }

  /** The deck was emptied (eject): drop the queue item that sat on it. */
  releaseDeck(deck: DeckId): void {
    const previous = this.preloadedForDeck[deck];
    if (previous && previous !== MANUAL_DECK_CLAIM) {
      this.queue = this.queue.filter((q) => q.queueId !== previous);
    }
    delete this.preloadedForDeck[deck];
    this.transitionedForDeck[deck] = false;
  }

  /** Drops cached radio suggestions so the next fetch reflects fresh feedback. */
  invalidateRadioPool(): void {
    this.radioPool = [];
    this.radioSeedVideoId = null;
    this.lastRadioFetchMs = -Infinity;
    this.radioMissCount = 0;
  }

  /**
   * Seeds to ask the radio with, best first: the song on air, the other deck, then the
   * songs that played before. Local files cannot seed YouTube, so they are skipped.
   */
  radioSeedCandidates(context: Pick<AutomixTickContext, 'activeVideoId' | 'otherDeckVideoId'>): string[] {
    const ordered = [context.activeVideoId, context.otherDeckVideoId, ...[...this.recentSeedIds].reverse()];
    const out: string[] = [];
    for (const id of ordered) {
      if (isYouTubeVideoId(id) && !out.includes(id) && !this.dismissedVideoIds.has(id)) out.push(id);
    }
    return out;
  }

  /**
   * Queue items that say they sit on a deck but no deck claims them any more (the DJ mixed
   * by hand, or the deck was reloaded) already played: drop them so the queue view moves on.
   * Pending copies of the song on air leave too.
   */
  pruneStale(activeVideoId: string | null): boolean {
    const claimed = new Set(Object.values(this.preloadedForDeck));
    const before = this.queue.length;
    const activeKey = activeVideoId ? this.titleKeyOf(activeVideoId) : '';
    this.queue = this.queue.filter((q) => {
      if ((q.status === 'loaded' || q.status === 'preloading') && !claimed.has(q.queueId)) return false;
      if (activeVideoId && q.status !== 'loaded' && q.status !== 'preloading') {
        if (q.track.videoId === activeVideoId) return false;
        if (activeKey && looseSongKey(q.track.title) === activeKey) return false;
      }
      return true;
    });
    return this.queue.length !== before;
  }

  /** Song key of every track that was loaded, to match re-uploads of the song on air. */
  private readonly titleKeys = new Map<string, string>();

  private titleKeyOf(videoId: string): string {
    return this.titleKeys.get(videoId) ?? '';
  }

  markDeckChanged(deck: DeckId): void {
    delete this.preloadedForDeck[deck];
    this.transitionedForDeck[deck] = false;
  }

  private collectExcludeIds(context: AutomixTickContext): Set<string> {
    const excluded = new Set<string>([...this.playedVideoIds, ...this.dismissedVideoIds]);
    if (context.activeVideoId) excluded.add(context.activeVideoId);
    if (context.otherDeckVideoId) excluded.add(context.otherDeckVideoId);
    for (const item of this.queue) {
      excluded.add(item.track.videoId);
    }
    return excluded;
  }

  /** What is sent to the recommender: YouTube ids only, newest last, capped. */
  private excludeIdsForRequest(excluded: Set<string>): string[] {
    return Array.from(excluded).filter(isYouTubeVideoId).slice(-MAX_EXCLUDE_IDS);
  }

  private async ensureRadioSuggestionQueued(
    context: AutomixTickContext,
    callbacks: AutomixCallbacks,
    nowMs: number
  ): Promise<void> {
    if (!callbacks.fetchSuggestedTracks) return;
    const seeds = this.radioSeedCandidates(context);
    if (seeds.length === 0) return;
    const excluded = this.collectExcludeIds(context);
    const isFresh = (t: YouTubeTrack): boolean => !excluded.has(t.videoId) && !this.isQueuedOrPlayedSong(t);

    this.radioPool = this.radioPool.filter(isFresh);

    if (this.radioPool.length === 0) {
      if (nowMs - this.lastRadioFetchMs < RADIO_RETRY_COOLDOWN_MS) return;
      if (callbacks.isOffline?.()) return;
      this.lastRadioFetchMs = nowMs;
      // Same seed while it keeps giving songs; rotate to the next one each time it runs dry.
      const seed = seeds[this.radioMissCount % seeds.length];
      this.radioSeedVideoId = seed;
      let fetched: YouTubeTrack[] = [];
      try {
        fetched = await withTimeout(
          callbacks.fetchSuggestedTracks(seed, this.excludeIdsForRequest(excluded)),
          FETCH_TIMEOUT_MS,
          'Radio YT'
        );
      } catch {
        fetched = [];
      }
      const seen = new Set<string>();
      this.radioPool = fetched.filter((t) => {
        if (!isFresh(t)) return false;
        const key = looseSongKey(t.title) || t.videoId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (this.radioPool.length === 0) {
        this.radioMissCount += 1;
        // Try the next seed right away on the next tick instead of waiting the full cooldown.
        if (this.radioMissCount % seeds.length !== 0) this.lastRadioFetchMs = -Infinity;
        else callbacks.onRadioEmpty?.();
        return;
      }
      this.radioMissCount = 0;
    }

    const nextSuggested = this.radioPool.shift();
    if (nextSuggested) {
      this.enqueue(nextSuggested, 'youtube-radio');
      callbacks.onRadioQueued?.(nextSuggested);
    }
  }

  private playsOffline(track: YouTubeTrack, callbacks: AutomixCallbacks): boolean {
    return track.source === 'local' || Boolean(callbacks.canPlayOffline?.(track));
  }

  /**
   * Queues the most similar backup song (local library, or cached YouTube songs) ahead of
   * anything still waiting, and returns it; null when there is nothing left to play.
   */
  queueFallback(
    context: AutomixTickContext,
    callbacks: AutomixCallbacks,
    reason: FallbackReason,
    offlineOnly = true,
    localOnly = false
  ): QueueItem | null {
    const pool = (callbacks.getFallbackTracks?.() ?? []).filter((t) =>
      localOnly ? t.source === 'local' : !offlineOnly || this.playsOffline(t, callbacks)
    );
    if (pool.length === 0) return null;
    const excluded = this.collectExcludeIds(context);
    const onAir = new Set([context.activeVideoId, context.otherDeckVideoId]);
    const seed = context.activeTitle ? { title: context.activeTitle, channel: context.activeChannel ?? '' } : null;
    let pick = pickSimilarTrack(
      seed,
      pool,
      (t) => onAir.has(t.videoId) || excluded.has(t.videoId) || this.isQueuedOrPlayedSong(t),
      this.random
    );
    if (!pick) {
      // Everything already played tonight: repeat the oldest rather than going silent.
      pick = pickSimilarTrack(seed, pool, (t) => onAir.has(t.videoId) || this.isDismissed(t), this.random);
    }
    if (!pick) return null;
    const item = this.enqueue(pick, pick.source === 'local' ? 'local' : 'user');
    // Play it before songs that are waiting for the internet.
    this.queue = [item, ...this.queue.filter((q) => q.queueId !== item.queueId)];
    callbacks.onFallbackQueued?.(pick, reason);
    return item;
  }

  /** Fills an empty queue according to the Automix source mode. */
  private async ensureAutoSuggestionQueued(
    context: AutomixTickContext,
    options: AutomixOptions,
    callbacks: AutomixCallbacks,
    nowMs: number
  ): Promise<void> {
    const mode = options.sourceMode ?? 'youtube';
    const offline = callbacks.isOffline?.() ?? false;
    if (mode === 'local') {
      this.queueFallback(context, callbacks, 'local-mode', true, true);
      return;
    }
    if (offline) {
      this.queueFallback(context, callbacks, 'offline');
      return;
    }
    if (mode === 'autopilot' && this.autopilotNext === 'local') {
      this.autopilotNext = 'youtube';
      if (this.queueFallback(context, callbacks, 'autopilot', true, true)) return;
    } else if (mode === 'autopilot') {
      this.autopilotNext = 'local';
    }
    const before = this.queue.length;
    await this.ensureRadioSuggestionQueued(context, callbacks, nowMs);
    if (this.queue.length === before && mode === 'autopilot') {
      this.queueFallback(context, callbacks, 'autopilot', true, true);
    }
  }

  private isQueuedOrPlayedSong(track: YouTubeTrack): boolean {
    if (this.wasSongPlayed(track) || this.isDismissed(track)) return true;
    const key = looseSongKey(track.title);
    return key.length > 0 && this.queue.some((q) => looseSongKey(q.track.title) === key);
  }

  async tick(
    context: AutomixTickContext,
    options: AutomixOptions,
    callbacks: AutomixCallbacks,
    nowMs = Date.now()
  ): Promise<void> {
    if (!options.enabled || this.tickLocked || context.isTransitioning) {
      return;
    }
    if (!context.isActivePlaying && !context.isActiveEnded) {
      return;
    }

    const { activeDeck, remainingSec } = context;
    const inactiveDeck: DeckId = activeDeck === 'A' ? 'B' : 'A';
    this.tickLocked = true;

    try {
      if (context.activeVideoId) {
        this.playedVideoIds.add(context.activeVideoId);
      }
      // The deck on air can never be "the next one": forget stale claims on it, and any queue
      // item that was sitting there is now playing (the DJ may have mixed into it by hand).
      if (this.lastActiveDeck !== activeDeck) {
        // A deck that just came on air (Automix or the DJ's fader) is ready to mix out again.
        this.transitionedForDeck[activeDeck] = false;
        this.lastActiveDeck = activeDeck;
      }
      const onAirClaim = this.preloadedForDeck[activeDeck];
      delete this.preloadedForDeck[activeDeck];
      if (onAirClaim && onAirClaim !== MANUAL_DECK_CLAIM) {
        this.queue = this.queue.filter((q) => q.queueId !== onAirClaim);
      }
      this.pruneStale(context.activeVideoId);

      const mode = options.preloadMode ?? 'immediate';
      const leadSec =
        mode === '90s' ? 90 : mode === '60s' ? 60 : mode === '30s' ? 30 : options.preloadLeadSec;
      const shouldPreloadNow =
        context.isActiveEnded ||
        remainingSec <= leadSec ||
        (mode === 'immediate' && (context.elapsedSec ?? 0) >= 4);

      // 1. Preload next valid track early so slow internet connections finish buffering before outro
      if (shouldPreloadNow && !this.preloadedForDeck[inactiveDeck]) {
        let safetyIterations = 0;
        while (safetyIterations < 6) {
          safetyIterations += 1;
          const offline = callbacks.isOffline?.() ?? false;
          const findPlayable = (): QueueItem | undefined =>
            this.queue.find((q) => q.status === 'pending' && (!offline || this.playsOffline(q.track, callbacks)));
          let nextPending = findPlayable();

          if (!nextPending && options.autoRadioEnabled) {
            await this.ensureAutoSuggestionQueued(context, options, callbacks, nowMs);
            nextPending = findPlayable();
          }

          // Never let the music stop: offline with only YouTube songs waiting, or nothing left
          // as the song ends -> a similar song from the library (or the cache) plays next.
          const songEnding =
            context.isActiveEnded || remainingSec <= options.outroTriggerSec + 20;
          const waitingOnInternet = offline && this.queue.some((q) => q.status === 'pending');
          if (!nextPending && (waitingOnInternet || songEnding)) {
            nextPending =
              this.queueFallback(context, callbacks, waitingOnInternet ? 'offline' : 'empty', offline) ?? undefined;
          }

          if (!nextPending) break;

          if (nextPending.source === 'youtube-radio' && this.wasSongPlayed(nextPending.track)) {
            this.queue = this.queue.filter((q) => q.queueId !== nextPending?.queueId);
            continue;
          }

          nextPending.status = 'preloading';
          try {
            await withTimeout(callbacks.loadDeck(inactiveDeck, nextPending.track), LOAD_TIMEOUT_MS, 'Carga');
            if (this.preloadedForDeck[inactiveDeck] === MANUAL_DECK_CLAIM) {
              nextPending.status = 'pending';
              break;
            }
            nextPending.status = 'loaded';
            this.preloadedForDeck[inactiveDeck] = nextPending.queueId;
            break;
          } catch (err) {
            if (isSuperseded(err)) {
              // The DJ loaded something else on that deck meanwhile: keep this song waiting.
              nextPending.status = 'pending';
              break;
            }
            if (callbacks.isOffline?.()) {
              // No internet: the song is not at fault. Keep it and retry when the link is back.
              nextPending.status = 'pending';
              break;
            }
            const reason = err instanceof Error ? err.message : String(err);
            nextPending.status = 'failed';
            nextPending.errorMessage = reason;
            this.recordPlayed(nextPending.track.videoId);
            callbacks.onTrackSkipped({ ...nextPending }, reason);
          }
        }
      }

      // 2. Trigger crossfade transition when within outroTriggerSec or track ended
      const loadedQueueId = this.preloadedForDeck[inactiveDeck];
      if (
        loadedQueueId &&
        (remainingSec <= options.outroTriggerSec || context.isActiveEnded) &&
        !this.transitionedForDeck[activeDeck]
      ) {
        const loadedItem = this.queue.find((q) => q.queueId === loadedQueueId);
        if (loadedItem) {
          this.recordPlayed(loadedItem.track.videoId, loadedItem.track.title);
        }
        this.transitionedForDeck[activeDeck] = true;
        let started = true;
        try {
          await withTimeout(
            callbacks.startTransition(activeDeck, inactiveDeck, options.crossfadeDurationSec, options.fadeType),
            options.crossfadeDurationSec * 1000 + 15_000,
            'Transición'
          );
        } catch {
          // A hung transition must not freeze Automix: try again on the next tick.
          started = false;
        }
        if (!started) {
          this.transitionedForDeck[activeDeck] = false;
          return;
        }
        this.queue = this.queue.filter((q) => q.queueId !== loadedQueueId);
        delete this.preloadedForDeck[inactiveDeck];
        this.transitionedForDeck[inactiveDeck] = false;
      }
    } finally {
      this.tickLocked = false;
    }
  }
}
