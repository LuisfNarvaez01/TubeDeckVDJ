import { describe, it, expect, vi } from 'vitest';
import {
  OverlayCompositor,
  createDefaultOverlayConfig
} from '../../../src/renderer/video/OverlayCompositor';

function createMockCtx2d(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'top'
  } as unknown as CanvasRenderingContext2D;
}

describe('OverlayCompositor', () => {
  it('displays track OSD for 6000ms and hides it afterward', () => {
    const compositor = new OverlayCompositor(1280, 720);
    const ctx = createMockCtx2d();

    compositor.triggerTrackOsd('Track 1', 'Artist', 1000);
    const drawnDuring = compositor.render(ctx, 3000);
    expect(drawnDuring).toBe(true);
    expect(ctx.fillText).toHaveBeenCalled();

    const clearCallsBefore = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length;
    const drawnAfter = compositor.render(ctx, 8000);
    expect(drawnAfter).toBe(false);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBe(clearCallsBefore);
  });

  it('advances marquee scroll position proportionally to speedPxPerSec * deltaSec', () => {
    const compositor = new OverlayCompositor(1280, 720);
    const ctx = createMockCtx2d();
    const cfg = createDefaultOverlayConfig();
    cfg.marquee = {
      enabled: true,
      text: 'FIESTA EN VIVO',
      speedPxPerSec: 120,
      color: '#00D4FF',
      bgOpacity: 0.7,
      position: 'bottom'
    };
    compositor.updateConfig(cfg);

    compositor.render(ctx, 1000);
    compositor.render(ctx, 2000);

    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const firstX = calls[0][1] as number;
    const secondX = calls[1][1] as number;
    expect(firstX - secondX).toBeCloseTo(120, 1);
  });
});

