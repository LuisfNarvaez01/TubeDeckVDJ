export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type VideoFramePreset =
  | 'none'
  | 'minimal-studio'
  | 'karaoke-stage'
  | 'gala-gold'
  | 'club-led'
  | 'custom';

export interface OverlayConfig {
  frame: {
    enabled: boolean;
    preset: VideoFramePreset;
    customDataUrl: string | null;
    insetPercent: number;
    accentColor: string;
    titleText: string;
  };
  logo: {
    enabled: boolean;
    dataUrl: string | null;
    corner: OverlayCorner;
    scale: number;
    opacity: number;
  };
  marquee: {
    enabled: boolean;
    text: string;
    speedPxPerSec: number;
    color: string;
    bgOpacity: number;
    position: 'top' | 'bottom';
  };
  osd: {
    enabled: boolean;
    durationMs: number;
  };
  webcam: {
    enabled: boolean;
    deviceId: string;
    corner: OverlayCorner;
    scale: number;
    opacity: number;
  };
}

export function createDefaultOverlayConfig(): OverlayConfig {
  return {
    frame: {
      enabled: false,
      preset: 'minimal-studio',
      customDataUrl: null,
      insetPercent: 8,
      accentColor: '#0EA5E9',
      titleText: ''
    },
    logo: {
      enabled: false,
      dataUrl: null,
      corner: 'top-right',
      scale: 0.14,
      opacity: 0.9
    },
    marquee: {
      enabled: false,
      text: 'TubeDeck VDJ — En Vivo',
      speedPxPerSec: 110,
      color: '#F1F5F9',
      bgOpacity: 0.72,
      position: 'bottom'
    },
    osd: {
      enabled: true,
      durationMs: 6000
    },
    webcam: {
      enabled: false,
      deviceId: '',
      corner: 'bottom-right',
      scale: 0.22,
      opacity: 0.95
    }
  };
}

function cornerCoords(
  corner: OverlayCorner,
  canvasW: number,
  canvasH: number,
  boxW: number,
  boxH: number,
  margin = 24
): { x: number; y: number } {
  const x = corner.endsWith('right') ? canvasW - boxW - margin : margin;
  const y = corner.startsWith('bottom') ? canvasH - boxH - margin : margin;
  return { x, y };
}

export class OverlayCompositor {
  private readonly width: number;
  private readonly height: number;
  private canvas: HTMLCanvasElement | null = null;
  private config: OverlayConfig = createDefaultOverlayConfig();
  private logoImg: HTMLImageElement | null = null;
  private loadedLogoDataUrl: string | null = null;
  private customFrameImg: HTMLImageElement | null = null;
  private loadedFrameDataUrl: string | null = null;

  private osdTitle = '';
  private osdChannel = '';
  private osdTriggeredAtMs = -Infinity;

  private marqueeOffsetPx = 0;
  private lastMarqueeTickMs: number | null = null;

  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    return this.canvas;
  }

  updateConfig(config: OverlayConfig): void {
    this.config = config;
    if (
      config.logo.dataUrl &&
      config.logo.dataUrl !== this.loadedLogoDataUrl &&
      typeof Image !== 'undefined'
    ) {
      this.loadedLogoDataUrl = config.logo.dataUrl;
      const img = new Image();
      img.src = config.logo.dataUrl;
      this.logoImg = img;
    } else if (!config.logo.dataUrl) {
      this.loadedLogoDataUrl = null;
      this.logoImg = null;
    }

    if (
      config.frame?.customDataUrl &&
      config.frame.customDataUrl !== this.loadedFrameDataUrl &&
      typeof Image !== 'undefined'
    ) {
      this.loadedFrameDataUrl = config.frame.customDataUrl;
      const frameImg = new Image();
      frameImg.src = config.frame.customDataUrl;
      this.customFrameImg = frameImg;
    } else if (!config.frame?.customDataUrl) {
      this.loadedFrameDataUrl = null;
      this.customFrameImg = null;
    }
  }

  getVideoInsetRect(): { x: number; y: number; w: number; h: number } {
    const frame = this.config.frame;
    if (!frame || !frame.enabled || frame.preset === 'none') {
      return { x: 0, y: 0, w: 1, h: 1 };
    }
    const pad = Math.min(0.22, Math.max(0.02, (frame.insetPercent || 8) / 100));
    return {
      x: Number(pad.toFixed(4)),
      y: Number(pad.toFixed(4)),
      w: Number((1 - pad * 2).toFixed(4)),
      h: Number((1 - pad * 2).toFixed(4))
    };
  }

  private renderVideoFrame(ctx2d: CanvasRenderingContext2D): boolean {
    const frame = this.config.frame;
    if (!frame || !frame.enabled || frame.preset === 'none') {
      return false;
    }

    const rect = this.getVideoInsetRect();
    const ix = Math.round(rect.x * this.width);
    const iy = Math.round(rect.y * this.height);
    const iw = Math.round(rect.w * this.width);
    const ih = Math.round(rect.h * this.height);

    if (
      frame.preset === 'custom' &&
      this.customFrameImg &&
      this.customFrameImg.complete &&
      this.customFrameImg.naturalWidth > 0
    ) {
      ctx2d.save();
      ctx2d.drawImage(this.customFrameImg, 0, 0, this.width, this.height);
      ctx2d.restore();
      return true;
    }

    const matteColors: Record<Exclude<VideoFramePreset, 'none' | 'custom'>, string> = {
      'minimal-studio': '#0B0D11',
      'karaoke-stage': '#0D121D',
      'gala-gold': '#0E0C0A',
      'club-led': '#07090F'
    };
    const presetKey =
      frame.preset === 'custom' ? 'minimal-studio' : (frame.preset as keyof typeof matteColors);
    const matte = matteColors[presetKey];
    const strokeCol = presetKey === 'gala-gold' ? '#D4AF37' : frame.accentColor || '#0EA5E9';

    ctx2d.save();
    // Draw 4 outer border panels leaving center window transparent so video shows inside
    ctx2d.fillStyle = matte;
    ctx2d.fillRect(0, 0, this.width, iy); // top
    ctx2d.fillRect(0, iy + ih, this.width, this.height - (iy + ih)); // bottom
    ctx2d.fillRect(0, iy, ix, ih); // left
    ctx2d.fillRect(ix + iw, iy, this.width - (ix + iw), ih); // right

    // Inner aperture border + subtle outer bevel
    ctx2d.strokeStyle = strokeCol;
    ctx2d.lineWidth = presetKey === 'minimal-studio' ? 2 : 3;
    ctx2d.strokeRect?.(ix - 1, iy - 1, iw + 2, ih + 2);

    if (presetKey === 'karaoke-stage' || presetKey === 'gala-gold') {
      ctx2d.strokeStyle = presetKey === 'gala-gold' ? 'rgba(212,175,55,0.45)' : 'rgba(248,250,252,0.22)';
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect?.(ix - 8, iy - 8, iw + 16, ih + 16);
    } else if (presetKey === 'club-led') {
      const segs = 16;
      const segW = (iw + 12) / segs;
      for (let i = 0; i < segs; i += 1) {
        ctx2d.fillStyle = i % 2 === 0 ? strokeCol : '#F59E0B';
        ctx2d.fillRect(ix - 6 + i * segW + 2, iy - 10, Math.max(4, segW - 6), 3);
        ctx2d.fillRect(ix - 6 + i * segW + 2, iy + ih + 7, Math.max(4, segW - 6), 3);
      }
    }

    if (frame.titleText.trim() && iy >= 26) {
      ctx2d.fillStyle = '#F8FAFC';
      ctx2d.font = '700 20px Inter, sans-serif';
      ctx2d.textBaseline = 'top';
      const label = frame.titleText.trim().slice(0, 64);
      const tw = ctx2d.measureText(label).width;
      ctx2d.fillText(label, Math.max(16, (this.width - tw) / 2), Math.max(6, Math.round((iy - 22) / 2)));
    }
    ctx2d.restore();
    return true;
  }

  triggerTrackOsd(title: string, channel: string, nowMs = Date.now()): void {
    this.osdTitle = title;
    this.osdChannel = channel;
    this.osdTriggeredAtMs = nowMs;
  }

  render(
    ctx2d: CanvasRenderingContext2D,
    nowMs: number,
    webcamVideo?: HTMLVideoElement | null
  ): boolean {
    ctx2d.clearRect(0, 0, this.width, this.height);
    let drewAnything = this.renderVideoFrame(ctx2d);

    // 1. Webcam PiP
    if (
      this.config.webcam.enabled &&
      webcamVideo &&
      webcamVideo.readyState >= 2 &&
      webcamVideo.videoWidth > 0
    ) {
      const boxW = Math.round(this.width * this.config.webcam.scale);
      const boxH = Math.round(boxW * (webcamVideo.videoHeight / webcamVideo.videoWidth));
      const { x, y } = cornerCoords(this.config.webcam.corner, this.width, this.height, boxW, boxH);
      ctx2d.save();
      ctx2d.globalAlpha = this.config.webcam.opacity;
      ctx2d.beginPath();
      ctx2d.roundRect(x, y, boxW, boxH, 12);
      ctx2d.clip();
      ctx2d.drawImage(webcamVideo, x, y, boxW, boxH);
      ctx2d.restore();
      drewAnything = true;
    }

    // 2. Logo overlay
    if (this.config.logo.enabled && this.logoImg && this.logoImg.complete && this.logoImg.naturalWidth > 0) {
      const boxW = Math.round(this.width * this.config.logo.scale);
      const boxH = Math.round(boxW * (this.logoImg.naturalHeight / this.logoImg.naturalWidth));
      const { x, y } = cornerCoords(this.config.logo.corner, this.width, this.height, boxW, boxH);
      ctx2d.save();
      ctx2d.globalAlpha = this.config.logo.opacity;
      ctx2d.drawImage(this.logoImg, x, y, boxW, boxH);
      ctx2d.restore();
      drewAnything = true;
    }

    // 3. Marquee ticker
    if (this.config.marquee.enabled && this.config.marquee.text.trim().length > 0) {
      if (this.lastMarqueeTickMs === null) {
        this.marqueeOffsetPx = this.width;
      } else {
        const dtSec = Math.max(0, (nowMs - this.lastMarqueeTickMs) / 1000);
        this.marqueeOffsetPx -= this.config.marquee.speedPxPerSec * dtSec;
      }
      this.lastMarqueeTickMs = nowMs;

      const barH = 44;
      const barY = this.config.marquee.position === 'top' ? 0 : this.height - barH;
      ctx2d.save();
      ctx2d.fillStyle = `rgba(11, 14, 20, ${this.config.marquee.bgOpacity})`;
      ctx2d.fillRect(0, barY, this.width, barH);
      ctx2d.font = '600 22px Inter, sans-serif';
      ctx2d.textBaseline = 'top';
      ctx2d.fillStyle = this.config.marquee.color;

      const textWidth = ctx2d.measureText(this.config.marquee.text).width;
      if (this.marqueeOffsetPx < -textWidth) {
        this.marqueeOffsetPx = this.width;
      }
      ctx2d.fillText(this.config.marquee.text, this.marqueeOffsetPx, barY + 10);
      ctx2d.restore();
      drewAnything = true;
    } else {
      this.lastMarqueeTickMs = null;
    }

    // 4. Track OSD banner
    const elapsedOsd = nowMs - this.osdTriggeredAtMs;
    if (this.config.osd.enabled && elapsedOsd >= 0 && elapsedOsd <= this.config.osd.durationMs && this.osdTitle) {
      const fadeIn = Math.min(1, elapsedOsd / 350);
      const fadeOut = Math.min(1, (this.config.osd.durationMs - elapsedOsd) / 450);
      const alpha = Math.max(0, Math.min(fadeIn, fadeOut));

      ctx2d.save();
      ctx2d.globalAlpha = alpha;
      const boxW = Math.min(this.width - 80, 620);
      const boxH = 74;
      const x = 32;
      const y = this.height - boxH - 58;
      ctx2d.fillStyle = 'rgba(11, 14, 20, 0.85)';
      ctx2d.beginPath();
      ctx2d.roundRect(x, y, boxW, boxH, 10);
      ctx2d.fill();

      ctx2d.fillStyle = '#00D4FF';
      ctx2d.font = '700 13px Inter, sans-serif';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText('AHORA SUENA', x + 16, y + 12);

      ctx2d.fillStyle = '#F1F5F9';
      ctx2d.font = '600 18px Inter, sans-serif';
      ctx2d.fillText(this.osdTitle.slice(0, 56), x + 16, y + 30);

      ctx2d.fillStyle = '#94A3B8';
      ctx2d.font = '400 13px Inter, sans-serif';
      ctx2d.fillText(this.osdChannel, x + 16, y + 52);
      ctx2d.restore();
      drewAnything = true;
    }

    return drewAnything;
  }
}

