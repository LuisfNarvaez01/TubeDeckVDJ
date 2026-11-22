import { describe, it, expect, vi } from 'vitest';
import {
  QueueAndAutomixEngine,
  type AutomixCallbacks,
  type AutomixOptions,
  type AutomixTickContext
} from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { pickSimilarTrack, similarityScore } from '../../../src/renderer/dj/localFallback';
import type { YouTubeTrack } from '../../../src/shared/types';

const yt = (id: string, title: string, channel = 'DJ'): YouTubeTrack => ({
  videoId: id, title, channel, durationSec: 200, thumbnailUrl: '', isLive: false
});
const local = (id: string, title: string, channel = 'Carpeta'): YouTubeTrack => ({
  ...yt(id, title, channel), source: 'local'
});

const OPTS: AutomixOptions = {
  enabled: true, preloadLeadSec: 30, preloadMode: 'immediate', crossfadeDurationSec: 8,
  outroTriggerSec: 8, autoRadioEnabled: true, fadeType: 'smart-crossfade'
};
const ctx = (over: Partial<AutomixTickContext> = {}): AutomixTickContext => ({
  activeDeck: 'A', activeVideoId: 'onair000001', otherDeckVideoId: null, elapsedSec: 60,
  remainingSec: 120, isActivePlaying: true, isActiveEnded: false,
  activeTitle: 'Marc Anthony - Vivir Mi Vida (Official Video)', activeChannel: 'Marc Anthony', ...over
});
const LIBRARY = [
  local('local_000000000001', 'Grupo Niche - Cali Pachanguero'),
  local('local_000000000002', 'Marc Anthony - Valió La Pena'),
  local('local_000000000003', 'Karol G - Bichota')
];
const cbs = (over: Partial<AutomixCallbacks> = {}): AutomixCallbacks => ({
  loadDeck: vi.fn(async () => {}),
  startTransition: vi.fn(async () => {}),
  onTrackSkipped: vi.fn(),
  getFallbackTracks: () => LIBRARY,
  ...over
});

describe('backup songs keep the music going', () => {
  it('prefers the same artist when choosing a similar song', () => {
    const seed = { title: 'Marc Anthony - Vivir Mi Vida', channel: 'Marc Anthony' };
    expect(similarityScore(seed, LIBRARY[1])).toBeGreaterThan(similarityScore(seed, LIBRARY[0]));
    expect(pickSimilarTrack(seed, LIBRARY, () => false, () => 0)?.videoId).toBe('local_000000000002');
  });

  it('plays a similar local song first when offline with only YouTube songs waiting', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.random = () => 0;
    engine.enqueue(yt('waityt00001', 'Needs Internet'));
    const c = cbs({ isOffline: () => true });
    await engine.tick(ctx(), OPTS, c);
    expect(c.loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'local_000000000002' }));
    expect(engine.getQueue().some((q) => q.track.videoId === 'waityt00001' && q.status === 'pending')).toBe(true);
  });

  it('uses a cached YouTube song offline instead of a local one when it is queued', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(yt('cached00001', 'Saved Song'));
    const c = cbs({ isOffline: () => true, canPlayOffline: (t) => t.videoId === 'cached00001' });
    await engine.tick(ctx(), OPTS, c);
    expect(c.loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'cached00001' }));
  });

  it('adds a backup song as the track ends even with the radio off and the queue empty', async () => {
    const engine = new QueueAndAutomixEngine();
    const c = cbs();
    await engine.tick(ctx(), { ...OPTS, autoRadioEnabled: false }, c);
    expect(c.loadDeck).not.toHaveBeenCalled();
    await engine.tick(ctx({ remainingSec: 20 }), { ...OPTS, autoRadioEnabled: false }, c);
    expect(c.loadDeck).toHaveBeenCalledTimes(1);
  });

  it('falls back to a local song when the radio finds nothing', async () => {
    const engine = new QueueAndAutomixEngine();
    const c = cbs({ fetchSuggestedTracks: vi.fn(async () => []) });
    await engine.tick(ctx({ remainingSec: 15 }), OPTS, c);
    expect(c.loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ source: 'local' }));
  });

  it('local mode never asks YouTube', async () => {
    const engine = new QueueAndAutomixEngine();
    const fetchSuggestedTracks = vi.fn(async () => [yt('ytradio0001', 'Radio Song')]);
    const c = cbs({ fetchSuggestedTracks });
    await engine.tick(ctx(), { ...OPTS, sourceMode: 'local' }, c);
    expect(fetchSuggestedTracks).not.toHaveBeenCalled();
    expect(c.loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ source: 'local' }));
  });

  it('autopilot alternates YouTube radio and local songs', async () => {
    const engine = new QueueAndAutomixEngine();
    let n = 0;
    const fetchSuggestedTracks = vi.fn(async () => [yt(`ytradio000${++n}`, `Radio Song ${n}`)]);
    const loaded: YouTubeTrack[] = [];
    const c = cbs({ fetchSuggestedTracks, loadDeck: vi.fn(async (_d, t) => void loaded.push(t)) });
    const auto = { ...OPTS, sourceMode: 'autopilot' as const };
    await engine.tick(ctx(), auto, c);
    // B came on air with the first pick; the next one goes to A.
    await engine.tick(ctx({ remainingSec: 5 }), auto, c);
    await engine.tick(ctx({ activeDeck: 'B', activeVideoId: loaded[0].videoId, activeTitle: loaded[0].title }), auto, c);
    expect(loaded.map((t) => t.source === 'local')).toEqual([false, true]);
  });
});
