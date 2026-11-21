import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  LOAD_TIMEOUT_MS,
  QueueAndAutomixEngine,
  type AutomixOptions,
  type AutomixTickContext
} from '../../../src/renderer/dj/QueueAndAutomixEngine';
import type { YouTubeTrack } from '../../../src/shared/types';

function makeTrack(id: string, title: string): YouTubeTrack {
  return { videoId: id, title, channel: 'DJ', durationSec: 200, thumbnailUrl: '', isLive: false };
}

const OPTS: AutomixOptions = {
  enabled: true,
  preloadLeadSec: 30,
  preloadMode: 'immediate',
  crossfadeDurationSec: 8,
  outroTriggerSec: 8,
  autoRadioEnabled: true,
  fadeType: 'smart-crossfade'
};

const ctx = (over: Partial<AutomixTickContext> = {}): AutomixTickContext => ({
  activeDeck: 'A',
  activeVideoId: 'onair000001',
  otherDeckVideoId: null,
  elapsedSec: 60,
  remainingSec: 120,
  isActivePlaying: true,
  isActiveEnded: false,
  ...over
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Automix keeps going', () => {
  it('never sends local-file ids to the recommender and seeds from a YouTube song instead', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.recordPlayed('ytsong00001', 'Earlier Song');
    engine.recordPlayed('local_abcdef123456', 'My File');
    const fetchSuggestedTracks = vi.fn(async () => [makeTrack('fresh000001', 'Fresh Song')]);
    const loadDeck = vi.fn(async () => {});
    await engine.tick(ctx({ activeVideoId: 'local_abcdef123456' }), OPTS, {
      loadDeck,
      startTransition: vi.fn(async () => {}),
      onTrackSkipped: vi.fn(),
      fetchSuggestedTracks
    });
    const [seed, exclude] = fetchSuggestedTracks.mock.calls[0] as unknown as [string, string[]];
    expect(seed).toBe('ytsong00001');
    expect(exclude.every((id) => /^[A-Za-z0-9_-]{11}$/.test(id))).toBe(true);
    expect(loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'fresh000001' }));
  });

  it('rotates to another seed when the radio only returns songs that already played', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.recordPlayed('older000001', 'Older Song');
    engine.recordPlayed('dup00000001', 'Played Already');
    const fetchSuggestedTracks = vi.fn(async (seed: string) =>
      seed === 'onair000001' ? [makeTrack('dup00000001', 'Played Already')] : [makeTrack('new00000001', 'Brand New')]
    );
    const cbs = {
      loadDeck: vi.fn(async () => {}),
      startTransition: vi.fn(async () => {}),
      onTrackSkipped: vi.fn(),
      fetchSuggestedTracks
    };
    await engine.tick(ctx(), OPTS, cbs, 1000);
    expect(cbs.loadDeck).not.toHaveBeenCalled();
    await engine.tick(ctx(), OPTS, cbs, 1250);
    expect(fetchSuggestedTracks.mock.calls[1][0]).not.toBe('onair000001');
    expect(cbs.loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'new00000001' }));
  });

  it('drops the preloaded item once the DJ mixes into that deck by hand', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('next0000001', 'Next Song'));
    engine.enqueue(makeTrack('after000001', 'After Song'));
    const cbs = { loadDeck: vi.fn(async () => {}), startTransition: vi.fn(async () => {}), onTrackSkipped: vi.fn() };
    await engine.tick(ctx(), { ...OPTS, autoRadioEnabled: false }, cbs);
    expect(engine.getQueue()[0].status).toBe('loaded');
    // DJ moved the crossfader: B is on air now.
    await engine.tick(
      ctx({ activeDeck: 'B', activeVideoId: 'next0000001', otherDeckVideoId: 'onair000001' }),
      { ...OPTS, autoRadioEnabled: false, preloadMode: '30s' },
      cbs
    );
    expect(engine.getQueue().map((q) => q.track.videoId)).toEqual(['after000001']);
  });

  it('gives up on a load that hangs so the next tick can run', async () => {
    vi.useFakeTimers();
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('hang0000001', 'Hangs Forever'));
    engine.enqueue(makeTrack('good0000001', 'Loads Fine'));
    const loadDeck = vi.fn((_d: string, t: YouTubeTrack) =>
      t.videoId === 'hang0000001' ? new Promise<void>(() => {}) : Promise.resolve()
    );
    const onTrackSkipped = vi.fn();
    const p = engine.tick(ctx(), { ...OPTS, autoRadioEnabled: false }, {
      loadDeck,
      startTransition: vi.fn(async () => {}),
      onTrackSkipped
    });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 10);
    await p;
    expect(onTrackSkipped).toHaveBeenCalledTimes(1);
    expect(loadDeck).toHaveBeenLastCalledWith('B', expect.objectContaining({ videoId: 'good0000001' }));
  });

  it('keeps a song waiting (not skipped) when the load failed because the internet is down', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('wait0000001', 'Waits For Wifi'));
    const onTrackSkipped = vi.fn();
    await engine.tick(ctx(), { ...OPTS, autoRadioEnabled: false }, {
      loadDeck: vi.fn(async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      }),
      startTransition: vi.fn(async () => {}),
      onTrackSkipped,
      isOffline: () => true
    });
    expect(onTrackSkipped).not.toHaveBeenCalled();
    expect(engine.getQueue()[0].status).toBe('pending');
  });

  it('retries a transition that hung instead of never mixing again', async () => {
    vi.useFakeTimers();
    const engine = new QueueAndAutomixEngine();
    engine.claimDeckForManualLoad('B', makeTrack('mine0000001', 'Mine'));
    let calls = 0;
    const startTransition = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });
    const cbs = { loadDeck: vi.fn(async () => {}), startTransition, onTrackSkipped: vi.fn() };
    const p = engine.tick(ctx({ remainingSec: 5 }), { ...OPTS, autoRadioEnabled: false }, cbs);
    await vi.advanceTimersByTimeAsync(8_000 + 15_010);
    await p;
    await engine.tick(ctx({ remainingSec: 4 }), { ...OPTS, autoRadioEnabled: false }, cbs);
    expect(startTransition).toHaveBeenCalledTimes(2);
  });

  it('mixes out again after the DJ moves the fader back to a deck that already transitioned', async () => {
    const engine = new QueueAndAutomixEngine();
    const off = { ...OPTS, autoRadioEnabled: false };
    const cbs = { loadDeck: vi.fn(async () => {}), startTransition: vi.fn(async () => {}), onTrackSkipped: vi.fn() };
    engine.claimDeckForManualLoad('B', makeTrack('bbbb0000001', 'B song'));
    await engine.tick(ctx({ remainingSec: 5 }), off, cbs); // A -> B
    await engine.tick(ctx({ activeDeck: 'B', activeVideoId: 'bbbb0000001', remainingSec: 100 }), { ...off, preloadMode: '30s' }, cbs);
    engine.claimDeckForManualLoad('B', makeTrack('bbbb0000002', 'B again'));
    await engine.tick(ctx({ remainingSec: 5 }), off, cbs); // DJ is back on A
    expect(cbs.startTransition).toHaveBeenCalledTimes(2);
  });

  it('removes a pending copy of the song that is already on air', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.recordPlayed('onair000001', 'Artist - On Air (Official Video)');
    engine.enqueue(makeTrack('reupload001', 'On Air (Lyrics)'));
    engine.enqueue(makeTrack('other000001', 'Other Song'));
    engine.pruneStale('onair000001');
    expect(engine.getQueue().map((q) => q.track.videoId)).toEqual(['other000001']);
  });
});
