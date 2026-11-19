import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseService } from '../../../src/main/services/DatabaseService';

describe('DatabaseService (sql.js WASM)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('creates all 7 schema tables and enforces foreign keys in memory', async () => {
    const db = new DatabaseService(':memory:');
    await db.init();

    const tables = db
      .queryAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_version',
        'sessions',
        'history_entries',
        'track_metadata',
        'crates',
        'crate_tracks',
        'midi_mappings',
        'app_settings'
      ])
    );

    const fk = db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);

    expect(() =>
      db.run(
        `INSERT INTO history_entries (id, session_id, deck, video_id, title, channel, duration_sec, played_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['h1', 'missing-session', 'A', 'dQw4w9WgXcQ', 'Test', 'Chan', 120, 1000]
      )
    ).toThrow();

    db.close();
  });

  it('persists settings and track metadata with hotCues across atomic disk saves', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-db-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'tubedeck.db');

    const db1 = new DatabaseService(dbPath);
    await db1.init();

    db1.setSetting('audio.masterDevice', { deviceId: 'usb-1', monoSplit: false });
    const savedTrack = db1.upsertTrackMetadata({
      videoId: 'abc12345678',
      title: 'Mix Video 1',
      channel: 'DJ Channel',
      durationSec: 215,
      thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
      bpm: 128.5,
      gainDb: -1.5,
      hotCues: [{ slot: 1, timeSec: 16.25, label: 'Drop', color: '#00D4FF' }],
      loop: { active: true, inSec: 32, outSec: 40, beats: 4 },
      waveformPeaks: [0.1, 0.8, 0.4]
    });

    expect(savedTrack.bpm).toBe(128.5);
    expect(savedTrack.hotCues).toHaveLength(1);
    db1.close();

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);

    const db2 = new DatabaseService(dbPath);
    await db2.init();

    const setting = db2.getSetting('audio.masterDevice', { deviceId: 'default', monoSplit: true });
    expect(setting).toEqual({ deviceId: 'usb-1', monoSplit: false });

    const loaded = db2.getTrackMetadata('abc12345678');
    expect(loaded).not.toBeNull();
    expect(loaded?.hotCues).toEqual([{ slot: 1, timeSec: 16.25, label: 'Drop', color: '#00D4FF' }]);
    expect(loaded?.loop).toEqual({ active: true, inSec: 32, outSec: 40, beats: 4 });
    expect(loaded?.waveformPeaks).toEqual([0.1, 0.8, 0.4]);

    db2.close();
  });
});
