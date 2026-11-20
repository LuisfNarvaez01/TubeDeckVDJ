import { describe, it, expect, vi } from 'vitest';
import {
  QueueAndAutomixEngine,
  type AutomixOptions
} from '../../../src/renderer/dj/QueueAndAutomixEngine';
import type { DeckId, YouTubeTrack } from '../../../src/shared/types';

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

const DEFAULT_OPTS: AutomixOptions = {
  enabled: true,
  preloadLeadSec: 30,
  crossfadeDurationSec: 8,
  outroTriggerSec: 8,
  autoRadioEnabled: false,
  fadeType: 'smart-crossfade'
};

describe('QueueAndAutomixEngine', () => {
  it('preloads 30s before end, auto-skips failing videos, and chains Deck A -> B -> A across multiple queued tracks', async () => {
    const engine = new QueueAndAutomixEngine();
    const broken = makeTrack('broken00001', 'Broken Video');
    const track2 = makeTrack('valid000002', 'Track Two');
    const track3 = makeTrack('valid000003', 'Track Three');
    engine.enqueueMany([broken, track2, track3]);

    const loadDeck = vi.fn(async (_deck: DeckId, track: YouTubeTrack) => {
      if (track.videoId === 'broken00001') {
        throw new Error('Video unavailable');
      }
    });
    const startTransition = vi.fn(async () => {});
    const onTrackSkipped = vi.fn();
    const callbacks = { loadDeck, startTransition, onTrackSkipped };

    // Song 1 on A reaches 25s remaining -> skips broken, preloads track2 onto B
    await engine.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'seed0000001',
        otherDeckVideoId: null,
        remainingSec: 25,
        isActivePlaying: true,
        isActiveEnded: false
      },
      DEFAULT_OPTS,
      callbacks
    );

    expect(onTrackSkipped).toHaveBeenCalledTimes(1);
    expect(loadDeck).toHaveBeenCalledWith('B', track2);
    expect(engine.getQueue().find((q) => q.track.videoId === 'valid000002')?.status).toBe('loaded');

    // Song 1 reaches 6s remaining -> transitions A -> B and removes track2 from queue
    await engine.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'seed0000001',
        otherDeckVideoId: 'valid000002',
        remainingSec: 6,
        isActivePlaying: true,
        isActiveEnded: false
      },
      DEFAULT_OPTS,
      callbacks
    );

    expect(startTransition).toHaveBeenCalledWith('A', 'B', 8, 'smart-crossfade');
    expect(engine.getQueue().some((q) => q.track.videoId === 'valid000002')).toBe(false);

    // Song 2 on B reaches 22s remaining -> preloads track3 onto A
    await engine.tick(
      {
        activeDeck: 'B',
        activeVideoId: 'valid000002',
        otherDeckVideoId: 'seed0000001',
        remainingSec: 22,
        isActivePlaying: true,
        isActiveEnded: false
      },
      DEFAULT_OPTS,
      callbacks
    );

    expect(loadDeck).toHaveBeenCalledWith('A', track3);

    // Song 2 ends naturally before outro window check -> transitions B -> A cleanly
    await engine.tick(
      {
        activeDeck: 'B',
        activeVideoId: 'valid000002',
        otherDeckVideoId: 'valid000003',
        remainingSec: 0,
        isActivePlaying: false,
        isActiveEnded: true
      },
      DEFAULT_OPTS,
      callbacks
    );

    expect(startTransition).toHaveBeenCalledTimes(2);
    expect(startTransition).toHaveBeenLastCalledWith('B', 'A', 8, 'smart-crossfade');
    expect(engine.getQueue().some((q) => q.track.videoId === 'valid000003')).toBe(false);
  });

  it('fetches YouTube Auto-Radio suggestion when queue empties and excludes played history', async () => {
    const engine = new QueueAndAutomixEngine();
    const radioTrack = makeTrack('radio000001', 'Suggested Party Hit');
    const fetchSuggestedTracks = vi.fn(async () => [radioTrack]);
    const onRadioQueued = vi.fn();
    const loadDeck = vi.fn(async () => {});
    const startTransition = vi.fn(async () => {});
    const onTrackSkipped = vi.fn();

    const radioOpts: AutomixOptions = {
      ...DEFAULT_OPTS,
      autoRadioEnabled: true,
      fadeType: 'fade-out-in'
    };

    engine.recordPlayed('played00001');

    await engine.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'seed0000099',
        otherDeckVideoId: null,
        remainingSec: 18,
        isActivePlaying: true,
        isActiveEnded: false
      },
      radioOpts,
      {
        loadDeck,
        startTransition,
        onTrackSkipped,
        fetchSuggestedTracks,
        onRadioQueued
      },
      10_000
    );

    expect(fetchSuggestedTracks).toHaveBeenCalledWith(
      'seed0000099',
      expect.arrayContaining(['played00001', 'seed0000099'])
    );
    expect(onRadioQueued).toHaveBeenCalledWith(radioTrack);
    expect(loadDeck).toHaveBeenCalledWith('B', radioTrack);
    expect(engine.getQueue()[0]?.source).toBe('youtube-radio');

    // Triggers fade-out-in transition at outro
    await engine.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'seed0000099',
        otherDeckVideoId: 'radio000001',
        remainingSec: 4,
        isActivePlaying: true,
        isActiveEnded: false
      },
      radioOpts,
      { loadDeck, startTransition, onTrackSkipped, fetchSuggestedTracks, onRadioQueued },
      11_000
    );

    expect(startTransition).toHaveBeenCalledWith('A', 'B', 8, 'fade-out-in');
  });

  it('preloads immediately after 4s elapsed, supports moveToNext, interleaveBySource, and clear', async () => {
    const engine = new QueueAndAutomixEngine();
    const yt1 = makeTrack('yt000000001', 'YouTube 1');
    const yt2 = makeTrack('yt000000002', 'YouTube 2');
    const loc1: YouTubeTrack = {
      ...makeTrack('local_000001', 'Local 1'),
      source: 'local',
      localFilePath: 'C:\\Music\\track1.mp4',
      mediaKind: 'video'
    };
    const loc2: YouTubeTrack = {
      ...makeTrack('local_000002', 'Local 2'),
      source: 'local',
      localFilePath: 'C:\\Music\\track2.mp3',
      mediaKind: 'audio'
    };

    const items = engine.enqueueMany([yt1, yt2, loc1, loc2]);
    engine.interleaveBySource();
    expect(engine.getQueue().map((q) => q.track.videoId)).toEqual([
      'yt000000001',
      'local_000001',
      'yt000000002',
      'local_000002'
    ]);

    engine.moveToNext(items[3].queueId);
    expect(engine.getQueue()[0].track.videoId).toBe('local_000002');

    const loadDeck = vi.fn(async () => {});
    await engine.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'seed0000001',
        otherDeckVideoId: null,
        elapsedSec: 5,
        remainingSec: 210, // Far more than 30s left!
        isActivePlaying: true,
        isActiveEnded: false
      },
      { ...DEFAULT_OPTS, preloadMode: 'immediate' },
      { loadDeck, startTransition: vi.fn(async () => {}), onTrackSkipped: vi.fn() }
    );
    expect(loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'local_000002' }));

    engine.clear();
    expect(engine.getQueue()).toHaveLength(0);
  });
});
