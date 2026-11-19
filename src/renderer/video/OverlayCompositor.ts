export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface OverlayConfig {
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
    let drewAnything = false;

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

