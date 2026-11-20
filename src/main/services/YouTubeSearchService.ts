import type { HistoryTasteProfile, YouTubeTrack } from '../../shared/types';
import { tokenizeTasteText } from './HistoryAndCratesService';

export interface SearchPage {
  items: YouTubeTrack[];
  hasMore: boolean;
}

interface RawSearchResult {
  type?: string;
  video_id?: string;
  id?: string;
  title?: { toString(): string } | string;
  author?: { name?: string };
  duration?: { seconds?: number };
  length_text?: { toString(): string } | string;
  short_view_count?: { toString(): string } | string;
  view_count?: { toString(): string } | string;
  published?: { toString(): string } | string;
  thumbnails?: Array<{ url?: string; width?: number }>;
  thumbnail_overlays?: Array<{ text?: { toString(): string } | string }>;
  best_thumbnail?: { url?: string };
  is_live?: boolean;
  is_upcoming?: boolean;
  is_playable?: boolean;
}

export interface SearchResultPageLike {
  has_continuation?: boolean;
  results: RawSearchResult[];
  getContinuation(): Promise<SearchResultPageLike>;
}

export interface PlaylistResultPageLike {
  has_continuation?: boolean;
  items: RawSearchResult[];
  getContinuation(): Promise<PlaylistResultPageLike>;
}

export interface RawRelatedNode extends RawSearchResult {
  content_id?: string;
  content_type?: string;
  metadata?: {
    title?: { toString(): string } | string;
    metadata?: {
      metadata_rows?: Array<{
        metadata_parts?: Array<{ text?: { toString(): string } | string }>;
      }>;
    };
  };
  content_image?: {
    image?: Array<{ url?: string; width?: number }>;
    overlays?: Array<{
      badges?: Array<{ text?: string; style?: string }>;
    }>;
  };
}

/** Shape of a YouTube Music `PlaylistPanelVideo` node (radio / up-next queue item). */
export interface RawMusicPanelVideo {
  type?: string;
  video_id?: string;
  title?: { toString(): string } | string;
  author?: string;
  artists?: Array<{ name?: string }>;
  duration?: { seconds?: number; text?: string };
  thumbnail?: Array<{ url?: string; width?: number; height?: number }>;
}

export interface RawMusicPanelItem extends RawMusicPanelVideo {
  primary?: RawMusicPanelVideo | null;
  counterpart?: RawMusicPanelVideo[];
}

export interface MusicClientLike {
  getUpNext(videoId: string, automix?: boolean): Promise<{ contents?: RawMusicPanelItem[] }>;
}

export interface InnertubeClientLike {
  search(query: string, filters?: { type?: string }): Promise<SearchResultPageLike>;
  getSearchSuggestions(query: string): Promise<string[]>;
  getPlaylist(id: string): Promise<PlaylistResultPageLike>;
  getInfo?(videoId: string): Promise<{ watch_next_feed?: RawRelatedNode[] }>;
  music?: MusicClientLike;
}

function isWideThumbnail(v: RawMusicPanelVideo): boolean {
  const thumb = v.thumbnail?.[0];
  if (!thumb) return false;
  if (thumb.width && thumb.height) return thumb.width / thumb.height > 1.2;
  return typeof thumb.url === 'string' && thumb.url.includes('i.ytimg.com/vi/');
}

/**
 * Normalizes a YouTube Music radio item. Wrapped items carry both the song (square
 * album art) and its music-video counterpart; the video version is preferred because
 * this is a video DJ app.
 */
export function normalizeMusicPanelItem(item: RawMusicPanelItem): YouTubeTrack | null {
  if (!item || typeof item !== 'object') return null;
  const options: RawMusicPanelVideo[] = [];
  if (item.primary || item.counterpart) {
    if (item.primary) options.push(item.primary);
    options.push(...(item.counterpart ?? []));
  } else {
    options.push(item);
  }
  const chosen = options.find(isWideThumbnail) ?? options[0];
  if (!chosen) return null;

  const videoId = chosen.video_id;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const title = nodeText(chosen.title);
  if (!title) return null;

  let durationSec = Number(chosen.duration?.seconds ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    durationSec = parseDurationText(chosen.duration?.text);
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const artists = (chosen.artists ?? [])
    .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
    .filter(Boolean);
  const channel = (typeof chosen.author === 'string' && chosen.author.trim()) || artists.join(', ') || 'YouTube';
  const wide = isWideThumbnail(chosen);

  return {
    videoId,
    title,
    channel,
    durationSec,
    thumbnailUrl: wide
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : chosen.thumbnail?.[chosen.thumbnail.length - 1]?.url ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    isLive: false,
    ...(artists.length > 0 ? { artists } : {})
  };
}

export function parseDurationText(text?: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(trimmed)) return 0;
  const parts = trimmed.split(':').map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function nodeText(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (val && typeof val === 'object' && 'toString' in val && typeof val.toString === 'function') {
    const str = String(val).trim();
    return str === '[object Object]' ? '' : str;
  }
  return '';
}

function normalizeRelatedTrack(node: RawRelatedNode): YouTubeTrack | null {
  if (!node || typeof node !== 'object') return null;
  if (node.content_type && node.content_type !== 'VIDEO') return null;

  const videoId = node.content_id ?? node.video_id ?? node.id;
  if (!videoId || typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  if (node.is_live === true || node.is_upcoming === true || node.is_playable === false) {
    return null;
  }

  let durationSec = Number(node.duration?.seconds ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    const badges = node.content_image?.overlays?.flatMap((o) => o.badges ?? []) ?? [];
    for (const badge of badges) {
      if (badge?.style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE') return null;
      const parsed = parseDurationText(badge?.text);
      if (parsed > 0) {
        durationSec = parsed;
        break;
      }
    }
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const title = nodeText(node.metadata?.title ?? node.title);
  if (!title) return null;

  const channel =
    nodeText(node.author?.name) ||
    nodeText(node.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text) ||
    'YouTube';

  const thumbUrl =
    node.content_image?.image?.[0]?.url ??
    node.best_thumbnail?.url ??
    node.thumbnails?.[node.thumbnails.length - 1]?.url ??
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    videoId,
    title,
    channel,
    durationSec,
    thumbnailUrl: thumbUrl,
    isLive: false
  };
}

function pickBestThumbnail(node: RawSearchResult, videoId: string): string {
  if (node.best_thumbnail?.url) {
    return node.best_thumbnail.url;
  }
  const thumbs = node.thumbnails ?? [];
  if (thumbs.length === 0) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  let best = thumbs[thumbs.length - 1];
  for (const t of thumbs) {
    if ((t.width ?? 0) > (best?.width ?? 0)) {
      best = t;
    }
  }
  return best?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function normalizeTrack(node: RawSearchResult): YouTubeTrack | null {
  const videoId = node.video_id ?? node.id;
  if (!videoId || typeof videoId !== 'string') return null;

  if (node.is_live === true || node.is_upcoming === true) return null;
  if (node.is_playable === false) return null;

  let durationSec = Number(node.duration?.seconds ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    durationSec = parseDurationText(nodeText(node.length_text));
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    for (const ov of node.thumbnail_overlays ?? []) {
      const parsed = parseDurationText(nodeText(ov.text));
      if (parsed > 0) {
        durationSec = parsed;
        break;
      }
    }
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const titleRaw = typeof node.title === 'string' ? node.title : node.title?.toString() ?? '';
  const title = titleRaw.trim();
  if (!title) return null;

  const viewsText = nodeText(node.short_view_count ?? node.view_count);
  const publishedText = nodeText(node.published);

  return {
    videoId,
    title,
    channel: node.author?.name?.trim() || 'YouTube',
    durationSec,
    thumbnailUrl: pickBestThumbnail(node, videoId),
    isLive: false,
    ...(viewsText ? { viewsText } : {}),
    ...(publishedText ? { publishedText } : {})
  };
}

export function scoreRecommendationCandidate(
  track: YouTubeTrack,
  seedRankIndex: number,
  totalCandidates: number,
  profile: HistoryTasteProfile
): number {
  const safeTotal = Math.max(1, totalCandidates);
  const seedScore = ((safeTotal - seedRankIndex) / safeTotal) * 70; // ~70% anchored on last played track

  let channelBoost = 0;
  const chanLower = track.channel.toLowerCase();
  const chanMatch = profile.topChannels.find((c) => c.name.toLowerCase() === chanLower);
  if (chanMatch) {
    channelBoost = Math.min(16, 6 + chanMatch.count * 3);
  }

  let keywordBoost = 0;
  if (profile.topKeywords.length > 0) {
    const tokens = new Set(tokenizeTasteText(`${track.title} ${track.channel}`));
    for (const kw of profile.topKeywords) {
      if (tokens.has(kw.word)) {
        keywordBoost += Math.min(4, kw.weight);
      }
    }
    keywordBoost = Math.min(10, keywordBoost);
  }

  let durationBoost = 0;
  if (profile.avgDurationSec > 0 && track.durationSec > 0) {
    durationBoost = Math.max(0, 4 - Math.abs(track.durationSec - profile.avgDurationSec) / 45);
  }

  return Number((seedScore + channelBoost + keywordBoost + durationBoost).toFixed(3));
}

export function extractPlaylistId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (!trimmed) {
    throw new Error('Playlist URL or ID is empty');
  }
  try {
    const parsed = new URL(trimmed);
    const listParam = parsed.searchParams.get('list');
    if (listParam && /^[A-Za-z0-9_-]{10,}$/.test(listParam)) {
      return listParam;
    }
  } catch {
    // not a URL, try raw playlist ID
  }
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error('Invalid YouTube playlist URL or ID');
}

function toFriendlyYouTubeError(err: unknown): Error {
  if (err instanceof YouTubeTimeoutError) {
    return new Error('YouTube tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.');
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`No se pudo contactar a YouTube: ${message}`);
}

async function defaultClientFactory(): Promise<InnertubeClientLike> {
  const { Innertube, Log } = await import('youtubei.js');
  Log.setLevel(Log.Level.NONE);
  const yt = await Innertube.create();
  return yt as unknown as InnertubeClientLike;
}

export const DEFAULT_YOUTUBE_TIMEOUT_MS = 12_000;

export class YouTubeTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`YouTube no respondió en ${Math.round(ms / 1000)} s (${label})`);
    this.name = 'YouTubeTimeoutError';
  }
}

export interface YouTubeSearchOptions {
  /** Max time for one YouTube request (client creation counts separately). */
  timeoutMs?: number;
  /** Extra attempts after a timeout or failure, each with a fresh client. */
  retries?: number;
}

/** Rejects if `promise` does not settle within `ms` (the underlying request is abandoned). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new YouTubeTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class YouTubeSearchService {
  private readonly clientFactory: () => Promise<InnertubeClientLike>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private clientPromise: Promise<InnertubeClientLike> | null = null;
  private currentSearchPage: SearchResultPageLike | null = null;

  constructor(
    clientFactory: () => Promise<InnertubeClientLike> = defaultClientFactory,
    options: YouTubeSearchOptions = {}
  ) {
    this.clientFactory = clientFactory;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_YOUTUBE_TIMEOUT_MS;
    this.retries = Math.max(0, options.retries ?? 1);
  }

  /**
   * Runs one YouTube request with a timeout. A hung or failed request usually means a
   * stale session, so the client is dropped and the request retried with a fresh one.
   */
  private async withClient<T>(label: string, fn: (client: InnertubeClientLike) => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const client = await withTimeout(this.getClient(), this.timeoutMs, label);
        return await withTimeout(fn(client), this.timeoutMs, label);
      } catch (err) {
        lastError = err;
        this.clientPromise = null;
      }
    }
    throw toFriendlyYouTubeError(lastError);
  }

  /** Same timeout/retry policy for continuation pages, which carry their own session. */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await withTimeout(fn(), this.timeoutMs, label);
      } catch (err) {
        lastError = err;
      }
    }
    throw toFriendlyYouTubeError(lastError);
  }

  private async getClient(): Promise<InnertubeClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = this.clientFactory().catch((err) => {
        this.clientPromise = null;
        throw err;
      });
    }
    return this.clientPromise;
  }

  async search(query: string): Promise<SearchPage> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { items: [], hasMore: false };
    }
    const page = await this.withClient('búsqueda', (client) => client.search(trimmed, { type: 'video' }));
    this.currentSearchPage = page;
    const items = page.results
      .map(normalizeTrack)
      .filter((t): t is YouTubeTrack => t !== null);

    return {
      items,
      hasMore: Boolean(page.has_continuation)
    };
  }

  async nextPage(): Promise<SearchPage> {
    if (!this.currentSearchPage || !this.currentSearchPage.has_continuation) {
      return { items: [], hasMore: false };
    }
    const current = this.currentSearchPage;
    const next = await this.withRetry('más resultados', () => current.getContinuation());
    this.currentSearchPage = next;
    const items = next.results
      .map(normalizeTrack)
      .filter((t): t is YouTubeTrack => t !== null);

    return {
      items,
      hasMore: Boolean(next.has_continuation)
    };
  }

  async getSuggestions(query: string): Promise<string[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const list = await this.withClient('sugerencias', (client) => client.getSearchSuggestions(trimmed));
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  }

  async getPlaylistTracks(urlOrId: string, maxPages = 5): Promise<YouTubeTrack[]> {
    const listId = extractPlaylistId(urlOrId);
    let page = await this.withClient('playlist', (client) => client.getPlaylist(listId));
    const tracks: YouTubeTrack[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < maxPages; i += 1) {
      for (const raw of page.items) {
        const track = normalizeTrack(raw);
        if (track && !seen.has(track.videoId)) {
          seen.add(track.videoId);
          tracks.push(track);
        }
      }
      if (!page.has_continuation) break;
      const current = page;
      page = await this.withRetry('playlist', () => current.getContinuation());
    }

    return tracks;
  }

  async getRelatedTracks(
    videoId: string,
    excludeVideoIds: string[] = [],
    limit = 12
  ): Promise<YouTubeTrack[]> {
    const trimmed = videoId.trim();
    if (!trimmed) return [];
    const info = await this.withClient('relacionados', async (client) =>
      typeof client.getInfo === 'function' ? client.getInfo(trimmed) : { watch_next_feed: [] }
    );
    const feed = Array.isArray(info.watch_next_feed) ? info.watch_next_feed : [];
    const excluded = new Set<string>([trimmed, ...excludeVideoIds]);
    const tracks: YouTubeTrack[] = [];

    for (const raw of feed) {
      const track = normalizeRelatedTrack(raw);
      if (!track) continue;
      if (track.isLive || track.durationSec < 30 || track.durationSec > 1200) continue;
      if (excluded.has(track.videoId)) continue;
      excluded.add(track.videoId);
      tracks.push(track);
      if (tracks.length >= limit) break;
    }

    return tracks;
  }

  /**
   * YouTube Music radio ("automix") for a seed video: a curated, songs-only list.
   * Returns an empty list when the music client is unavailable or the seed is not a song.
   */
  async getMusicRadio(videoId: string, limit = 50): Promise<YouTubeTrack[]> {
    const trimmed = videoId.trim();
    if (!trimmed) return [];
    const panel = await this.withClient('radio YT Music', async (client) =>
      client.music && typeof client.music.getUpNext === 'function'
        ? client.music.getUpNext(trimmed, true)
        : { contents: [] }
    );
    const contents = Array.isArray(panel?.contents) ? panel.contents : [];
    const seen = new Set<string>([trimmed]);
    const tracks: YouTubeTrack[] = [];
    for (const raw of contents) {
      const track = normalizeMusicPanelItem(raw);
      if (!track || seen.has(track.videoId)) continue;
      seen.add(track.videoId);
      tracks.push(track);
      if (tracks.length >= limit) break;
    }
    return tracks;
  }

  async getHistoryWeightedRecommendations(
    seedVideoId: string,
    profile: HistoryTasteProfile,
    excludeVideoIds: string[] = [],
    limit = 12
  ): Promise<YouTubeTrack[]> {
    const hardExcluded = new Set<string>([seedVideoId, ...excludeVideoIds]);
    const softExcluded = new Set<string>([...hardExcluded, ...profile.recentVideoIds]);

    const rawCandidates = await this.getRelatedTracks(seedVideoId, [], Math.max(limit * 2, 24));
    let filtered = rawCandidates.filter((t) => !softExcluded.has(t.videoId));
    if (filtered.length === 0) {
      filtered = rawCandidates.filter((t) => !hardExcluded.has(t.videoId));
    }

    const total = filtered.length;
    const ranked = filtered
      .map((track, idx) => ({
        track,
        score: scoreRecommendationCandidate(track, idx, total, profile)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.track);

    return ranked;
  }
}

