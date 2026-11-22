import { describe, expect, it, vi } from 'vitest';
import { rankDjSuggestions, type PlayRow, type TrackFacts } from '../../../src/main/services/DjSuggestionService';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {}, shell: {}, BrowserWindow: {} }));

const DAY = 86_400_000;
// "Now" is 23:00 on some day; history is from earlier nights.
const now = new Date(2026, 10, 22, 23, 0).getTime();
const at = (daysAgo: number, hour: number, min = 0): number => {
  const d = new Date(now - daysAgo * DAY);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};
const play = (session: string, id: string, t: number, channel = 'Artist'): PlayRow => ({
  sessionId: session, videoId: id, title: `Song ${id}`, channel, durationSec: 200, playedAt: t
});

const base = {
  facts: new Map<string, TrackFacts>(),
  liked: new Set<string>(),
  disliked: new Set<string>(),
  blockedNames: new Set<string>(),
  nowMs: now
};

describe('DJ suggestions from history', () => {
  it('puts first what the DJ usually plays right after the song on air', () => {
    const plays = [
      play('s1', 'onair000001', at(7, 22)), play('s1', 'nextup00001', at(7, 22, 4)),
      play('s2', 'onair000001', at(14, 22)), play('s2', 'nextup00001', at(14, 22, 4)),
      play('s2', 'random00001', at(14, 15))
    ];
    const out = rankDjSuggestions({ ...base, plays, request: { onAirVideoId: 'onair000001' } });
    expect(out.suggestions[0].videoId).toBe('nextup00001');
    expect(out.suggestions[0].reasons).toContain('follows');
    expect(out.suggestions.some((s) => s.videoId === 'onair000001')).toBe(false);
  });

  it('prefers songs played at this hour and skips what was heard tonight, disliked or blocked', () => {
    const plays = [
      play('s1', 'night000001', at(3, 23)), play('s2', 'night000001', at(10, 0, 30)),
      play('s1', 'noon0000001', at(3, 12)), play('s2', 'noon0000001', at(10, 12)),
      play('s3', 'tonight0001', now - 3_600_000),
      play('s1', 'disliked001', at(3, 23)), play('s1', 'blocked0001', at(3, 23), 'Blocked Guy')
    ];
    const out = rankDjSuggestions({
      ...base,
      disliked: new Set(['disliked001']),
      blockedNames: new Set(['blocked guy']),
      plays,
      request: {}
    });
    const ids = out.suggestions.map((s) => s.videoId);
    expect(ids[0]).toBe('night000001');
    expect(out.suggestions[0].reasons).toContain('this-hour');
    expect(ids).not.toContain('tonight0001');
    expect(ids).not.toContain('disliked001');
    expect(ids).not.toContain('blocked0001');
  });

  it('rewards a compatible key and BPM, and reports the usual tempo at this hour', () => {
    const plays = [
      play('s1', 'fits0000001', at(5, 22, 50)), play('s1', 'clash000001', at(5, 22, 55)),
      play('s1', 'third000001', at(5, 23, 5))
    ];
    const facts = new Map<string, TrackFacts>([
      ['fits0000001', { bpm: 100, key: '8A', thumbnailUrl: '' }],
      ['clash000001', { bpm: 140, key: '2B', thumbnailUrl: '' }],
      ['third000001', { bpm: 102, key: null, thumbnailUrl: '' }]
    ]);
    const out = rankDjSuggestions({ ...base, facts, plays, request: { onAirKey: '8A', onAirBpm: 100 } });
    expect(out.suggestions[0].videoId).toBe('fits0000001');
    expect(out.suggestions[0].reasons).toEqual(expect.arrayContaining(['key', 'bpm']));
    expect(out.typicalBpm).toBe(102);
  });
});
