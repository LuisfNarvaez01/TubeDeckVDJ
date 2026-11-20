import { looseSongKey } from '../../shared/songIdentity';
import type { DeckId, YouTubeTrack } from '../../shared/types';

export type QueueSource = 'user' | 'youtube-radio' | 'local';
export type AutomixFadeType = 'smart-crossfade' | 'fade-out-in' | 'cut' | 'backspin';
export type PreloadMode = 'immediate' | '90s' | '60s' | '30s';

export interface QueueItem {
  queueId: string;
  track: YouTubeTrack;
  status: 'pending' | 'preloading' | 'loaded' | 'failed';
  source?: QueueSource;
  errorMessage?: string;
}

export interface AutomixOptions {
  enabled: boolean;
  preloadLeadSec: number;
  preloadMode?: PreloadMode;
  crossfadeDurationSec: number;
  outroTriggerSec: number;
  autoRadioEnabled: boolean;
  fadeType: AutomixFadeType;
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
}

const RADIO_RETRY_COOLDOWN_MS = 8000;

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
  private radioSeedVideoId: string | null = null;
  private radioPool: YouTubeTrack[] = [];
  private lastRadioFetchMs = -Infinity;
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `q-${Date.now()}-${this.idCounter}`;
  }

  enqueue(track: YouTubeTrack, source?: QueueSource): QueueItem {
    const resolvedSource: QueueSource = source ?? (track.source === 'local' ? 'local' : 'user');
    const item: QueueItem = {
      queueId: this.nextId(),
      track,
      status: 'pending',
      source: resolvedSource
    };
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

  recordPlayed(videoId: string, title?: string): void {
    if (videoId) {
      this.playedVideoIds.add(videoId);
    }
    if (title) {
      const key = looseSongKey(title);
      if (key) this.playedSongKeys.add(key);
    }
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
  }

  markDeckChanged(deck: DeckId): void {
    delete this.preloadedForDeck[deck];
    this.transitionedForDeck[deck] = false;
  }

  private collectExcludeIds(context: AutomixTickContext): string[] {
    const excluded = new Set<string>(this.playedVideoIds);
    if (context.activeVideoId) excluded.add(context.activeVideoId);
    if (context.otherDeckVideoId) excluded.add(context.otherDeckVideoId);
    for (const item of this.queue) {
      excluded.add(item.track.videoId);
    }
    return Array.from(excluded);
  }

  private async ensureRadioSuggestionQueued(
    context: AutomixTickContext,
    callbacks: AutomixCallbacks,
    nowMs: number
  ): Promise<void> {
    if (!callbacks.fetchSuggestedTracks || !context.activeVideoId) return;
    const excluded = new Set(this.collectExcludeIds(context));

    // Drop any cached radio candidates that were already played or queued
    if (this.radioSeedVideoId !== context.activeVideoId) {
      this.radioPool = [];
      this.radioSeedVideoId = context.activeVideoId;
    } else {
      this.radioPool = this.radioPool.filter((t) => !excluded.has(t.videoId) && !this.isQueuedOrPlayedSong(t));
    }

    if (this.radioPool.length === 0) {
      if (nowMs - this.lastRadioFetchMs < RADIO_RETRY_COOLDOWN_MS) {
        return;
      }
      this.lastRadioFetchMs = nowMs;
      try {
        const fetched = await callbacks.fetchSuggestedTracks(
          context.activeVideoId,
          Array.from(excluded)
        );
        this.radioPool = fetched.filter((t) => !excluded.has(t.videoId) && !this.isQueuedOrPlayedSong(t));
      } catch {
        this.radioPool = [];
        return;
      }
    }

    const nextSuggested = this.radioPool.shift();
    if (nextSuggested) {
      this.enqueue(nextSuggested, 'youtube-radio');
      callbacks.onRadioQueued?.(nextSuggested);
    }
  }

  private isQueuedOrPlayedSong(track: YouTubeTrack): boolean {
    if (this.wasSongPlayed(track)) return true;
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
      // The deck on air can never be "the next one": forget stale claims on it.
      delete this.preloadedForDeck[activeDeck];

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
          let nextPending = this.queue.find((q) => q.status === 'pending');

          if (!nextPending && options.autoRadioEnabled) {
            await this.ensureRadioSuggestionQueued(context, callbacks, nowMs);
            nextPending = this.queue.find((q) => q.status === 'pending');
          }

          if (!nextPending) break;

          if (nextPending.source === 'youtube-radio' && this.wasSongPlayed(nextPending.track)) {
            this.queue = this.queue.filter((q) => q.queueId !== nextPending?.queueId);
            continue;
          }

          nextPending.status = 'preloading';
          try {
            await callbacks.loadDeck(inactiveDeck, nextPending.track);
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
        await callbacks.startTransition(
          activeDeck,
          inactiveDeck,
          options.crossfadeDurationSec,
          options.fadeType
        );
        this.queue = this.queue.filter((q) => q.queueId !== loadedQueueId);
        delete this.preloadedForDeck[inactiveDeck];
        this.transitionedForDeck[inactiveDeck] = false;
      }
    } finally {
      this.tickLocked = false;
    }
  }
}
