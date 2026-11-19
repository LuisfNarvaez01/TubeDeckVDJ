import crypto from 'crypto';
import type {
  Crate,
  HistoryEntry,
  MidiMapping,
  MixSession,
  YouTubeTrack
} from '../../shared/types';
import type { DatabaseService } from './DatabaseService';

export interface SaveMidiMappingInput {
  deviceName: string;
  controlKey: string;
  channel: number;
  statusType: 'cc' | 'note';
  ccOrNote: number;
  mode: 'absolute' | 'toggle' | 'trigger';
  minVal: number;
  maxVal: number;
}

export class HistoryAndCratesService {
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  startSession(title?: string): MixSession {
    const now = Date.now();
    const session: MixSession = {
      id: `sess-${crypto.randomUUID()}`,
      title: title?.trim() || `Sesión ${new Date(now).toLocaleString('es-ES')}`,
      startedAt: now,
      endedAt: null,
      notes: ''
    };
    this.db.run(
      `INSERT INTO sessions (id, title, started_at, ended_at, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [session.id, session.title, session.startedAt, null, session.notes]
    );
    return session;
  }

  endSession(sessionId: string): void {
    this.db.run('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', [
      Date.now(),
      sessionId
    ]);
  }

  listSessions(): MixSession[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      'SELECT id, title, started_at, ended_at, notes FROM sessions ORDER BY started_at DESC'
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      startedAt: Number(r.started_at),
      endedAt: r.ended_at !== null && r.ended_at !== undefined ? Number(r.ended_at) : null,
      notes: String(r.notes ?? '')
    }));
  }

  logTrackPlay(
    entry: Omit<HistoryEntry, 'id' | 'endedAt' | 'bpm' | 'transitionUsed'> & {
      endedAt?: number | null;
      bpm?: number | null;
      transitionUsed?: string | null;
    }
  ): HistoryEntry {
    const created: HistoryEntry = {
      ...entry,
      endedAt: entry.endedAt ?? null,
      bpm: entry.bpm ?? null,
      transitionUsed: entry.transitionUsed ?? null,
      id: `hist-${crypto.randomUUID()}`
    };
    this.db.run(
      `INSERT INTO history_entries (
         id, session_id, deck, video_id, title, channel, duration_sec,
         played_at, ended_at, bpm, transition_used
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        created.id,
        created.sessionId,
        created.deck,
        created.videoId,
        created.title,
        created.channel,
        created.durationSec,
        created.playedAt,
        created.endedAt,
        created.bpm,
        created.transitionUsed
      ]
    );
    return created;
  }

  getSessionHistory(sessionId: string): HistoryEntry[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT id, session_id, deck, video_id, title, channel, duration_sec,
              played_at, ended_at, bpm, transition_used
       FROM history_entries
       WHERE session_id = ?
       ORDER BY played_at ASC`,
      [sessionId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      deck: r.deck === 'B' ? 'B' : 'A',
      videoId: String(r.video_id),
      title: String(r.title),
      channel: String(r.channel),
      durationSec: Number(r.duration_sec),
      playedAt: Number(r.played_at),
      endedAt: r.ended_at !== null && r.ended_at !== undefined ? Number(r.ended_at) : null,
      bpm: r.bpm !== null && r.bpm !== undefined ? Number(r.bpm) : null,
      transitionUsed:
        r.transition_used !== null && r.transition_used !== undefined
          ? String(r.transition_used)
          : null
    }));
  }

  createCrate(name: string, color = '#00D4FF'): Crate {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Crate name cannot be empty');

    const countRow = this.db.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM crates');
    const sortOrder = Number(countRow?.cnt ?? 0);
    const id = `crate-${crypto.randomUUID()}`;
    this.db.run(
      `INSERT INTO crates (id, name, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, trimmed, color, sortOrder, Date.now()]
    );
    return { id, name: trimmed, color, trackCount: 0 };
  }

  addTrackToCrate(crateId: string, track: YouTubeTrack): void {
    const posRow = this.db.queryOne<{ max_pos: number | null }>(
      'SELECT MAX(position) AS max_pos FROM crate_tracks WHERE crate_id = ?',
      [crateId]
    );
    const nextPos = posRow?.max_pos !== null && posRow?.max_pos !== undefined ? Number(posRow.max_pos) + 1 : 0;

    this.db.run(
      `INSERT INTO crate_tracks (
         crate_id, video_id, title, channel, duration_sec, thumbnail_url, position, added_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(crate_id, video_id) DO NOTHING`,
      [
        crateId,
        track.videoId,
        track.title,
        track.channel,
        track.durationSec,
        track.thumbnailUrl,
        nextPos,
        Date.now()
      ]
    );
  }

  getCrateTracks(crateId: string): YouTubeTrack[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT video_id, title, channel, duration_sec, thumbnail_url
       FROM crate_tracks
       WHERE crate_id = ?
       ORDER BY position ASC`,
      [crateId]
    );
    return rows.map((r) => ({
      videoId: String(r.video_id),
      title: String(r.title),
      channel: String(r.channel),
      durationSec: Number(r.duration_sec),
      thumbnailUrl: String(r.thumbnail_url),
      isLive: false
    }));
  }

  listCrates(): Crate[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT c.id, c.name, c.color, COUNT(ct.video_id) AS track_count
       FROM crates c
       LEFT JOIN crate_tracks ct ON ct.crate_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.created_at ASC`
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: String(r.color),
      trackCount: Number(r.track_count ?? 0)
    }));
  }

  saveMidiMapping(input: SaveMidiMappingInput): MidiMapping {
    const mapping: MidiMapping = {
      id: `midi-${crypto.randomUUID()}`,
      ...input
    };
    this.db.run(
      `DELETE FROM midi_mappings WHERE device_name = ? AND control_key = ?`,
      [mapping.deviceName, mapping.controlKey],
      false
    );
    this.db.run(
      `INSERT INTO midi_mappings (
         id, device_name, control_key, channel, status_type, cc_or_note, mode, min_val, max_val
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mapping.id,
        mapping.deviceName,
        mapping.controlKey,
        mapping.channel,
        mapping.statusType,
        mapping.ccOrNote,
        mapping.mode,
        mapping.minVal,
        mapping.maxVal
      ]
    );
    return mapping;
  }

  listMidiMappings(deviceName?: string): MidiMapping[] {
    const sql = deviceName
      ? 'SELECT * FROM midi_mappings WHERE device_name = ? ORDER BY control_key ASC'
      : 'SELECT * FROM midi_mappings ORDER BY device_name ASC, control_key ASC';
    const rows = this.db.queryAll<Record<string, unknown>>(sql, deviceName ? [deviceName] : []);
    return rows.map((r) => ({
      id: String(r.id),
      deviceName: String(r.device_name),
      controlKey: String(r.control_key),
      channel: Number(r.channel),
      statusType: r.status_type === 'note' ? 'note' : 'cc',
      ccOrNote: Number(r.cc_or_note),
      mode:
        r.mode === 'toggle' ? 'toggle' : r.mode === 'trigger' ? 'trigger' : 'absolute',
      minVal: Number(r.min_val),
      maxVal: Number(r.max_val)
    }));
  }

  deleteMidiMapping(id: string): void {
    this.db.run('DELETE FROM midi_mappings WHERE id = ?', [id]);
  }
}
