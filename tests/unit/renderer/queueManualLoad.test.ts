import { describe, it, expect, vi } from 'vitest';
import {
  DeckLoadSupersededError,
  QueueAndAutomixEngine,
  type AutomixOptions,
  type AutomixTickContext
} from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { looseSongKey } from '../../../src/shared/songIdentity';
import type { DeckId, YouTubeTrack } from '../../../src/shared/types';

function makeTrack(id: string, title: string): YouTubeTrack {
  return {
    videoId: id,
    title,
    channel: 'DJ Test',
    durationSec: 200,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isLive: false
  };
}

const OPTS: AutomixOptions = {
  enabled: true,
  preloadLeadSec: 30,
  preloadMode: 'immediate',
  crossfadeDurationSec: 8,
  outroTriggerSec: 8,
  autoRadioEnabled: false,
  fadeType: 'smart-crossfade'
};

const playingOnA = (remainingSec = 120): AutomixTickContext => ({
  activeDeck: 'A',
  activeVideoId: 'onair000001',
  otherDeckVideoId: null,
  elapsedSec: 60,
  remainingSec,
  isActivePlaying: true,
  isActiveEnded: false
});

describe('manual deck loads vs Automix', () => {
  it('never overwrites a deck the DJ loaded by hand, and mixes into it', async () => {
    const engine = new QueueAndAutomixEngine();
    const queued = makeTrack('queued00001', 'Queued Song');
    engine.enqueue(queued);
    const mine = makeTrack('manual00001', 'My Pick');
    engine.claimDeckForManualLoad('B', mine);

    const loadDeck = vi.fn(async () => {});
    const startTransition = vi.fn(async () => {});
    const callbacks = { loadDeck, startTransition, onTrackSkipped: vi.fn() };

    await engine.tick(playingOnA(), OPTS, callbacks);
    expect(loadDeck).not.toHaveBeenCalled();

    await engine.tick(playingOnA(5), OPTS, callbacks);
    expect(startTransition).toHaveBeenCalledWith('A', 'B', 8, 'smart-crossfade');
    expect(engine.getQueue().map((q) => q.track.videoId)).toEqual(['queued00001']);
  });

  it('puts a preloaded queue song back to waiting when the DJ replaces it', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('queued00001', 'Queued Song'));
    const callbacks = { loadDeck: vi.fn(async () => {}), startTransition: vi.fn(async () => {}), onTrackSkipped: vi.fn() };
    await engine.tick(playingOnA(), OPTS, callbacks);
    expect(engine.getQueue()[0].status).toBe('loaded');

    engine.claimDeckForManualLoad('B', makeTrack('manual00001', 'My Pick'));
    expect(engine.getQueue()[0].status).toBe('pending');
  });

  it('keeps the queue song waiting when its preload was superseded by a manual load', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('queued00001', 'Queued Song'));
    const loadDeck = vi.fn(async (deck: DeckId) => {
      throw new DeckLoadSupersededError(deck);
    });
    const onTrackSkipped = vi.fn();
    await engine.tick(playingOnA(), OPTS, { loadDeck, startTransition: vi.fn(), onTrackSkipped });
    expect(onTrackSkipped).not.toHaveBeenCalled();
    expect(engine.getQueue()[0].status).toBe('pending');
  });

  it('removes pending copies of a song the DJ loads by hand', () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('vid00000001', 'Marc Anthony - Vivir Mi Vida (Official Video)'));
    engine.enqueue(makeTrack('other000001', 'Otra'));
    engine.claimDeckForManualLoad('B', makeTrack('vid00000002', 'Vivir Mi Vida [Letra]'));
    expect(engine.getQueue().map((q) => q.track.videoId)).toEqual(['other000001']);
  });

  it('eject drops the queue song that sat on the deck', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.enqueue(makeTrack('queued00001', 'Queued Song'));
    await engine.tick(playingOnA(), OPTS, { loadDeck: vi.fn(async () => {}), startTransition: vi.fn(), onTrackSkipped: vi.fn() });
    engine.releaseDeck('B');
    expect(engine.getQueue()).toHaveLength(0);
  });
});

describe('radio repeats', () => {
  it('skips radio suggestions of a song already played under another upload', async () => {
    const engine = new QueueAndAutomixEngine();
    engine.recordPlayed('official001', 'Daddy Yankee - Gasolina (Video Oficial)');
    const fetchSuggestedTracks = vi.fn(async () => [
      makeTrack('lyric000001', 'Gasolina (Letra)'),
      makeTrack('fresh000001', 'Rompe')
    ]);
    const loadDeck = vi.fn(async () => {});
    await engine.tick(
      playingOnA(),
      { ...OPTS, autoRadioEnabled: true },
      { loadDeck, startTransition: vi.fn(), onTrackSkipped: vi.fn(), fetchSuggestedTracks }
    );
    expect(loadDeck).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'fresh000001' }));
  });

  it('looseSongKey ignores artist prefix, brackets and upload labels', () => {
    expect(looseSongKey('Marc Anthony - Vivir Mi Vida (Official Video)')).toBe(looseSongKey('Vivir mi vida [Letra]'));
    expect(looseSongKey('Canción')).toBe('cancion');
  });
});
