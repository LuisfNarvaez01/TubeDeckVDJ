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

export class QueueAndAutomixEngine {
  private queue: QueueItem[] = [];
  private tickLocked = false;
  private preloadedForDeck: Partial<Record<DeckId, string>> = {};
  private transitionedForDeck: Partial<Record<DeckId, boolean>> = {};
  private playedVideoIds = new Set<string>();
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

  recordPlayed(videoId: string): void {
    if (videoId) {
      this.playedVideoIds.add(videoId);
    }
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
      this.radioPool = this.radioPool.filter((t) => !excluded.has(t.videoId));
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
        this.radioPool = fetched.filter((t) => !excluded.has(t.videoId));
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

          nextPending.status = 'preloading';
          try {
            await callbacks.loadDeck(inactiveDeck, nextPending.track);
            nextPending.status = 'loaded';
            this.preloadedForDeck[inactiveDeck] = nextPending.queueId;
            break;
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            nextPending.status = 'failed';
            nextPending.errorMessage = reason;
            this.playedVideoIds.add(nextPending.track.videoId);
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
          this.playedVideoIds.add(loadedItem.track.videoId);
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
