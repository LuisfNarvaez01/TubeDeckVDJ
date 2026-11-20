import type { DeckId, StreamMode, VideoQualityPreference, VideoQualityTier } from '../../shared/types';

export interface DeckMediaElements {
  audioSourceEl: HTMLMediaElement;
  videoEl: HTMLVideoElement;
}

export interface LoadDeckStreamParams {
  mode: StreamMode;
  muxedUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  videoQualityUrls?: Partial<Record<VideoQualityTier, string>>;
  preferredQuality?: VideoQualityPreference;
  mediaKind?: 'video' | 'audio';
  onQualityDowngraded?: (quality: VideoQualityTier, reason: string) => void;
}

const SOFT_DRIFT_DEADBAND_SEC = 0.06;
const HARD_DRIFT_THRESHOLD_SEC = 0.65;
const HARD_DRIFT_COOLDOWN_MS = 2500;
const STALL_DETECTION_MS = 2500;
const TIER_ORDER_DESC: VideoQualityTier[] = ['1080p', '720p', '480p', '360p'];

function clampRate(rate: number): number {
  return Math.min(2.0, Math.max(0.25, rate));
}

function waitForCanPlay(el: HTMLMediaElement, timeoutMs = 4500): Promise<void> {
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

function pickInitialVideoVariant(
  pref: VideoQualityPreference,
  variants?: Partial<Record<VideoQualityTier, string>>,
  fallbackUrl?: string
): { tier: VideoQualityTier | null; url: string } {
  const candidatesByPref: Record<VideoQualityPreference, VideoQualityTier[]> = {
    auto: ['720p', '480p', '360p', '1080p'],
    '1080p': ['1080p', '720p', '480p', '360p'],
    '720p': ['720p', '480p', '360p', '1080p'],
    '480p': ['480p', '360p', '720p', '1080p'],
    '360p': ['360p', '480p', '720p', '1080p']
  };

  if (variants) {
    for (const tier of candidatesByPref[pref]) {
      const url = variants[tier];
      if (url) return { tier, url };
    }
  }
  return { tier: pref === 'auto' ? '720p' : pref, url: fallbackUrl ?? '' };
}

export class DualDeckMediaSync {
  readonly deckId: DeckId;
  private readonly audioEl: HTMLAudioElement;
  private readonly videoEl: HTMLVideoElement;
  private mode: StreamMode = 'muxed';
  private mediaKind: 'video' | 'audio' = 'video';
  private preferredQuality: VideoQualityPreference = 'auto';
  private activeQuality: VideoQualityTier | null = null;
  private videoQualityUrls: Partial<Record<VideoQualityTier, string>> = {};
  private onQualityDowngraded?: (quality: VideoQualityTier, reason: string) => void;

  private basePlaybackRate = 1;
  private tempBendMultiplier = 1;
  private lastDriftCorrectionMs = -Infinity;

  private lastHealthAudioTime = 0;
  private lastHealthVideoTime = 0;
  private stallStartedMs: number | null = null;
  private stallRecoveryCount = 0;
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

  getMediaKind(): 'video' | 'audio' {
    return this.mediaKind;
  }

  getActiveQuality(): VideoQualityTier | null {
    return this.activeQuality;
  }

  getAudioElement(): HTMLMediaElement {
    if (this.mediaKind === 'audio' || this.mode === 'dash-split') {
      return this.audioEl;
    }
    return this.videoEl;
  }

  getAllMediaElements(): [HTMLAudioElement, HTMLVideoElement] {
    return [this.audioEl, this.videoEl];
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  private resetHealthTracker(): void {
    this.lastHealthAudioTime = 0;
    this.lastHealthVideoTime = 0;
    this.stallStartedMs = null;
    this.stallRecoveryCount = 0;
  }

  async load(params: LoadDeckStreamParams): Promise<DeckMediaElements> {
    if (this.disposed) {
      throw new Error(`DualDeckMediaSync(${this.deckId}) has been disposed`);
    }

    this.pause();
    this.resetHealthTracker();
    this.mode = params.mode;
    this.mediaKind = params.mediaKind ?? 'video';
    this.preferredQuality = params.preferredQuality ?? this.preferredQuality;
    this.videoQualityUrls = params.videoQualityUrls ? { ...params.videoQualityUrls } : {};
    this.onQualityDowngraded = params.onQualityDowngraded;

    if (this.mediaKind === 'audio') {
      const audioSrc = params.audioUrl ?? params.muxedUrl;
      if (!audioSrc) {
        throw new Error('audio mediaKind requires audioUrl or muxedUrl');
      }
      this.activeQuality = null;
      this.videoEl.src = '';
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.muted = false;
      this.audioEl.src = audioSrc;
      this.audioEl.currentTime = 0;
      this.audioEl.load();
      await waitForCanPlay(this.audioEl);
    } else if (params.mode === 'dash-split') {
      if (!params.videoUrl || !params.audioUrl) {
        throw new Error('dash-split mode requires both videoUrl and audioUrl');
      }
      const picked = pickInitialVideoVariant(
        this.preferredQuality,
        this.videoQualityUrls,
        params.videoUrl
      );
      this.activeQuality = picked.tier;
      this.audioEl.crossOrigin = 'anonymous';
      this.videoEl.crossOrigin = 'anonymous';
      this.audioEl.muted = false;
      this.videoEl.muted = true;
      this.audioEl.src = params.audioUrl;
      this.videoEl.src = picked.url || params.videoUrl;
      this.audioEl.currentTime = 0;
      this.videoEl.currentTime = 0;
      this.audioEl.load();
      this.videoEl.load();
      await Promise.all([waitForCanPlay(this.audioEl), waitForCanPlay(this.videoEl)]);
    } else {
      if (!params.muxedUrl) {
        throw new Error('muxed mode requires muxedUrl');
      }
      this.activeQuality = null;
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

  setPreferredQuality(pref: VideoQualityPreference): VideoQualityTier | null {
    this.preferredQuality = pref;
    if (this.mode !== 'dash-split' || this.mediaKind !== 'video') {
      return this.activeQuality;
    }
    const picked = pickInitialVideoVariant(pref, this.videoQualityUrls);
    if (picked.url && picked.tier && picked.tier !== this.activeQuality) {
      this.hotSwapVideoQuality(picked.tier, picked.url);
    }
    return this.activeQuality;
  }

  private hotSwapVideoQuality(nextTier: VideoQualityTier, url: string): void {
    const wasPlaying = !this.audioEl.paused;
    const syncTime = this.audioEl.currentTime || 0;
    this.activeQuality = nextTier;
    this.videoEl.src = url;
    this.videoEl.currentTime = syncTime;
    this.videoEl.playbackRate = this.audioEl.playbackRate;
    this.videoEl.load();
    this.resetHealthTracker();
    if (wasPlaying) {
      void Promise.resolve(this.videoEl.play?.()).catch(() => {});
    }
  }

  async play(): Promise<void> {
    if (this.mediaKind === 'audio') {
      await this.audioEl.play();
      return;
    }
    if (this.mode === 'dash-split') {
      if (Math.abs(this.videoEl.currentTime - this.audioEl.currentTime) > 0.15) {
        this.videoEl.currentTime = this.audioEl.currentTime;
      }
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
    if (this.mediaKind === 'audio') {
      this.audioEl.currentTime = safeTime;
      await waitForCanPlay(this.audioEl, 1500);
      return;
    }
    if (this.mode === 'dash-split') {
      const wasPlaying = !this.audioEl.paused;
      if (wasPlaying) {
        this.pause();
      }
      this.audioEl.currentTime = safeTime;
      this.videoEl.currentTime = safeTime;
      this.resetHealthTracker();
      await Promise.all([waitForCanPlay(this.audioEl, 1500), waitForCanPlay(this.videoEl, 1500)]);
      if (wasPlaying) {
        await this.play();
      }
      return;
    }

    this.videoEl.currentTime = safeTime;
    await waitForCanPlay(this.videoEl, 1500);
  }

  private applyEffectivePlaybackRate(): void {
    const effective = clampRate(this.basePlaybackRate * this.tempBendMultiplier);
    this.audioEl.playbackRate = effective;
    this.videoEl.playbackRate = effective;
  }

  setPlaybackRate(rate: number, keyLock: boolean): void {
    this.basePlaybackRate = clampRate(rate);
    this.applyEffectivePlaybackRate();
    setElementPreservesPitch(this.audioEl, keyLock);
    setElementPreservesPitch(this.videoEl, keyLock);
  }

  setTemporaryBend(multiplier: number): void {
    this.tempBendMultiplier = Math.min(1.35, Math.max(0.5, multiplier));
    this.applyEffectivePlaybackRate();
  }

  syncDrift(nowMs = Date.now()): boolean {
    if (this.mode !== 'dash-split' || this.mediaKind !== 'video') {
      return false;
    }
    if (this.audioEl.paused || this.videoEl.paused || this.videoEl.readyState < 3) {
      return false;
    }

    const baseRate = clampRate(this.basePlaybackRate * this.tempBendMultiplier);
    const signedDrift = this.audioEl.currentTime - this.videoEl.currentTime;
    const absDrift = Math.abs(signedDrift);

    if (absDrift <= SOFT_DRIFT_DEADBAND_SEC) {
      if (this.videoEl.playbackRate !== baseRate) {
        this.videoEl.playbackRate = baseRate;
      }
      return false;
    }

    if (absDrift <= HARD_DRIFT_THRESHOLD_SEC) {
      const nudgeFactor = 1 + Math.min(0.05, Math.max(-0.05, signedDrift * 0.18));
      this.videoEl.playbackRate = clampRate(baseRate * nudgeFactor);
      return false;
    }

    if (nowMs - this.lastDriftCorrectionMs < HARD_DRIFT_COOLDOWN_MS || this.videoEl.seeking) {
      return false;
    }

    this.videoEl.playbackRate = baseRate;
    this.videoEl.currentTime = this.audioEl.currentTime;
    this.lastDriftCorrectionMs = nowMs;
    return true;
  }

  checkVideoHealth(nowMs = Date.now()): 'ok' | 'resumed' | 'kicked' | 'downgraded' {
    if (this.mode !== 'dash-split' || this.mediaKind !== 'video' || this.audioEl.paused) {
      this.stallStartedMs = null;
      return 'ok';
    }

    if (this.videoEl.paused && this.videoEl.readyState >= 2) {
      void Promise.resolve(this.videoEl.play?.()).catch(() => {});
      return 'resumed';
    }

    const audioDelta = Math.abs(this.audioEl.currentTime - this.lastHealthAudioTime);
    const videoDelta = Math.abs(this.videoEl.currentTime - this.lastHealthVideoTime);
    this.lastHealthAudioTime = this.audioEl.currentTime;

    if (videoDelta >= 0.05) {
      this.lastHealthVideoTime = this.videoEl.currentTime;
      this.stallStartedMs = null;
      return 'ok';
    }

    if (audioDelta > 0.04) {
      if (this.stallStartedMs === null) {
        this.stallStartedMs = nowMs;
        return 'ok';
      }

      if (nowMs - this.stallStartedMs >= STALL_DETECTION_MS) {
        if (this.stallRecoveryCount === 0) {
          this.stallRecoveryCount = 1;
          this.stallStartedMs = nowMs;
          if (this.videoEl.readyState >= 2) {
            this.videoEl.currentTime = this.audioEl.currentTime + 0.12;
          }
          this.lastHealthVideoTime = this.videoEl.currentTime;
          void Promise.resolve(this.videoEl.play?.()).catch(() => {});
          return 'kicked';
        }

        const currentIdx = this.activeQuality ? TIER_ORDER_DESC.indexOf(this.activeQuality) : 1;
        const lowerTier = TIER_ORDER_DESC.slice(Math.max(0, currentIdx + 1)).find(
          (t) => Boolean(this.videoQualityUrls[t])
        );
        if (lowerTier && this.videoQualityUrls[lowerTier]) {
          const nextUrl = this.videoQualityUrls[lowerTier]!;
          this.hotSwapVideoQuality(lowerTier, nextUrl);
          this.onQualityDowngraded?.(
            lowerTier,
            `Video ajustado a ${lowerTier} para mantener fluidez sin cortes`
          );
          return 'downgraded';
        }

        this.stallStartedMs = nowMs;
      }
    }

    return 'ok';
  }

  isEnded(): boolean {
    return Boolean(this.getAudioElement().ended);
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
