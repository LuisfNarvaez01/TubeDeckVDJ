import { harmonicMatch } from '../../shared/camelot';
import type { DjSuggestion, DjSuggestionReason, DjSuggestionRequest, DjSuggestions } from '../../shared/types';
import type { DatabaseService } from './DatabaseService';
import { nameKey, type TasteSnapshot } from './TasteFeedbackService';

/** One logged play, in the order it happened within its session. */
export interface PlayRow {
  sessionId: string;
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  playedAt: number;
}

export interface TrackFacts {
  bpm: number | null;
  key: string | null;
  thumbnailUrl: string;
}

export interface RankInput {
  plays: PlayRow[];
  facts: Map<string, TrackFacts>;
  request: DjSuggestionRequest;
  liked: Set<string>;
  disliked: Set<string>;
  blockedNames: Set<string>;
  nowMs: number;
  limit?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Hours between two times of day, going round midnight (23:00 and 01:00 are 2 h apart). */
function hourDistance(aMs: number, bMs: number): number {
  const ha = new Date(aMs).getHours() + new Date(aMs).getMinutes() / 60;
  const hb = new Date(bMs).getHours() + new Date(bMs).getMinutes() / 60;
  const d = Math.abs(ha - hb);
  return Math.min(d, 24 - d);
}

function thumbFor(videoId: string, stored?: string): string {
  if (stored) return stored;
  return videoId.startsWith('local_') ? '' : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Ranks songs from the DJ's own history for this moment. No external AI: it combines what
 * usually follows the song on air, what the DJ tends to play at this hour, harmonic/BPM fit,
 * likes and favourites, and skips anything heard recently.
 */
export function rankDjSuggestions(input: RankInput): DjSuggestions {
  const { plays, facts, request, nowMs } = input;
  const limit = input.limit ?? 24;
  const onAir = request.onAirVideoId ?? null;

  type Agg = {
    videoId: string;
    title: string;
    channel: string;
    durationSec: number;
    plays: number;
    lastAt: number;
    hourPlays: number;
    follows: number;
  };
  const agg = new Map<string, Agg>();
  const sessions = new Map<string, PlayRow[]>();
  for (const p of plays) {
    const a = agg.get(p.videoId) ?? {
      videoId: p.videoId,
      title: p.title,
      channel: p.channel,
      durationSec: p.durationSec,
      plays: 0,
      lastAt: 0,
      hourPlays: 0,
      follows: 0
    };
    a.plays += 1;
    a.lastAt = Math.max(a.lastAt, p.playedAt);
    // Plays within 1.5 h of this time of day, on any date, count towards "at this hour".
    const dist = hourDistance(p.playedAt, nowMs);
    if (dist <= 1.5) a.hourPlays += 1 - dist / 2;
    agg.set(p.videoId, a);
    const list = sessions.get(p.sessionId) ?? [];
    list.push(p);
    sessions.set(p.sessionId, list);
  }

  // What the DJ played right after the song that is on air now (and after its artist).
  const onAirArtist = request.onAirChannel ? nameKey(request.onAirChannel) : '';
  for (const list of sessions.values()) {
    list.sort((x, y) => x.playedAt - y.playedAt);
    for (let i = 0; i + 1 < list.length; i += 1) {
      const next = agg.get(list[i + 1].videoId);
      if (!next) continue;
      if (onAir && list[i].videoId === onAir) next.follows += 1;
      else if (onAirArtist && nameKey(list[i].channel) === onAirArtist) next.follows += 0.35;
    }
  }

  // Typical tempo at this hour: the energy the room usually has now.
  const hourBpms: number[] = [];
  for (const a of agg.values()) {
    const bpm = facts.get(a.videoId)?.bpm;
    if (bpm && a.hourPlays > 0) hourBpms.push(bpm);
  }
  hourBpms.sort((x, y) => x - y);
  const typicalBpm = hourBpms.length >= 3 ? Math.round(hourBpms[Math.floor(hourBpms.length / 2)]) : null;

  const exclude = new Set([...(request.excludeVideoIds ?? []), ...(onAir ? [onAir] : [])]);
  const maxPlays = Math.max(1, ...[...agg.values()].map((a) => a.plays));
  const scored: DjSuggestion[] = [];
  for (const a of agg.values()) {
    if (exclude.has(a.videoId) || input.disliked.has(a.videoId)) continue;
    if (input.blockedNames.has(nameKey(a.channel))) continue;
    // Heard in the last 3 hours (this night): not a suggestion.
    if (nowMs - a.lastAt < 3 * HOUR_MS) continue;

    const f = facts.get(a.videoId);
    const reasons: DjSuggestionReason[] = [];
    let score = 0;
    if (a.follows > 0) {
      score += 3 * Math.min(1, a.follows / 2);
      reasons.push('follows');
    }
    if (a.hourPlays > 0) {
      score += 2 * Math.min(1, a.hourPlays / 3);
      reasons.push('this-hour');
    }
    if (request.onAirKey && f?.key) {
      const m = harmonicMatch(request.onAirKey, f.key);
      if (m === 'same' || m === 'compatible') {
        score += 1.5;
        reasons.push('key');
      } else if (m === 'clash') {
        score -= 0.75;
      }
    }
    const refBpm = request.onAirBpm ?? typicalBpm;
    if (refBpm && f?.bpm) {
      const diff = Math.min(...[f.bpm, f.bpm * 2, f.bpm / 2].map((b) => Math.abs(b / refBpm - 1)));
      if (diff <= 0.06) {
        score += 1.2 * (1 - diff / 0.06);
        reasons.push('bpm');
      }
    }
    if (input.liked.has(a.videoId)) {
      score += 1.2;
      reasons.push('liked');
    }
    const popularity = Math.log1p(a.plays) / Math.log1p(maxPlays);
    score += popularity;
    if (a.plays >= 3 && popularity >= 0.5) reasons.push('favorite');
    if (a.plays >= 3 && nowMs - a.lastAt > 30 * DAY_MS) {
      score += 0.6;
      reasons.push('forgotten');
    }
    if (score <= 0.3) continue;
    scored.push({
      videoId: a.videoId,
      title: a.title,
      channel: a.channel,
      durationSec: a.durationSec,
      thumbnailUrl: thumbFor(a.videoId, f?.thumbnailUrl),
      isLive: false,
      score: Math.round(score * 100) / 100,
      reasons,
      bpm: f?.bpm ?? null,
      musicalKey: f?.key ?? null,
      playCount: a.plays
    });
  }
  scored.sort((x, y) => y.score - x.score);
  return { suggestions: scored.slice(0, limit), typicalBpm, historySize: plays.length };
}

export class DjSuggestionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly getTaste: () => TasteSnapshot
  ) {}

  suggest(request: DjSuggestionRequest, nowMs = Date.now()): DjSuggestions {
    const plays = this.db
      .queryAll<Record<string, unknown>>(
        `SELECT session_id, video_id, title, channel, duration_sec, played_at
         FROM history_entries ORDER BY played_at DESC LIMIT 20000`
      )
      .map((r) => ({
        sessionId: String(r.session_id),
        videoId: String(r.video_id),
        title: String(r.title),
        channel: String(r.channel),
        durationSec: Number(r.duration_sec ?? 0),
        playedAt: Number(r.played_at)
      }));
    const facts = new Map<string, TrackFacts>();
    for (const r of this.db.queryAll<Record<string, unknown>>(
      `SELECT video_id, bpm, musical_key, thumbnail_url FROM track_metadata`
    )) {
      facts.set(String(r.video_id), {
        bpm: r.bpm !== null && r.bpm !== undefined ? Number(r.bpm) : null,
        key: typeof r.musical_key === 'string' && r.musical_key ? r.musical_key : null,
        thumbnailUrl: typeof r.thumbnail_url === 'string' ? r.thumbnail_url : ''
      });
    }
    const taste = this.getTaste();
    return rankDjSuggestions({
      plays,
      facts,
      request,
      liked: new Set(taste.likedVideoIds),
      disliked: taste.dislikedVideoIds,
      blockedNames: taste.blockedNames,
      nowMs
    });
  }
}
