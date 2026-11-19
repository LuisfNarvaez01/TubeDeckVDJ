import type { DeckId, StreamMode } from '../../shared/types';

export interface DeckMediaElements {
  audioSourceEl: HTMLMediaElement;
  videoEl: HTMLVideoElement;
}

export interface LoadDeckStreamParams {
  mode: StreamMode;
  muxedUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

const DRIFT_THRESHOLD_SEC = 0.04;
const DRIFT_COOLDOWN_MS = 250;

function waitForCanPlay(el: HTMLMediaElement, timeoutMs = 4000): Promise<void> {
  if (!el.src || el.readyState >= 3) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onReady);
      clearTimeout(timer);
      resolve();
    };
    const onReady = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    el.addEventListener('canplay', onReady, { once: true });
    el.addEventListener('error', onReady, { once: true });
  });
}

function setElementPreservesPitch(el: HTMLMediaElement, enabled: boolean): void {
  const target = el as HTMLMediaElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  target.preservesPitch = enabled;
  target.mozPreservesPitch = enabled;
  target.webkitPreservesPitch = enabled;
}

export class DualDeckMediaSync {
  readonly deckId: DeckId;
  private readonly audioEl: HTMLAudioElement;
  private readonly videoEl: HTMLVideoElement;
  private mode: StreamMode = 'muxed';
  private lastDriftCorrectionMs = -Infinity;
  private disposed = false;

  constructor(
    deckId: DeckId,
    elements?: { audioEl?: HTMLAudioElement; videoEl?: HTMLVideoElement }
  ) {
    this.deckId = deckId;
    this.audioEl = elements?.audioEl ?? document.createElement('audio');
    this.videoEl = elements?.videoEl ?? document.createElement('video');

    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.preload = 'auto';

    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.preload = 'auto';
    this.videoEl.playsInline = true;
  }

  getMode(): StreamMode {
    return this.mode;
  }

  getAudioElement(): HTMLMediaElement {
    return this.mode === 'dash-split' ? this.audioEl : this.videoEl;
  }

  getAllMediaElements(): [HTMLAudioElement, HTMLVideoElement] {
    return [this.audioEl, this.videoEl];
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  async load(params: LoadDeckStreamParams): Promise<DeckMediaElements> {
    if (this.disposed) {
      throw new Error(`DualDeckMediaSync(${this.deckId}) has been disposed`);
    }

    this.pause();
    this.mode = params.mode;

    if (params.mode === 'dash-split') {
      if (!params.videoUrl || !params.audioUrl) {
        throw new Error('dash-split mode requires both videoUrl and audioUrl');
      }
      this.audioEl.crossOrigin = 'anonymous';
      this.videoEl.crossOrigin = 'anonymous';
      this.audioEl.muted = false;
      this.videoEl.muted = true;
      this.audioEl.src = params.audioUrl;
      this.videoEl.src = params.videoUrl;
      this.audioEl.currentTime = 0;
      this.videoEl.currentTime = 0;
      this.audioEl.load();
      this.videoEl.load();
      await Promise.all([waitForCanPlay(this.audioEl), waitForCanPlay(this.videoEl)]);
    } else {
      if (!params.muxedUrl) {
        throw new Error('muxed mode requires muxedUrl');
      }
      this.audioEl.src = '';
      this.videoEl.crossOrigin = 'anonymous';
      this.videoEl.muted = false;
      this.videoEl.src = params.muxedUrl;
      this.videoEl.currentTime = 0;
      this.videoEl.load();
      await waitForCanPlay(this.videoEl);
    }

    return {
      audioSourceEl: this.getAudioElement(),
      videoEl: this.videoEl
    };
  }

  async play(): Promise<void> {
    if (this.mode === 'dash-split') {
      this.videoEl.currentTime = this.audioEl.currentTime;
      await Promise.all([this.audioEl.play(), this.videoEl.play()]);
      return;
    }
    await this.videoEl.play();
  }

  pause(): void {
    this.audioEl.pause();
    this.videoEl.pause();
  }

  async seek(timeSec: number): Promise<void> {
    const safeTime = Math.max(0, timeSec);
    if (this.mode === 'dash-split') {
      const wasPlaying = !this.audioEl.paused;
      if (wasPlaying) {
        this.pause();
      }
      this.audioEl.currentTime = safeTime;
      this.videoEl.currentTime = safeTime;
      await Promise.all([waitForCanPlay(this.audioEl, 1500), waitForCanPlay(this.videoEl, 1500)]);
      if (wasPlaying) {
        await this.play();
      }
      return;
    }

    this.videoEl.currentTime = safeTime;
    await waitForCanPlay(this.videoEl, 1500);
  }

  setPlaybackRate(rate: number, keyLock: boolean): void {
    const clampedRate = Math.min(2.0, Math.max(0.25, rate));
    this.audioEl.playbackRate = clampedRate;
    this.videoEl.playbackRate = clampedRate;
    setElementPreservesPitch(this.audioEl, keyLock);
    setElementPreservesPitch(this.videoEl, keyLock);
  }

  syncDrift(nowMs = Date.now()): boolean {
    if (this.mode !== 'dash-split') {
      return false;
    }
    const drift = Math.abs(this.videoEl.currentTime - this.audioEl.currentTime);
    if (drift <= DRIFT_THRESHOLD_SEC) {
      return false;
    }
    if (nowMs - this.lastDriftCorrectionMs < DRIFT_COOLDOWN_MS) {
      return false;
    }
    this.videoEl.currentTime = this.audioEl.currentTime;
    this.lastDriftCorrectionMs = nowMs;
    return true;
  }

  getCurrentTime(): number {
    return this.getAudioElement().currentTime || 0;
  }

  getDuration(): number {
    const d = this.getAudioElement().duration;
    return Number.isFinite(d) ? d : 0;
  }

  isPaused(): boolean {
    return this.getAudioElement().paused;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.audioEl.src = '';
    this.videoEl.src = '';
  }
}

