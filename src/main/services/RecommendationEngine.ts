/**
 * Radio recommendation pipeline: Source → Filter → Score → Select.
 * (Stage layout popularized by xAI's open-sourced recommendation algorithm,
 * github.com/xai-org/x-algorithm, Apache 2.0 — independent implementation.)
 *
 * Sources are YouTube Music radios ("automix") of several seeds — the current
 * track, the recent session and the user's liked / reference songs — with the
 * regular YouTube "watch next" feed only as a fallback. Without a Google account
 * the local feedback store (likes, dislikes, skips, completions, blocked
 * channels, reference songs) plays the role of the personal profile.
 */
import type { HistoryTasteProfile, YouTubeTrack } from '../../shared/types';
import { tokenizeTasteText } from './HistoryAndCratesService';
import { nameKey, splitArtistKeys, type TasteSnapshot } from './TasteFeedbackService';

export type SeedKind = 'current' | 'session' | 'liked' | 'reference';

export interface SeedSpec {
  videoId: string;
  kind: SeedKind;
  weight: number;
  title?: string;
}

export interface SourceResult {
  seed: SeedSpec;
  origin: 'music' | 'related';
  tracks: YouTubeTrack[];
}

export interface RecommendationSources {
  getMusicRadio(videoId: string, limit?: number): Promise<YouTubeTrack[]>;
  getRelatedTracks(videoId: string, excludeIds?: string[], limit?: number): Promise<YouTubeTrack[]>;
}

export interface RecommendationContext {
  getSnapshot(): TasteSnapshot;
  buildTasteProfile(limit?: number): HistoryTasteProfile;
}

export interface RecommendationRequest {
  seedVideoId: string;
  seedTitle?: string;
  excludeVideoIds?: string[];
  limit?: number;
}

const MIN_DURATION_SEC = 90;
const MAX_DURATION_SEC = 600;
const MAX_PER_ARTIST = 2;
const RADIO_CACHE_TTL_MS = 20 * 60 * 1000;

/** Titles that are almost never a song a DJ wants: reactions, tutorials, vlogs… */
const JUNK_TITLE =
  /\b(reacci[oó]n|reaccionando|reaction|reacting|tutorial|c[oó]mo (tocar|bailar|hacer|cantar)|how to|vlog|unboxing|review|rese[ñn]a|#shorts|shorts|trailer|podcast|entrevista|interview|gameplay|parodia|parody|8d audio|sped ?up|slowed|nightcore|1 hora|1 hour|10 hours|karaoke version cover|lesson|clase de)\b/i;
const LIVE_TITLE = /\b(en vivo|live|concierto|concert|session en vivo)\b/i;
const COVER_TITLE = /\b(cover|versi[oó]n (ac[uú]stica|piano)|acoustic cover)\b/i;
const KARAOKE_TITLE = /\b(karaoke|instrumental|pista)\b/i;

/**
 * The radio's hard filters, shared with guest song requests (Lantify): a real song of
 * 90–600 s, not live, not a reaction / tutorial / short / long mix, not disliked and not
 * from a blocked channel or artist.
 */
export function passesSongFilter(t: YouTubeTrack, snapshot: Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>): boolean {
  if (snapshot.dislikedVideoIds.has(t.videoId)) return false;
  if (t.isLive) return false;
  if (t.durationSec < MIN_DURATION_SEC || t.durationSec > MAX_DURATION_SEC) return false;
  if (JUNK_TITLE.test(t.title)) return false;
  const artistKeys = splitArtistKeys(t.channel, t.artists);
  if (artistKeys.some((k) => snapshot.blockedNames.has(k)) || snapshot.blockedNames.has(nameKey(t.channel))) {
    return false;
  }
  return true;
}

/** Song identity used to drop duplicate uploads of the same track. */
export function songKey(track: YouTubeTrack): string {
  const base = track.title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(official|oficial|video|audio|lyrics?|letra|visualizer|hd|4k)\b/gi, ' ');
  const titlePart = nameKey(base.includes(' - ') ? base.split(' - ').slice(1).join(' ') || base : base);
  const artist = splitArtistKeys(track.channel, track.artists)[0] ?? '';
  return `${artist}|${titlePart}`;
}

function hasRealVideo(track: YouTubeTrack): boolean {
  return track.thumbnailUrl.includes('i.ytimg.com/vi/');
}

/** "Marc Anthony - Vivir Mi Vida (Official Video)" → "Vivir Mi Vida". */
export function shortSongTitle(title: string): string {
  // "Artist | Song | Channel tags" → keep the first meaningful segment
  if (title.includes('|')) title = title.split('|')[0].trim() || title;
  let t = title.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.includes(' - ')) t = t.split(' - ').slice(1).join(' - ').trim() || t;
  return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
}

function reasonForSeed(seed: SeedSpec): string {
  const title = seed.title ? shortSongTitle(seed.title) : '';
  switch (seed.kind) {
    case 'current':
      return title ? `Porque suena "${title}"` : 'Por la canción actual';
    case 'session':
      return title ? `Por "${title}" de tu sesión` : 'Por tu sesión reciente';
    case 'liked':
      return title ? `Porque te gustó "${title}"` : 'Por tus Me gusta';
    case 'reference':
      return title ? `Por tu referencia "${title}"` : 'Por tus canciones de referencia';
  }
}

interface ScoredCandidate {
  track: YouTubeTrack;
  score: number;
  reason: string;
  primaryArtist: string;
}

/**
 * Pure ranking stage (no network): merges candidate lists from several seed
 * radios, filters junk, scores with the local taste model and selects a
 * diverse top-K. Exported for unit tests.
 */
export function rankRadioCandidates(
  sources: SourceResult[],
  snapshot: TasteSnapshot,
  profile: HistoryTasteProfile,
  options: { excludeVideoIds?: string[]; limit?: number; seedTitle?: string } = {}
): YouTubeTrack[] {
  const limit = options.limit ?? 12;
  const seedIds = sources.map((s) => s.seed.videoId);
  const hardExcluded = new Set<string>([...seedIds, ...(options.excludeVideoIds ?? [])]);
  const recent = new Set(profile.recentVideoIds);
  const liked = new Set(snapshot.likedVideoIds);
  const seedTitle = options.seedTitle ?? '';
  const seedWantsCovers = COVER_TITLE.test(seedTitle);
  const seedWantsKaraoke = KARAOKE_TITLE.test(seedTitle);

  // ---- Source merge: accumulate rank-consensus across seed radios ----
  const merged = new Map<
    string,
    { track: YouTubeTrack; consensus: number; hits: number; fromMusic: boolean; bestSeed: SeedSpec; bestContribution: number }
  >();
  for (const source of sources) {
    const total = Math.max(1, source.tracks.length);
    source.tracks.forEach((track, rank) => {
      const contribution = source.seed.weight * (1 - rank / total) * (source.origin === 'music' ? 1 : 0.7);
      const prev = merged.get(track.videoId);
      if (!prev) {
        merged.set(track.videoId, {
          track,
          consensus: contribution,
          hits: 1,
          fromMusic: source.origin === 'music',
          bestSeed: source.seed,
          bestContribution: contribution
        });
      } else {
        prev.consensus += contribution;
        prev.hits += 1;
        prev.fromMusic = prev.fromMusic || source.origin === 'music';
        if (!prev.track.artists && track.artists) prev.track = track;
        if (contribution > prev.bestContribution) {
          prev.bestContribution = contribution;
          prev.bestSeed = source.seed;
        }
      }
    });
  }

  // ---- Filters (cheap → specific) ----
  const passesHard = (c: { track: YouTubeTrack }): boolean =>
    !hardExcluded.has(c.track.videoId) && passesSongFilter(c.track, snapshot);
  const all = Array.from(merged.values()).filter(passesHard);
  let pool = all.filter((c) => !recent.has(c.track.videoId));
  if (pool.length < Math.min(limit, 4)) pool = all;

  // ---- Scoring ----
  const topChannels = new Map(profile.topChannels.map((c) => [nameKey(c.name), c.count]));
  const scored: ScoredCandidate[] = pool.map((c) => {
    const t = c.track;
    const artistKeys = splitArtistKeys(t.channel, t.artists);
    let score = c.consensus * 40 + Math.max(0, c.hits - 1) * 6;
    if (c.fromMusic) score += 6;
    score += hasRealVideo(t) ? 5 : -6;

    let affinity = 0;
    let bestArtist = '';
    let bestArtistScore = 0;
    for (const key of artistKeys) {
      const a = snapshot.affinity.get(key) ?? 0;
      affinity += a;
      if (a > bestArtistScore) {
        bestArtistScore = a;
        bestArtist = key;
      }
    }
    score += Math.max(-25, Math.min(18, affinity * 2));

    const chanCount = topChannels.get(nameKey(t.channel));
    if (chanCount) score += Math.min(8, 3 + chanCount * 1.5);

    if (profile.topKeywords.length > 0) {
      const tokens = new Set(tokenizeTasteText(t.title));
      let kw = 0;
      for (const k of profile.topKeywords) if (tokens.has(k.word)) kw += Math.min(2, k.weight);
      score += Math.min(6, kw);
    }

    if (profile.avgDurationSec > 0) {
      score += Math.max(0, 3 - Math.abs(t.durationSec - profile.avgDurationSec) / 60);
    }

    if (LIVE_TITLE.test(t.title)) score -= 6;
    if (!seedWantsCovers && COVER_TITLE.test(t.title)) score -= 8;
    if (!seedWantsKaraoke && KARAOKE_TITLE.test(t.title)) score -= 5;
    if (liked.has(t.videoId)) score += 4;

    const displayArtist = t.artists?.find((a) => nameKey(a) === bestArtist) ?? t.channel;
    const reason =
      bestArtistScore >= 3 ? `Te gusta ${displayArtist}` : reasonForSeed(c.bestSeed);

    return {
      track: t,
      score: Number(score.toFixed(3)),
      reason,
      primaryArtist: artistKeys[0] ?? nameKey(t.channel)
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // ---- Selection with diversity (dedupe song versions, cap per artist) ----
  const picked: ScoredCandidate[] = [];
  const overflow: ScoredCandidate[] = [];
  const songs = new Set<string>();
  const perArtist = new Map<string, number>();
  for (const c of scored) {
    const key = songKey(c.track);
    if (songs.has(key)) continue;
    songs.add(key);
    const count = perArtist.get(c.primaryArtist) ?? 0;
    if (count >= MAX_PER_ARTIST) {
      overflow.push(c);
      continue;
    }
    perArtist.set(c.primaryArtist, count + 1);
    picked.push(c);
    if (picked.length >= limit) break;
  }
  for (const c of overflow) {
    if (picked.length >= limit) break;
    picked.push(c);
  }

  return picked.map((c) => ({ ...c.track, recommendReason: c.reason }));
}

export class RecommendationEngine {
  private readonly cache = new Map<string, { at: number; result: SourceResult }>();

  constructor(
    private readonly sources: RecommendationSources,
    private readonly context: RecommendationContext,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random
  ) {}

  /** Chooses up to 3 seeds: current track, last session track, and a liked/reference song. */
  buildSeeds(request: RecommendationRequest, snapshot: TasteSnapshot, profile: HistoryTasteProfile): SeedSpec[] {
    const seeds: SeedSpec[] = [
      { videoId: request.seedVideoId, kind: 'current', weight: 1, title: request.seedTitle }
    ];
    const used = new Set([request.seedVideoId]);

    const sessionSeed = profile.recentVideoIds.find((id) => !used.has(id));
    if (sessionSeed) {
      seeds.push({ videoId: sessionSeed, kind: 'session', weight: 0.55 });
      used.add(sessionSeed);
    }

    const seedTitles = new Map(snapshot.seeds.map((s) => [s.videoId, s.title]));
    const likedPool = snapshot.likedVideoIds.slice(0, 25).filter((id) => !used.has(id));
    const referencePool = snapshot.seeds.map((s) => s.videoId).filter((id) => !used.has(id));
    const preferLiked = likedPool.length > 0 && (referencePool.length === 0 || this.random() < 0.6);
    const pool = preferLiked ? likedPool : referencePool;
    if (pool.length > 0) {
      const pick = pool[Math.floor(this.random() * pool.length) % pool.length];
      seeds.push({
        videoId: pick,
        kind: preferLiked ? 'liked' : 'reference',
        weight: 0.45,
        title: seedTitles.get(pick)
      });
    }
    return seeds;
  }

  private async fetchSource(seed: SeedSpec): Promise<SourceResult> {
    const cached = this.cache.get(seed.videoId);
    if (cached && this.now() - cached.at < RADIO_CACHE_TTL_MS) {
      return { ...cached.result, seed };
    }
    let result: SourceResult;
    try {
      const tracks = await this.sources.getMusicRadio(seed.videoId, 50);
      result = { seed, origin: 'music', tracks };
    } catch {
      result = { seed, origin: 'music', tracks: [] };
    }
    if (result.tracks.length === 0 && seed.kind === 'current') {
      // Not a song YouTube Music knows about: fall back to the regular related feed.
      try {
        result = { seed, origin: 'related', tracks: await this.sources.getRelatedTracks(seed.videoId, [], 30) };
      } catch {
        result = { seed, origin: 'related', tracks: [] };
      }
    }
    if (result.tracks.length > 0) {
      this.cache.set(seed.videoId, { at: this.now(), result });
    }
    return result;
  }

  async recommend(request: RecommendationRequest): Promise<YouTubeTrack[]> {
    const snapshot = this.context.getSnapshot();
    const profile = this.context.buildTasteProfile(100);
    const seeds = this.buildSeeds(request, snapshot, profile);
    const results = await Promise.all(seeds.map((s) => this.fetchSource(s)));
    return rankRadioCandidates(results, snapshot, profile, {
      excludeVideoIds: request.excludeVideoIds,
      limit: request.limit ?? 12,
      seedTitle: request.seedTitle
    });
  }
}
