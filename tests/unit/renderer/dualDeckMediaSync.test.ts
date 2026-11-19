import { describe, it, expect, vi } from 'vitest';
import { DualDeckMediaSync } from '../../../src/renderer/audio/DualDeckMediaSync';

function createFakeMediaElement(tag: 'audio' | 'video'): HTMLMediaElement {
  const listeners = new Map<string, Set<EventListener>>();
  const el = {
    tagName: tag.toUpperCase(),
    src: '',
    crossOrigin: null as string | null,
    muted: false,
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: true,
    readyState: 4,
    paused: true,
    load: vi.fn(() => {
      const set = listeners.get('canplay');
      if (set) {
        for (const fn of set) fn(new Event('canplay'));
      }
    }),
    play: vi.fn(async () => {
      el.paused = false;
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    }),
    dispatchEvent: vi.fn((evt: Event) => {
      const set = listeners.get(evt.type);
      if (set) {
        for (const fn of set) fn(evt);
      }
      return true;
    })
  };
  return el as unknown as HTMLMediaElement;
}

describe('DualDeckMediaSync', () => {
  it('routes dash-split to audio master + muted video and replicates playbackRate/preservesPitch', async () => {
    const audioEl = createFakeMediaElement('audio') as HTMLAudioElement;
    const videoEl = createFakeMediaElement('video') as HTMLVideoElement;
    const sync = new DualDeckMediaSync('A', { audioEl, videoEl });

    const elements = await sync.load({
      mode: 'dash-split',
      videoUrl: 'http://127.0.0.1:9999/stream/abc12345678/video?token=t',
      audioUrl: 'http://127.0.0.1:9999/stream/abc12345678/audio?token=t'
    });

    expect(elements.audioSourceEl).toBe(audioEl);
    expect(elements.videoEl).toBe(videoEl);
    expect(videoEl.muted).toBe(true);
    expect(videoEl.crossOrigin).toBe('anonymous');
    expect(audioEl.crossOrigin).toBe('anonymous');

    sync.setPlaybackRate(1.06, true);
    expect(audioEl.playbackRate).toBe(1.06);
    expect(videoEl.playbackRate).toBe(1.06);
    expect((audioEl as unknown as { preservesPitch: boolean }).preservesPitch).toBe(true);
    expect((videoEl as unknown as { preservesPitch: boolean }).preservesPitch).toBe(true);
  });

  it('corrects DASH drift > 0.04s with 250ms cooldown and aligns both elements on seek', async () => {
    const audioEl = createFakeMediaElement('audio') as HTMLAudioElement;
    const videoEl = createFakeMediaElement('video') as HTMLVideoElement;
    const sync = new DualDeckMediaSync('B', { audioEl, videoEl });

    await sync.load({
      mode: 'dash-split',
      videoUrl: 'http://127.0.0.1:9999/stream/abc12345678/video?token=t',
      audioUrl: 'http://127.0.0.1:9999/stream/abc12345678/audio?token=t'
    });

    audioEl.currentTime = 12.5;
    videoEl.currentTime = 12.41; // 90ms drift > 40ms
    expect(sync.syncDrift(1000)).toBe(true);
    expect(videoEl.currentTime).toBe(12.5);

    // Within 250ms cooldown -> does not re-correct
    videoEl.currentTime = 12.42;
    expect(sync.syncDrift(1100)).toBe(false);
    expect(videoEl.currentTime).toBe(12.42);

    // Past cooldown -> corrects again
    expect(sync.syncDrift(1300)).toBe(true);
    expect(videoEl.currentTime).toBe(12.5);

    await sync.seek(45.5);
    expect(audioEl.currentTime).toBe(45.5);
    expect(videoEl.currentTime).toBe(45.5);
  });
});

