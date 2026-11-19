import type { DeckId, HotCue, LoopState } from '../../shared/types';
import type { DualDeckMediaSync } from '../audio/DualDeckMediaSync';

const HOT_CUE_COLORS = [
  '#00D4FF',
  '#10B981',
  '#FF8A00',
  '#8B5CF6',
  '#EF4444',
  '#EAB308',
  '#EC4899',
  '#38BDF8'
];

export class CueLoopTempoController {
  readonly deckId: DeckId;
  private readonly media: DualDeckMediaSync;
  private readonly onPersist?: (videoId: string, cues: HotCue[], loop: LoopState | null) => void;

  private videoId: string | null = null;
  private hotCues: HotCue[] = [];
  private loop: LoopState | null = null;
  private loopSeekInFlight = false;

  constructor(
    deckId: DeckId,
    media: DualDeckMediaSync,
    onPersist?: (videoId: string, cues: HotCue[], loop: LoopState | null) => void
  ) {
    this.deckId = deckId;
    this.media = media;
    this.onPersist = onPersist;
  }

  loadTrackState(videoId: string, cues: HotCue[], loop: LoopState | null): void {
    this.videoId = videoId;
    this.hotCues = [...cues].sort((a, b) => a.slot - b.slot);
    this.loop = loop ? { ...loop } : null;
    this.loopSeekInFlight = false;
  }

  getHotCues(): HotCue[] {
    return [...this.hotCues];
  }

  getLoop(): LoopState | null {
    return this.loop ? { ...this.loop } : null;
  }

  private persist(): void {
    if (this.videoId && this.onPersist) {
      this.onPersist(this.videoId, this.getHotCues(), this.getLoop());
    }
  }

  async triggerHotCue(slot: number, currentTimeSec: number): Promise<HotCue> {
    if (slot < 1 || slot > 8) {
      throw new Error(`Invalid hot cue slot ${slot}`);
    }
    const existing = this.hotCues.find((c) => c.slot === slot);
    if (existing) {
      await this.media.seek(existing.timeSec);
      return existing;
    }

    const created: HotCue = {
      slot,
      timeSec: Math.max(0, Number(currentTimeSec.toFixed(3))),
      label: `Cue ${slot}`,
      color: HOT_CUE_COLORS[(slot - 1) % HOT_CUE_COLORS.length]
    };
    this.hotCues = [...this.hotCues, created].sort((a, b) => a.slot - b.slot);
    this.persist();
    return created;
  }

  clearHotCue(slot: number): void {
    const next = this.hotCues.filter((c) => c.slot !== slot);
    if (next.length !== this.hotCues.length) {
      this.hotCues = next;
      this.persist();
    }
  }

  setLoopIn(timeSec: number): void {
    const inSec = Math.max(0, timeSec);
    const outSec = this.loop && this.loop.outSec > inSec ? this.loop.outSec : inSec + 2;
    this.loop = { active: false, inSec, outSec };
    this.persist();
  }

  setLoopOut(timeSec: number): void {
    const outSec = Math.max(0.1, timeSec);
    const inSec = this.loop && this.loop.inSec < outSec ? this.loop.inSec : Math.max(0, outSec - 2);
    this.loop = { active: true, inSec, outSec };
    this.persist();
  }

  triggerAutoLoop(
    beats: 0.5 | 1 | 2 | 4 | 8 | 16,
    currentTimeSec: number,
    bpm: number
  ): LoopState | null {
    const safeBpm = bpm > 20 ? bpm : 120;
    const beatSec = 60 / safeBpm;
    const inSec = Math.max(0, currentTimeSec);
    const outSec = Number((inSec + beats * beatSec).toFixed(4));
    this.loop = { active: true, inSec, outSec, beats };
    this.persist();
    return this.getLoop();
  }

  toggleLoopExit(): void {
    if (!this.loop) return;
    this.loop = { ...this.loop, active: !this.loop.active };
    this.persist();
  }

  async checkLoopBoundary(currentTimeSec: number): Promise<boolean> {
    if (!this.loop || !this.loop.active || this.loopSeekInFlight) {
      return false;
    }
    if (currentTimeSec >= this.loop.outSec) {
      this.loopSeekInFlight = true;
      try {
        await this.media.seek(this.loop.inSec);
        return true;
      } finally {
        this.loopSeekInFlight = false;
      }
    }
    return false;
  }

  setPitchPercent(percent: number, keyLock: boolean): void {
    const clamped = Math.min(50, Math.max(-50, percent));
    const rate = 1 + clamped / 100;
    this.media.setPlaybackRate(rate, keyLock);
  }
}
