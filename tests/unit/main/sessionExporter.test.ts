import { describe, it, expect } from 'vitest';
import { SessionExporter } from '../../../src/main/services/SessionExporter';
import type { HistoryEntry, MixSession } from '../../../src/shared/types';

describe('SessionExporter', () => {
  const session: MixSession = {
    id: 'sess-1',
    title: 'Set Sabado',
    startedAt: 1700000000000,
    endedAt: 1700003600000,
    notes: ''
  };

  const entries: HistoryEntry[] = [
    {
      id: 'h1',
      sessionId: 'sess-1',
      deck: 'A',
      videoId: 'dQw4w9WgXcQ',
      title: 'Track, "Remix"',
      channel: 'DJ, Test',
      durationSec: 210,
      playedAt: 1700000000000,
      endedAt: null,
      bpm: 128,
      transitionUsed: 'dissolve'
    }
  ];

  it('formats CSV with RFC4180 quote escaping, valid M3U, and valid JSON', () => {
    const exporter = new SessionExporter();

    const csv = exporter.formatSession(session, entries, 'csv');
    expect(csv).toContain('"Track, ""Remix"""');
    expect(csv).toContain('"DJ, Test"');

    const m3u = exporter.formatSession(session, entries, 'm3u');
    expect(m3u.startsWith('#EXTM3U')).toBe(true);
    expect(m3u).toContain('#EXTINF:210,DJ, Test - Track, "Remix"');
    expect(m3u).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const jsonStr = exporter.formatSession(session, entries, 'json');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.session.id).toBe('sess-1');
    expect(parsed.entries).toHaveLength(1);
  });
});
