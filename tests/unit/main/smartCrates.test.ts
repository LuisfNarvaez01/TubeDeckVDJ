import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/main/services/DatabaseService';
import { HistoryAndCratesService } from '../../../src/main/services/HistoryAndCratesService';
import { TasteFeedbackService } from '../../../src/main/services/TasteFeedbackService';
import type { YouTubeTrack } from '../../../src/shared/types';

const DAY = 86_400_000;
const NOW = 100 * DAY;

function yt(id: string, title: string): YouTubeTrack {
  return { videoId: id, title, channel: 'Artista', durationSec: 200, thumbnailUrl: '', isLive: false };
}

describe('smart crates', () => {
  let db: DatabaseService;
  let svc: HistoryAndCratesService;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.init();
    svc = new HistoryAndCratesService(db);
    const s = svc.startSession('Set');
    const play = (videoId: string, title: string, at: number) =>
      svc.logTrackPlay({ sessionId: s.id, deck: 'A', videoId, title, channel: 'Artista', durationSec: 200, playedAt: at });
    play('hit00000001', 'Hit', NOW - 60 * DAY);
    play('hit00000001', 'Hit', NOW - 50 * DAY);
    play('hit00000001', 'Hit', NOW - 40 * DAY);
    play('new00000001', 'Nueva', NOW - 1 * DAY);
    play('local_abcdef', 'Archivo local', NOW - 1 * DAY);
  });

  afterEach(() => db.close());

  it('ranks most played, recent and forgotten from history (YouTube only)', () => {
    expect(svc.getSmartCrate({ kind: 'most-played' }, NOW).map((t) => [t.videoId, t.playCount])).toEqual([
      ['hit00000001', 3],
      ['new00000001', 1]
    ]);
    expect(svc.getSmartCrate({ kind: 'recent' }, NOW)[0].videoId).toBe('new00000001');
    expect(svc.getSmartCrate({ kind: 'forgotten' }, NOW).map((t) => t.videoId)).toEqual(['hit00000001']);
  });

  it('lists liked songs whose latest verdict is a like', () => {
    const taste = new TasteFeedbackService(db);
    taste.recordFeedback({ track: yt('like0000001', 'Me encanta'), signal: 'like' });
    taste.recordFeedback({ track: yt('meh00000001', 'Ya no'), signal: 'like' }, 1);
    taste.recordFeedback({ track: yt('meh00000001', 'Ya no'), signal: 'dislike' }, 2);
    expect(svc.getSmartCrate({ kind: 'liked' }).map((t) => t.videoId)).toEqual(['like0000001']);
  });

  it('matches by Camelot key and tempo, including half/double time', () => {
    db.upsertTrackMetadata({ videoId: 'same0000001', title: 'Mismo', musicalKey: '8A', bpm: 124 });
    db.upsertTrackMetadata({ videoId: 'next0000001', title: 'Vecino', musicalKey: '9A', bpm: 62 });
    db.upsertTrackMetadata({ videoId: 'clash000001', title: 'Choca', musicalKey: '3B', bpm: 124 });
    db.upsertTrackMetadata({ videoId: 'slow0000001', title: 'Lenta', musicalKey: '8A', bpm: 90 });
    const ids = svc.getSmartCrate({ kind: 'match', camelot: '8A', bpm: 124 }).map((t) => t.videoId);
    expect(ids).toEqual(['same0000001', 'next0000001']);
  });
});
