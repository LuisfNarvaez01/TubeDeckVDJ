import type { YouTubeTrack } from '../../shared/types';

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
  thumbnails?: Array<{ url?: string; width?: number }>;
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

export interface InnertubeClientLike {
  search(query: string, filters?: { type?: string }): Promise<SearchResultPageLike>;
  getSearchSuggestions(query: string): Promise<string[]>;
  getPlaylist(id: string): Promise<PlaylistResultPageLike>;
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

  const durationSec = Number(node.duration?.seconds ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const titleRaw = typeof node.title === 'string' ? node.title : node.title?.toString() ?? '';
  const title = titleRaw.trim();
  if (!title) return null;

  return {
    videoId,
    title,
    channel: node.author?.name?.trim() || 'YouTube',
    durationSec,
    thumbnailUrl: pickBestThumbnail(node, videoId),
    isLive: false
  };
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

async function defaultClientFactory(): Promise<InnertubeClientLike> {
  const { Innertube } = await import('youtubei.js');
  const yt = await Innertube.create();
  return yt as unknown as InnertubeClientLike;
}

export class YouTubeSearchService {
  private readonly clientFactory: () => Promise<InnertubeClientLike>;
  private clientPromise: Promise<InnertubeClientLike> | null = null;
  private currentSearchPage: SearchResultPageLike | null = null;

  constructor(clientFactory: () => Promise<InnertubeClientLike> = defaultClientFactory) {
    this.clientFactory = clientFactory;
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
    const client = await this.getClient();
    const page = await client.search(trimmed, { type: 'video' });
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
    const next = await this.currentSearchPage.getContinuation();
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
    const client = await this.getClient();
    const list = await client.getSearchSuggestions(trimmed);
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  }

  async getPlaylistTracks(urlOrId: string, maxPages = 5): Promise<YouTubeTrack[]> {
    const listId = extractPlaylistId(urlOrId);
    const client = await this.getClient();
    let page = await client.getPlaylist(listId);
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
      page = await page.getContinuation();
    }

    return tracks;
  }
}

