import crypto from 'crypto';
import type {
  Crate,
  HistoryEntry,
  HistoryTasteProfile,
  MidiMapping,
  MixSession,
  SmartCrateQuery,
  SmartCrateTrack,
  YouTubeTrack
} from '../../shared/types';
import { harmonicMatch } from '../../shared/camelot';
import type { DatabaseService } from './DatabaseService';

const TASTE_STOPWORDS = new Set([
  'official',
  'oficial',
  'video',
  'audio',
  'lyrics',
  'letra',
  'music',
  'musica',
  'feat',
  'with',
  'from',
  'that',
  'this',
  'the',
  'and',
  'for',
  'con',
  'del',
  'las',
  'los',
  'una',
  'uno',
  'para',
  'por',
  'que',
  'topic',
  'vevo',
  '1080p',
  '720p',
  'full',
  'hq'
]);

export function tokenizeTasteText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !TASTE_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

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

  /**
   * Smart crates are rules, not lists: they are recomputed from play history, feedback
   * and analysed track metadata every time they are opened.
   */
  getSmartCrate(query: SmartCrateQuery, nowMs = Date.now(), limit = 60): SmartCrateTrack[] {
    const thumb = (videoId: string, stored?: unknown): string =>
      typeof stored === 'string' && stored
        ? stored
        : videoId.startsWith('local_')
          ? ''
          : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    if (query.kind === 'liked') {
      const rows = this.db.queryAll<Record<string, unknown>>(
        `SELECT f.video_id, f.title, f.channel, f.signal, f.created_at
         FROM track_feedback f
         JOIN (SELECT video_id, MAX(created_at) AS last_at FROM track_feedback
               WHERE signal IN ('like', 'dislike') GROUP BY video_id) l
           ON l.video_id = f.video_id AND l.last_at = f.created_at
         WHERE f.signal = 'like'
         ORDER BY f.created_at DESC LIMIT ?`,
        [limit]
      );
      return rows.map((r) => ({
        videoId: String(r.video_id),
        title: String(r.title),
        channel: String(r.channel),
        durationSec: 0,
        thumbnailUrl: thumb(String(r.video_id)),
        isLive: false
      }));
    }

    if (query.kind === 'match') {
      const rows = this.db.queryAll<Record<string, unknown>>(
        `SELECT video_id, title, channel, duration_sec, thumbnail_url, bpm, musical_key, play_count
         FROM track_metadata
         WHERE title <> '' AND video_id NOT LIKE 'local_%' AND (musical_key IS NOT NULL OR bpm IS NOT NULL)`
      );
      const scored: { t: SmartCrateTrack; score: number }[] = [];
      for (const r of rows) {
        const key = typeof r.musical_key === 'string' ? r.musical_key : null;
        const bpm = r.bpm !== null && r.bpm !== undefined ? Number(r.bpm) : null;
        let score = 0;
        if (query.camelot) {
          const m = key ? harmonicMatch(query.camelot, key) : null;
          if (m === 'clash' || !m) continue;
          score += m === 'same' ? 3 : m === 'compatible' ? 2.5 : 1.5;
        }
        if (query.bpm) {
          if (!bpm) continue;
          // Allow half/double time (a 90 BPM reggaeton mixes with 180 drum & bass).
          const ratios = [bpm / query.bpm, (bpm * 2) / query.bpm, bpm / 2 / query.bpm];
          const diff = Math.min(...ratios.map((x) => Math.abs(x - 1)));
          if (diff > 0.06) continue;
          score += 2 * (1 - diff / 0.06);
        }
        scored.push({
          score,
          t: {
            videoId: String(r.video_id),
            title: String(r.title),
            channel: String(r.channel),
            durationSec: Number(r.duration_sec ?? 0),
            thumbnailUrl: thumb(String(r.video_id), r.thumbnail_url),
            isLive: false,
            musicalKey: key,
            bpm,
            playCount: Number(r.play_count ?? 0)
          }
        });
      }
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.t);
    }

    const order =
      query.kind === 'most-played'
        ? 'plays DESC, last_at DESC'
        : query.kind === 'forgotten'
          ? 'plays DESC, last_at ASC'
          : 'last_at DESC';
    const having = query.kind === 'forgotten' ? 'HAVING MAX(h.played_at) < ?' : '';
    const params: unknown[] = query.kind === 'forgotten' ? [nowMs - 30 * 86_400_000, limit] : [limit];
    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT h.video_id, MAX(h.title) AS title, MAX(h.channel) AS channel,
              MAX(h.duration_sec) AS duration_sec, COUNT(*) AS plays, MAX(h.played_at) AS last_at,
              MAX(m.thumbnail_url) AS thumbnail_url, MAX(m.musical_key) AS musical_key, MAX(h.bpm) AS bpm
       FROM history_entries h
       LEFT JOIN track_metadata m ON m.video_id = h.video_id
       WHERE h.video_id NOT LIKE 'local_%'
       GROUP BY h.video_id
       ${having}
       ORDER BY ${order}
       LIMIT ?`,
      params
    );
    return rows.map((r) => ({
      videoId: String(r.video_id),
      title: String(r.title),
      channel: String(r.channel),
      durationSec: Number(r.duration_sec ?? 0),
      thumbnailUrl: thumb(String(r.video_id), r.thumbnail_url),
      isLive: false,
      playCount: Number(r.plays),
      lastPlayedAt: Number(r.last_at),
      musicalKey: typeof r.musical_key === 'string' ? r.musical_key : null,
      bpm: r.bpm !== null && r.bpm !== undefined ? Number(r.bpm) : null
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

  buildTasteProfile(limitRecent = 100): HistoryTasteProfile {
    const countRow = this.db.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM history_entries');
    const totalPlays = Number(countRow?.cnt ?? 0);

    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT video_id, title, channel, duration_sec, played_at
       FROM history_entries
       ORDER BY played_at DESC
       LIMIT ?`,
      [Math.max(1, limitRecent)]
    );

    if (rows.length === 0) {
      return {
        totalPlays,
        topChannels: [],
        topKeywords: [],
        avgDurationSec: 210,
        recentVideoIds: []
      };
    }

    const channelCounts = new Map<string, number>();
    const keywordWeights = new Map<string, number>();
    const recentVideoIds: string[] = [];
    const seenRecent = new Set<string>();
    let durationSum = 0;

    rows.forEach((row, idx) => {
      const vid = String(row.video_id ?? '');
      const title = String(row.title ?? '');
      const channel = String(row.channel ?? '').trim();
      const dur = Number(row.duration_sec ?? 0);
      if (Number.isFinite(dur) && dur > 0) durationSum += dur;

      if (vid && !seenRecent.has(vid)) {
        seenRecent.add(vid);
        if (recentVideoIds.length < 40) recentVideoIds.push(vid);
      }

      if (channel && channel !== 'YouTube' && channel !== 'Local') {
        channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
      }

      const recencyWeight = 1 + (rows.length - idx) / rows.length;
      const tokens = new Set([...tokenizeTasteText(title), ...tokenizeTasteText(channel)]);
      for (const word of tokens) {
        keywordWeights.set(word, (keywordWeights.get(word) ?? 0) + recencyWeight);
      }
    });

    const topChannels = Array.from(channelCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const topKeywords = Array.from(keywordWeights.entries())
      .map(([word, weight]) => ({ word, weight: Number(weight.toFixed(2)) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);

    return {
      totalPlays,
      topChannels,
      topKeywords,
      avgDurationSec: Math.round(durationSum / rows.length) || 210,
      recentVideoIds
    };
  }
}
