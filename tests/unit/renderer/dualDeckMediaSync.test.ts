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
    seeking: false,
    ended: false,
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

  it('soft-nudges small DASH drift without seeking and hard-seeks only on >0.65s drift with 2500ms cooldown', async () => {
    const audioEl = createFakeMediaElement('audio') as HTMLAudioElement;
    const videoEl = createFakeMediaElement('video') as HTMLVideoElement;
    const sync = new DualDeckMediaSync('B', { audioEl, videoEl });

    await sync.load({
      mode: 'dash-split',
      videoUrl: 'http://127.0.0.1:9999/stream/abc12345678/video?token=t',
      audioUrl: 'http://127.0.0.1:9999/stream/abc12345678/audio?token=t'
    });
    await sync.play();

    // Small 150ms drift (<= 0.65s): softly nudges video playbackRate without touching currentTime
    audioEl.currentTime = 12.5;
    videoEl.currentTime = 12.35;
    expect(sync.syncDrift(1000)).toBe(false);
    expect(videoEl.currentTime).toBe(12.35);
    expect(videoEl.playbackRate).toBeGreaterThan(1);

    // Drift back within <= 60ms: restores nominal video playbackRate
    videoEl.currentTime = 12.48;
    expect(sync.syncDrift(1200)).toBe(false);
    expect(videoEl.playbackRate).toBe(1);

    // Large drift (> 0.65s): performs hard seek once, then enforces 2500ms cooldown
    audioEl.currentTime = 20.0;
    videoEl.currentTime = 19.1;
    expect(sync.syncDrift(1500)).toBe(true);
    expect(videoEl.currentTime).toBe(20.0);

    videoEl.currentTime = 19.1;
    expect(sync.syncDrift(2500)).toBe(false);
    expect(videoEl.currentTime).toBe(19.1);

    expect(sync.syncDrift(4100)).toBe(true);
    expect(videoEl.currentTime).toBe(20.0);

    // Temporary jog bend scales base playbackRate and restores cleanly
    sync.setPlaybackRate(1.04, true);
    sync.setTemporaryBend(1.03);
    expect(audioEl.playbackRate).toBeCloseTo(1.04 * 1.03, 5);
    expect(videoEl.playbackRate).toBeCloseTo(1.04 * 1.03, 5);
    sync.setTemporaryBend(1);
    expect(audioEl.playbackRate).toBeCloseTo(1.04, 5);

    expect(sync.isEnded()).toBe(false);
    (audioEl as unknown as { ended: boolean }).ended = true;
    expect(sync.isEnded()).toBe(true);

    await sync.seek(45.5);
    expect(audioEl.currentTime).toBe(45.5);
    expect(videoEl.currentTime).toBe(45.5);
  });
});

