/**
 * "La canción que sigue": what the booth picks as next, what it reports to the phone page
 * (contract `upNext`) and the Screen 2 "A continuación" cue.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SongRequestsSnapshot, UpNextInfo, YouTubeTrack } from '../../../src/shared/types';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { pickUpNext, SongRequestBridge } from '../../../src/renderer/dj/SongRequestBridge';
import { OverlayCompositor } from '../../../src/renderer/video/OverlayCompositor';

function track(videoId: string, title: string, channel = 'Artista - Topic'): YouTubeTrack {
  return { videoId, title, channel, durationSec: 200, thumbnailUrl: '', isLive: false };
}
const A = track('aaaaaaaaaaa', 'KAROL G - BICHOTA (Official Video)', 'KarolGVEVO');
const B = track('bbbbbbbbbbb', 'Normal', 'Feid - Topic');
const C = track('ccccccccccc', 'Provenza', 'KAROL G - Topic');

describe('pickUpNext', () => {
  it('is the first queue item that is not on air and did not fail', () => {
    const queue = [
      { track: A, status: 'loaded' as const },
      { track: B, status: 'failed' as const },
      { track: C, status: 'pending' as const }
    ];
    expect(pickUpNext(queue, A.videoId)).toEqual({ title: 'Provenza', artist: 'KAROL G' });
    expect(pickUpNext(queue, null)).toEqual({ title: A.title, artist: 'KarolG' });
    expect(pickUpNext([], A.videoId)).toBeNull();
  });

  it('prefers a song the DJ loaded by hand on the idle deck', () => {
    expect(pickUpNext([{ track: C, status: 'pending' }], A.videoId, B)).toEqual({ title: 'Normal', artist: 'Feid' });
    // the hand-loaded deck is the one on air: the queue decides
    expect(pickUpNext([{ track: C, status: 'pending' }], B.videoId, B)).toEqual({ title: 'Provenza', artist: 'KAROL G' });
  });

  it('follows the queue engine as songs are queued and reordered', () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(B);
    const c = engine.enqueue(C);
    expect(pickUpNext(engine.getQueue(), A.videoId)?.title).toBe('Normal');
    engine.moveToNext(c.queueId);
    expect(pickUpNext(engine.getQueue(), A.videoId)?.title).toBe('Provenza');
  });
});

describe('SongRequestBridge.observeUpNext', () => {
  function bridgeWith(mode: SongRequestsSnapshot['mode']) {
    const sent: Array<UpNextInfo | null> = [];
    const bridge = new SongRequestBridge({
      api: {
        decide: async () => ({ success: false, error: 'x' }),
        nowPlaying: async () => undefined,
        upNext: async (next) => void sent.push(next)
      },
      queue: { enqueue: () => { throw new Error('no'); }, requestConflict: () => null },
      onQueueChanged: () => undefined
    });
    const snapshot = (m: SongRequestsSnapshot['mode']) =>
      ({ mode: m, prefs: null, desk: null, requests: [] }) as unknown as SongRequestsSnapshot;
    return { bridge, sent, sync: (m: SongRequestsSnapshot['mode']) => bridge.sync(snapshot(m)), start: bridge.sync(snapshot(mode)) };
  }

  it('sends only changes, and only while requests are on', async () => {
    const { bridge, sent, sync, start } = bridgeWith('cloud');
    await start;
    bridge.observeUpNext({ title: 'Normal', artist: 'Feid' });
    bridge.observeUpNext({ title: 'Normal', artist: 'Feid' });
    bridge.observeUpNext(null);
    bridge.observeUpNext(null);
    expect(sent).toEqual([{ title: 'Normal', artist: 'Feid' }, null]);

    await sync('off');
    bridge.observeUpNext({ title: 'Provenza', artist: 'KAROL G' });
    expect(sent).toHaveLength(2);
    // turned back on: the current one goes out again
    await sync('local');
    bridge.observeUpNext(null);
    expect(sent).toEqual([{ title: 'Normal', artist: 'Feid' }, null, null]);
  });
});

function mockCtx() {
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
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textBaseline: 'top'
  } as unknown as CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn>; roundRect: ReturnType<typeof vi.fn> };
}

describe('Screen 2 "A continuación"', () => {
  it('fades in, swaps the text in place and fades out', () => {
    const ov = new OverlayCompositor(1280, 720);
    const ctx = mockCtx();
    expect(ov.render(ctx, 0)).toBe(false);

    ov.setUpNextCue({ title: 'Feid - Normal (Official Video)', artist: 'Feid' }, 1000);
    expect(ov.upNextOpacity(1000)).toBe(0);
    expect(ov.upNextOpacity(1350)).toBeGreaterThan(0);
    expect(ov.upNextOpacity(3000)).toBe(1);
    expect(ov.render(ctx, 3000)).toBe(true);
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).toContain('A CONTINUACIÓN');
    expect(texts).toContain('Feid - Normal');

    // the queue changed while it is up: same card, new text, no new fade
    ov.setUpNextCue({ title: 'Provenza', artist: 'KAROL G' }, 4000);
    expect(ov.upNextOpacity(4000)).toBe(1);
    ctx.fillText.mockClear();
    ov.render(ctx, 4000);
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toContain('Provenza · KAROL G');

    ov.setUpNextCue(null, 5000);
    expect(ov.upNextOpacity(5200)).toBeGreaterThan(0);
    expect(ov.upNextOpacity(6000)).toBe(0);
    ctx.fillText.mockClear();
    expect(ov.render(ctx, 6000)).toBe(false);
  });

  it('slides in normally, but only fades with "reducir movimiento"', () => {
    const xAt = (reduce: boolean): number => {
      const ov = new OverlayCompositor(1280, 720);
      ov.setReducedMotion(reduce);
      const ctx = mockCtx();
      ov.setUpNextCue({ title: 'Provenza', artist: 'KAROL G' }, 0);
      ov.render(ctx, 150);
      return ctx.roundRect.mock.calls[0][0] as number;
    };
    expect(xAt(false)).toBeLessThan(32);
    expect(xAt(true)).toBe(32);
  });

  it('long titles are cut with an ellipsis instead of squeezed', () => {
    const ov = new OverlayCompositor(1280, 720);
    const ctx = mockCtx();
    ov.setUpNextCue({ title: 'x'.repeat(80), artist: 'Artista' }, 0);
    ov.render(ctx, 2000);
    const line = ctx.fillText.mock.calls.map((c) => c[0] as string).find((t) => t.startsWith('xxx'))!;
    expect(line.endsWith('…')).toBe(true);
    expect(line.length * 10).toBeLessThanOrEqual(560);
  });
});
