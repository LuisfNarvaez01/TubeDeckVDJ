import crypto from 'crypto';
import type {
  FeedbackSignal,
  TasteSeedTrack,
  TasteSummary,
  TrackFeedbackInput
} from '../../shared/types';
import type { DatabaseService } from './DatabaseService';

/** Weight of each signal on the artist/channel affinity score. */
export const SIGNAL_WEIGHTS: Record<FeedbackSignal, number> = {
  like: 3,
  complete: 1,
  skip: -1.5,
  dislike: -4,
  'block-channel': -6
};

/** Feedback older than this loses half of its weight. */
const HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000;
const SEED_ARTIST_WEIGHT = 2.5;
export const MAX_TASTE_SEEDS = 10;

export interface TasteSnapshot {
  likedVideoIds: string[];
  dislikedVideoIds: Set<string>;
  blockedNames: Set<string>;
  /** Normalized artist/channel name → affinity (positive = liked). */
  affinity: Map<string, number>;
  seeds: TasteSeedTrack[];
}

/** Lowercase, accent-free key used to match artist and channel names. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*-\s*topic$/, '')
    .replace(/vevo$/, '')
    .replace(/\s*(official|oficial)$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Splits a channel/author string like "KAROL G, Anuel AA & Daddy Yankee" into artist keys. */
export function splitArtistKeys(channel: string, artists: string[] = []): string[] {
  const raw = artists.length > 0 ? artists : channel.split(/\s*(?:,|&| x | y | feat\.? | ft\.? )\s*/i);
  const keys = raw.map(nameKey).filter((k) => k.length >= 2);
  return Array.from(new Set(keys));
}

function decay(createdAt: number, now: number): number {
  const age = Math.max(0, now - createdAt);
  return Math.pow(0.5, age / HALF_LIFE_MS);
}

export class TasteFeedbackService {
  constructor(private readonly db: DatabaseService) {}

  recordFeedback(input: TrackFeedbackInput, now = Date.now()): void {
    const { track, signal } = input;
    const artists = track.artists ?? [];

    // A like replaces a previous dislike on the same video (and vice versa).
    if (signal === 'like' || signal === 'dislike') {
      this.db.run(
        "DELETE FROM track_feedback WHERE video_id = ? AND signal IN ('like', 'dislike')",
        [track.videoId],
        false
      );
    }

    this.db.run(
      `INSERT INTO track_feedback (id, video_id, title, channel, artists_json, signal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        track.videoId,
        track.title,
        track.channel,
        JSON.stringify(artists),
        signal,
        now
      ],
      signal !== 'block-channel'
    );

    if (signal === 'block-channel') {
      this.blockChannel(track.channel, now);
    }
  }

  blockChannel(displayName: string, now = Date.now()): void {
    const key = nameKey(displayName);
    if (!key) return;
    this.db.run(
      `INSERT OR REPLACE INTO blocked_channels (name_key, display_name, created_at) VALUES (?, ?, ?)`,
      [key, displayName, now]
    );
  }

  unblockChannel(displayName: string): void {
    this.db.run('DELETE FROM blocked_channels WHERE name_key = ?', [nameKey(displayName)]);
  }

  setTasteSeeds(tracks: TasteSeedTrack[], now = Date.now()): TasteSeedTrack[] {
    const unique = new Map<string, TasteSeedTrack>();
    for (const t of tracks) {
      if (!unique.has(t.videoId)) unique.set(t.videoId, t);
    }
    const list = Array.from(unique.values()).slice(0, MAX_TASTE_SEEDS);
    this.db.run('DELETE FROM taste_seeds', [], false);
    list.forEach((t, idx) => {
      this.db.run(
        `INSERT INTO taste_seeds (video_id, title, channel, duration_sec, thumbnail_url, position, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [t.videoId, t.title, t.channel, t.durationSec, t.thumbnailUrl, idx, now],
        idx === list.length - 1
      );
    });
    if (list.length === 0) this.db.save();
    return list;
  }

  getTasteSeeds(): TasteSeedTrack[] {
    return this.db
      .queryAll<Record<string, unknown>>(
        'SELECT video_id, title, channel, duration_sec, thumbnail_url FROM taste_seeds ORDER BY position ASC'
      )
      .map((r) => ({
        videoId: String(r.video_id),
        title: String(r.title ?? ''),
        channel: String(r.channel ?? ''),
        durationSec: Number(r.duration_sec ?? 0),
        thumbnailUrl: String(r.thumbnail_url ?? '')
      }));
  }

  getSnapshot(now = Date.now()): TasteSnapshot {
    const rows = this.db.queryAll<Record<string, unknown>>(
      `SELECT video_id, channel, artists_json, signal, created_at
       FROM track_feedback
       ORDER BY created_at DESC
       LIMIT 2000`
    );

    const affinity = new Map<string, number>();
    const liked: string[] = [];
    const likedSet = new Set<string>();
    const disliked = new Set<string>();

    for (const r of rows) {
      const signal = String(r.signal) as FeedbackSignal;
      const videoId = String(r.video_id);
      const weight = (SIGNAL_WEIGHTS[signal] ?? 0) * decay(Number(r.created_at ?? now), now);
      let artists: string[] = [];
      try {
        const parsed = JSON.parse(String(r.artists_json ?? '[]'));
        if (Array.isArray(parsed)) artists = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        artists = [];
      }
      for (const key of splitArtistKeys(String(r.channel ?? ''), artists)) {
        affinity.set(key, (affinity.get(key) ?? 0) + weight);
      }
      if (signal === 'like' && !likedSet.has(videoId)) {
        likedSet.add(videoId);
        liked.push(videoId);
      }
      if (signal === 'dislike') disliked.add(videoId);
    }

    const seeds = this.getTasteSeeds();
    for (const seed of seeds) {
      for (const key of splitArtistKeys(seed.channel)) {
        affinity.set(key, (affinity.get(key) ?? 0) + SEED_ARTIST_WEIGHT);
      }
    }

    const blockedNames = new Set(
      this.db
        .queryAll<{ name_key: string }>('SELECT name_key FROM blocked_channels')
        .map((r) => String(r.name_key))
    );

    return { likedVideoIds: liked, dislikedVideoIds: disliked, blockedNames, affinity, seeds };
  }

  getSummary(): TasteSummary {
    const snapshot = this.getSnapshot();
    const counts = this.db.queryOne<{ likes: number; dislikes: number }>(
      `SELECT
         SUM(CASE WHEN signal = 'like' THEN 1 ELSE 0 END) AS likes,
         SUM(CASE WHEN signal = 'dislike' THEN 1 ELSE 0 END) AS dislikes
       FROM track_feedback`
    );
    const blocked = this.db
      .queryAll<{ display_name: string }>('SELECT display_name FROM blocked_channels ORDER BY created_at DESC')
      .map((r) => String(r.display_name));
    const topArtists = Array.from(snapshot.affinity.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, score]) => ({ name, score: Number(score.toFixed(2)) }));
    return {
      seedCount: snapshot.seeds.length,
      likes: Number(counts?.likes ?? 0),
      dislikes: Number(counts?.dislikes ?? 0),
      blockedChannels: blocked,
      topArtists
    };
  }

  resetFeedback(): void {
    this.db.run('DELETE FROM track_feedback', [], false);
    this.db.run('DELETE FROM blocked_channels');
  }
}
