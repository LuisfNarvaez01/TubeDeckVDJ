import { describe, it, expect, vi } from 'vitest';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import type { YouTubeTrack } from '../../../src/shared/types';

function makeTrack(id: string, title: string): YouTubeTrack {
  return {
    videoId: id,
    title,
    channel: 'DJ Test',
    durationSec: 180,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isLive: false
  };
}

describe('QueueAndAutomixEngine', () => {
  it('preloads 30s before end, triggers crossfade at outro, and auto-skips failing videos', async () => {
    const engine = new QueueAndAutomixEngine();
    const broken = makeTrack('broken00001', 'Broken Video');
    const valid = makeTrack('valid000002', 'Valid Video');
    engine.enqueueMany([broken, valid]);

    const loadDeck = vi.fn(async (_deck, track: YouTubeTrack) => {
      if (track.videoId === 'broken00001') {
        throw new Error('Video unavailable');
      }
    });
    const startTransition = vi.fn(async () => {});
    const onTrackSkipped = vi.fn();

    const options = {
      enabled: true,
      preloadLeadSec: 30,
      crossfadeDurationSec: 8,
      outroTriggerSec: 8
    };

    // At 25s remaining: tries broken -> skips -> auto-loads valid onto Deck B (Review Focus #5)
    await engine.tick('A', 25, true, options, {
      loadDeck,
      startTransition,
      onTrackSkipped
    });

    expect(onTrackSkipped).toHaveBeenCalledTimes(1);
    expect(loadDeck).toHaveBeenCalledWith('B', valid);
    expect(engine.getQueue().find((q) => q.track.videoId === 'broken00001')?.status).toBe('failed');
    expect(engine.getQueue().find((q) => q.track.videoId === 'valid000002')?.status).toBe('loaded');

    // At 7s remaining: triggers transition once from A -> B
    await engine.tick('A', 7, true, options, {
      loadDeck,
      startTransition,
      onTrackSkipped
    });
    await engine.tick('A', 5, true, options, {
      loadDeck,
      startTransition,
      onTrackSkipped
    });

    expect(startTransition).toHaveBeenCalledTimes(1);
    expect(startTransition).toHaveBeenCalledWith('A', 'B', 8);
  });
});
