import type { DeckId, YouTubeTrack } from '../../shared/types';

export interface QueueItem {
  queueId: string;
  track: YouTubeTrack;
  status: 'pending' | 'preloading' | 'loaded' | 'failed';
  errorMessage?: string;
}

export interface AutomixOptions {
  enabled: boolean;
  preloadLeadSec: number;
  crossfadeDurationSec: number;
  outroTriggerSec: number;
}

export interface AutomixCallbacks {
  loadDeck: (deck: DeckId, track: YouTubeTrack) => Promise<void>;
  startTransition: (fromDeck: DeckId, toDeck: DeckId, durationSec: number) => Promise<void>;
  onTrackSkipped: (item: QueueItem, reason: string) => void;
}

export class QueueAndAutomixEngine {
  private queue: QueueItem[] = [];
  private tickLocked = false;
  private preloadedForDeck: Partial<Record<DeckId, string>> = {};
  private transitionedForDeck: Partial<Record<DeckId, boolean>> = {};
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `q-${Date.now()}-${this.idCounter}`;
  }

  enqueue(track: YouTubeTrack): QueueItem {
    const item: QueueItem = {
      queueId: this.nextId(),
      track,
      status: 'pending'
    };
    this.queue.push(item);
    return item;
  }

  enqueueMany(tracks: YouTubeTrack[]): QueueItem[] {
    return tracks.map((t) => this.enqueue(t));
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

  remove(queueId: string): void {
    this.queue = this.queue.filter((q) => q.queueId !== queueId);
  }

  clear(): void {
    this.queue = [];
    this.preloadedForDeck = {};
    this.transitionedForDeck = {};
  }

  getQueue(): QueueItem[] {
    return this.queue.map((item) => ({ ...item }));
  }

  markDeckChanged(activeDeck: DeckId): void {
    this.transitionedForDeck[activeDeck] = false;
  }

  async tick(
    activeDeck: DeckId,
    remainingSec: number,
    isActivePlaying: boolean,
    options: AutomixOptions,
    callbacks: AutomixCallbacks
  ): Promise<void> {
    if (!options.enabled || !isActivePlaying || this.tickLocked) {
      return;
    }

    const inactiveDeck: DeckId = activeDeck === 'A' ? 'B' : 'A';
    this.tickLocked = true;

    try {
      // 1. Preload next valid track into inactive deck when remainingSec <= preloadLeadSec
      if (remainingSec <= options.preloadLeadSec && !this.preloadedForDeck[inactiveDeck]) {
        while (true) {
          const nextPending = this.queue.find((q) => q.status === 'pending');
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
            callbacks.onTrackSkipped({ ...nextPending }, reason);
          }
        }
      }

      // 2. Trigger crossfade transition when remainingSec <= outroTriggerSec
      const loadedQueueId = this.preloadedForDeck[inactiveDeck];
      if (
        loadedQueueId &&
        remainingSec <= options.outroTriggerSec &&
        !this.transitionedForDeck[activeDeck]
      ) {
        this.transitionedForDeck[activeDeck] = true;
        await callbacks.startTransition(activeDeck, inactiveDeck, options.crossfadeDurationSec);
        this.queue = this.queue.filter((q) => q.queueId !== loadedQueueId);
        delete this.preloadedForDeck[inactiveDeck];
        this.transitionedForDeck[inactiveDeck] = false;
      }
    } finally {
      this.tickLocked = false;
    }
  }
}
