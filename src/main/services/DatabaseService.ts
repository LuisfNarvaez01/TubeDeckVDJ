import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { HotCue, LoopState, TrackMetadataRecord } from '../../shared/types';

export interface HistoryEntryInput {
  sessionId: string;
  deck: 'A' | 'B';
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  playedAt: number;
  endedAt?: number;
  bpm?: number;
  transitionUsed?: string;
}

function resolveWasmFilePath(): string {
  const candidates: string[] = [];

  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(path.join(process.resourcesPath, 'sql-wasm.wasm'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
  }

  try {
    const req = createRequire(import.meta.url);
    candidates.push(req.resolve('sql.js/dist/sql-wasm.wasm'));
  } catch {
    // ignore resolution fallback
  }

  candidates.push(path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate sql-wasm.wasm. Checked: ${candidates.join(', ')}`);
}

function parseJsonOrNull<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class DatabaseService {
  private readonly dbPath: string;
  private db: Database | null = null;
  private inTransaction = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;

    const wasmPath = resolveWasmFilePath();
    const SQL = await initSqlJs({
      useOldExtensionFunctions: false,
      locateFile: () => wasmPath
    });

    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(new Uint8Array(buffer));
      } else {
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private getDbOrThrow(): Database {
    if (!this.db) {
      throw new Error('DatabaseService has not been initialized. Call init() first.');
    }
    return this.db;
  }

  migrate(): void {
    const db = this.getDbOrThrow();

    db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = this.queryOne<{ version: number }>(
      'SELECT version FROM schema_version WHERE version = ?',
      [1]
    );

    if (!applied) {
      db.run('BEGIN TRANSACTION;');
      this.inTransaction = true;
      try {
        db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            notes TEXT NOT NULL DEFAULT ''
          );

          CREATE TABLE IF NOT EXISTS history_entries (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            deck TEXT NOT NULL CHECK(deck IN ('A', 'B')),
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            channel TEXT NOT NULL,
            duration_sec REAL NOT NULL,
            played_at INTEGER NOT NULL,
            ended_at INTEGER,
            bpm REAL,
            transition_used TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS track_metadata (
            video_id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            channel TEXT NOT NULL DEFAULT '',
            duration_sec REAL NOT NULL DEFAULT 0,
            thumbnail_url TEXT NOT NULL DEFAULT '',
            bpm REAL,
            beat_offset_sec REAL,
            key_signature TEXT,
            gain_db REAL NOT NULL DEFAULT 0,
            hot_cues_json TEXT NOT NULL DEFAULT '[]',
            loop_json TEXT,
            waveform_peaks_json TEXT,
            last_played_at INTEGER,
            play_count INTEGER NOT NULL DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS crates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#00D4FF',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS crate_tracks (
            crate_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            channel TEXT NOT NULL DEFAULT '',
            duration_sec REAL NOT NULL DEFAULT 0,
            thumbnail_url TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (crate_id, video_id),
            FOREIGN KEY (crate_id) REFERENCES crates(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS midi_mappings (
            id TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            control_key TEXT NOT NULL,
            channel INTEGER NOT NULL,
            status_type TEXT NOT NULL CHECK(status_type IN ('cc', 'note')),
            cc_or_note INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('absolute', 'toggle', 'trigger')),
            min_val REAL NOT NULL DEFAULT 0,
            max_val REAL NOT NULL DEFAULT 1
          );

          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL
          );
        `);

        db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?);', [
          1,
          Date.now()
        ]);
        db.run('COMMIT;');
        this.inTransaction = false;
      } catch (err) {
        if (this.inTransaction) {
          db.run('ROLLBACK;');
          this.inTransaction = false;
        }
        throw err;
      }
      this.save();
    }
  }

  queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const db = this.getDbOrThrow();
    const stmt = db.prepare(sql);
    const rows: T[] = [];
    try {
      if (params.length > 0) {
        stmt.bind(params as SqlValue[]);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  queryOne<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  run(sql: string, params: unknown[] = [], autoSave = true): void {
    const db = this.getDbOrThrow();
    db.run(sql, params as SqlValue[]);
    if (autoSave && !this.inTransaction) {
      this.save();
    }
  }

  save(): void {
    if (this.dbPath === ':memory:') return;
    const db = this.getDbOrThrow();
    const data = db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, this.dbPath);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.queryOne<{ value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?',
      [key]
    );
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  setSetting<T>(key: string, value: T): void {
    this.run(
      `INSERT INTO app_settings (key, value_json)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      [key, JSON.stringify(value)]
    );
  }

  upsertTrackMetadata(
    track: Partial<TrackMetadataRecord> & { videoId: string }
  ): TrackMetadataRecord {
    const existing = this.getTrackMetadata(track.videoId);
    const merged: TrackMetadataRecord = {
      videoId: track.videoId,
      title: track.title ?? existing?.title ?? '',
      channel: track.channel ?? existing?.channel ?? '',
      durationSec: track.durationSec ?? existing?.durationSec ?? 0,
      thumbnailUrl: track.thumbnailUrl ?? existing?.thumbnailUrl ?? '',
      bpm: track.bpm !== undefined ? track.bpm : (existing?.bpm ?? null),
      beatOffsetSec:
        track.beatOffsetSec !== undefined ? track.beatOffsetSec : (existing?.beatOffsetSec ?? null),
      gainDb: track.gainDb ?? existing?.gainDb ?? 0,
      hotCues: track.hotCues ?? existing?.hotCues ?? [],
      loop: track.loop !== undefined ? track.loop : (existing?.loop ?? null),
      waveformPeaks:
        track.waveformPeaks !== undefined ? track.waveformPeaks : (existing?.waveformPeaks ?? null),
      playCount: track.playCount ?? existing?.playCount ?? 0
    };

    this.run(
      `INSERT INTO track_metadata (
         video_id, title, channel, duration_sec, thumbnail_url, bpm, beat_offset_sec,
         gain_db, hot_cues_json, loop_json, waveform_peaks_json, play_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         title = excluded.title,
         channel = excluded.channel,
         duration_sec = excluded.duration_sec,
         thumbnail_url = excluded.thumbnail_url,
         bpm = excluded.bpm,
         beat_offset_sec = excluded.beat_offset_sec,
         gain_db = excluded.gain_db,
         hot_cues_json = excluded.hot_cues_json,
         loop_json = excluded.loop_json,
         waveform_peaks_json = excluded.waveform_peaks_json,
         play_count = excluded.play_count`,
      [
        merged.videoId,
        merged.title,
        merged.channel,
        merged.durationSec,
        merged.thumbnailUrl,
        merged.bpm,
        merged.beatOffsetSec,
        merged.gainDb,
        JSON.stringify(merged.hotCues),
        merged.loop ? JSON.stringify(merged.loop) : null,
        merged.waveformPeaks ? JSON.stringify(merged.waveformPeaks) : null,
        merged.playCount
      ]
    );

    return merged;
  }

  getTrackMetadata(videoId: string): TrackMetadataRecord | null {
    const row = this.queryOne<Record<string, unknown>>(
      'SELECT * FROM track_metadata WHERE video_id = ?',
      [videoId]
    );
    if (!row) return null;

    return {
      videoId: String(row.video_id),
      title: String(row.title ?? ''),
      channel: String(row.channel ?? ''),
      durationSec: Number(row.duration_sec ?? 0),
      thumbnailUrl: String(row.thumbnail_url ?? ''),
      bpm: row.bpm !== null && row.bpm !== undefined ? Number(row.bpm) : null,
      beatOffsetSec:
        row.beat_offset_sec !== null && row.beat_offset_sec !== undefined
          ? Number(row.beat_offset_sec)
          : null,
      gainDb: Number(row.gain_db ?? 0),
      hotCues: parseJsonOrNull<HotCue[]>(row.hot_cues_json) ?? [],
      loop: parseJsonOrNull<LoopState>(row.loop_json),
      waveformPeaks: parseJsonOrNull<number[]>(row.waveform_peaks_json),
      playCount: Number(row.play_count ?? 0)
    };
  }

  close(): void {
    if (!this.db) return;
    this.save();
    this.db.close();
    this.db = null;
  }
}
