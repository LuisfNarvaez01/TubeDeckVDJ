import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseService } from '../../../src/main/services/DatabaseService';
import {
  RecommendationEngine,
  rankRadioCandidates,
  songKey,
  type SourceResult
} from '../../../src/main/services/RecommendationEngine';
import { TasteFeedbackService, nameKey, splitArtistKeys } from '../../../src/main/services/TasteFeedbackService';
import { normalizeMusicPanelItem } from '../../../src/main/services/YouTubeSearchService';
import type { HistoryTasteProfile, YouTubeTrack } from '../../../src/shared/types';

const EMPTY_PROFILE: HistoryTasteProfile = {
  totalPlays: 0,
  topChannels: [],
  topKeywords: [],
  avgDurationSec: 210,
  recentVideoIds: []
};

let counter = 0;
function track(partial: Partial<YouTubeTrack> & { title: string; channel: string }): YouTubeTrack {
  counter += 1;
  const id = (partial.videoId ?? `vid${String(counter).padStart(8, '0')}`).slice(0, 11);
  return {
    videoId: id,
    durationSec: 210,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isLive: false,
    ...partial
  };
}

function emptySnapshot() {
  return {
    likedVideoIds: [] as string[],
    dislikedVideoIds: new Set<string>(),
    blockedNames: new Set<string>(),
    affinity: new Map<string, number>(),
    seeds: []
  };
}

function source(tracks: YouTubeTrack[], videoId = 'seed0000001'): SourceResult {
  return { seed: { videoId, kind: 'current', weight: 1, title: 'Seed' }, origin: 'music', tracks };
}

describe('name helpers', () => {
  it('normalizes channel names and splits collaborations', () => {
    expect(nameKey('Bad Bunny - Topic')).toBe('bad bunny');
    expect(nameKey('DaddyYankeeVEVO')).toBe('daddyyankee');
    expect(splitArtistKeys('KAROL G, Anuel AA & Daddy Yankee')).toEqual(['karol g', 'anuel aa', 'daddy yankee']);
    expect(splitArtistKeys('whatever', ['Shakira'])).toEqual(['shakira']);
  });

  it('shortens seed titles for the reason label', async () => {
    const { shortSongTitle } = await import('../../../src/main/services/RecommendationEngine');
    expect(shortSongTitle('Marc Anthony - Vivir Mi Vida (Official Video)')).toBe('Vivir Mi Vida');
    expect(shortSongTitle('Marc Anthony | Los Exitos Mas Grandes | Salsa')).toBe('Marc Anthony');
  });

  it('treats different uploads of the same song as duplicates', () => {
    const a = track({ title: 'Despacito (Official Video)', channel: 'Luis Fonsi' });
    const b = track({ title: 'Despacito [Audio]', channel: 'Luis Fonsi - Topic' });
    expect(songKey(a)).toBe(songKey(b));
  });
});

describe('normalizeMusicPanelItem', () => {
  it('prefers the music-video counterpart over square album art', () => {
    const t = normalizeMusicPanelItem({
      primary: {
        video_id: 'songAAAAAAA',
        title: 'Song',
        author: 'Artist',
        duration: { seconds: 200 },
        thumbnail: [{ url: 'https://lh3.googleusercontent.com/x', width: 60, height: 60 }]
      },
      counterpart: [
        {
          video_id: 'videoBBBBBB',
          title: 'Song',
          author: 'Artist',
          artists: [{ name: 'Artist' }],
          duration: { seconds: 205 },
          thumbnail: [{ url: 'https://i.ytimg.com/vi/videoBBBBBB/hq720.jpg', width: 853, height: 479 }]
        }
      ]
    });
    expect(t?.videoId).toBe('videoBBBBBB');
    expect(t?.artists).toEqual(['Artist']);
  });
});

describe('rankRadioCandidates', () => {
  it('drops junk (reactions, tutorials, too long), disliked and blocked items', () => {
    const good = track({ title: 'Con Calma', channel: 'Daddy Yankee' });
    const reaction = track({ title: 'REACCIÓN a Con Calma', channel: 'Random Guy' });
    const tutorial = track({ title: 'Cómo bailar reggaeton tutorial', channel: 'Dance School' });
    const longMix = track({ title: 'Reggaeton Mix 2024', channel: 'DJ Mix', durationSec: 3600 });
    const disliked = track({ title: 'Song I hate', channel: 'Someone' });
    const blocked = track({ title: 'Nice song', channel: 'Blocked Channel' });

    const snapshot = emptySnapshot();
    snapshot.dislikedVideoIds.add(disliked.videoId);
    snapshot.blockedNames.add('blocked channel');

    const result = rankRadioCandidates(
      [source([reaction, tutorial, longMix, disliked, blocked, good])],
      snapshot,
      EMPTY_PROFILE
    );
    expect(result.map((t) => t.videoId)).toEqual([good.videoId]);
    expect(result[0].recommendReason).toContain('Seed');
  });

  it('boosts liked artists and sinks disliked ones', () => {
    const a = track({ title: 'Track A', channel: 'Artist A' });
    const b = track({ title: 'Track B', channel: 'Artist B' });
    const c = track({ title: 'Track C', channel: 'Artist C' });
    const snapshot = emptySnapshot();
    snapshot.affinity.set('artist c', 6);
    snapshot.affinity.set('artist a', -8);

    const fillers = Array.from({ length: 47 }, (_, i) => track({ title: `Filler ${i}`, channel: `Filler ${i}` }));
    // c sits 5 places lower than b in a realistic-length radio list
    const list = [a, b, ...fillers.slice(0, 4), c, ...fillers.slice(4)];
    const result = rankRadioCandidates([source(list)], snapshot, EMPTY_PROFILE, { limit: 60 });
    expect(result[0].videoId).toBe(c.videoId);
    expect(result[0].recommendReason).toBe('Te gusta Artist C');
    expect(result.findIndex((t) => t.videoId === a.videoId)).toBeGreaterThan(result.findIndex((t) => t.videoId === b.videoId));
  });

  it('rewards songs that several seed radios agree on and caps tracks per artist', () => {
    const shared = track({ title: 'Shared hit', channel: 'Other' });
    const same = [1, 2, 3, 4].map((i) => track({ title: `Hit ${i}`, channel: 'Same Artist' }));
    const sources: SourceResult[] = [
      source([same[0], same[1], shared, same[2], same[3]], 'seed0000001'),
      { seed: { videoId: 'seed0000002', kind: 'session', weight: 0.55 }, origin: 'music', tracks: [shared] }
    ];
    const result = rankRadioCandidates(sources, emptySnapshot(), EMPTY_PROFILE, { limit: 3 });
    expect(result[0].videoId).toBe(shared.videoId);
    expect(result.filter((t) => t.channel === 'Same Artist')).toHaveLength(2);
  });

  it('avoids recently played tracks unless nothing else is left', () => {
    const recentTrack = track({ title: 'Recent', channel: 'X' });
    const fresh = track({ title: 'Fresh', channel: 'Y' });
    const profile = { ...EMPTY_PROFILE, recentVideoIds: [recentTrack.videoId] };
    const many = rankRadioCandidates(
      [source([recentTrack, fresh, track({ title: 'F2', channel: 'Z' }), track({ title: 'F3', channel: 'W' }), track({ title: 'F4', channel: 'V' })])],
      emptySnapshot(),
      profile
    );
    expect(many.map((t) => t.videoId)).not.toContain(recentTrack.videoId);
  });
});

describe('RecommendationEngine', () => {
  it('queries YouTube Music radios for several seeds and falls back to related videos', async () => {
    const musicTrack = track({ title: 'Music hit', channel: 'Pro Artist' });
    const relatedTrack = track({ title: 'Related video', channel: 'Some channel' });
    const getMusicRadio = vi.fn(async (id: string) => (id === 'curr0000001' ? [] : [musicTrack]));
    const getRelatedTracks = vi.fn(async () => [relatedTrack]);
    const engine = new RecommendationEngine(
      { getMusicRadio, getRelatedTracks },
      {
        getSnapshot: () => ({ ...emptySnapshot(), likedVideoIds: ['like0000001'] }),
        buildTasteProfile: () => ({ ...EMPTY_PROFILE, recentVideoIds: ['sess0000001'] })
      },
      () => 0,
      () => 0
    );

    const result = await engine.recommend({ seedVideoId: 'curr0000001', seedTitle: 'Current' });
    expect(getMusicRadio).toHaveBeenCalledWith('curr0000001', 50);
    expect(getMusicRadio).toHaveBeenCalledWith('sess0000001', 50);
    expect(getMusicRadio).toHaveBeenCalledWith('like0000001', 50);
    expect(getRelatedTracks).toHaveBeenCalledTimes(1);
    expect(result.map((t) => t.videoId)).toEqual(expect.arrayContaining([musicTrack.videoId, relatedTrack.videoId]));
  });
});

describe('TasteFeedbackService', () => {
  let db: DatabaseService;
  let service: TasteFeedbackService;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.init();
    service = new TasteFeedbackService(db);
  });

  afterEach(() => db.close());

  it('turns likes, dislikes and skips into artist affinity', () => {
    const now = Date.now();
    service.recordFeedback({ track: { videoId: 'aaaaaaaaaaa', title: 'A', channel: 'Good Artist' }, signal: 'like' }, now);
    service.recordFeedback({ track: { videoId: 'bbbbbbbbbbb', title: 'B', channel: 'Bad Artist' }, signal: 'dislike' }, now);
    service.recordFeedback({ track: { videoId: 'ccccccccccc', title: 'C', channel: 'Meh Artist' }, signal: 'skip' }, now);

    const snap = service.getSnapshot(now);
    expect(snap.likedVideoIds).toEqual(['aaaaaaaaaaa']);
    expect(snap.dislikedVideoIds.has('bbbbbbbbbbb')).toBe(true);
    expect(snap.affinity.get('good artist')).toBeCloseTo(3);
    expect(snap.affinity.get('bad artist')).toBeCloseTo(-4);
    expect(snap.affinity.get('meh artist')).toBeCloseTo(-1.5);
  });

  it('a like replaces an earlier dislike of the same video', () => {
    const t = { videoId: 'aaaaaaaaaaa', title: 'A', channel: 'Artist' };
    service.recordFeedback({ track: t, signal: 'dislike' });
    service.recordFeedback({ track: t, signal: 'like' });
    const snap = service.getSnapshot();
    expect(snap.dislikedVideoIds.has('aaaaaaaaaaa')).toBe(false);
    expect(snap.likedVideoIds).toEqual(['aaaaaaaaaaa']);
  });

  it('stores up to 10 reference songs and blocks channels', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => ({
      videoId: `seed${String(i).padStart(7, '0')}`,
      title: `Seed ${i}`,
      channel: `Artist ${i}`,
      durationSec: 200,
      thumbnailUrl: ''
    }));
    expect(service.setTasteSeeds(seeds)).toHaveLength(10);
    expect(service.getTasteSeeds()[0].title).toBe('Seed 0');
    expect(service.getSnapshot().affinity.get('artist 0')).toBeGreaterThan(0);

    service.recordFeedback({ track: { videoId: 'ddddddddddd', title: 'D', channel: 'Spam Channel' }, signal: 'block-channel' });
    expect(service.getSnapshot().blockedNames.has('spam channel')).toBe(true);
    expect(service.getSummary().blockedChannels).toEqual(['Spam Channel']);
    service.unblockChannel('Spam Channel');
    expect(service.getSnapshot().blockedNames.size).toBe(0);
  });
});
