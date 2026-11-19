import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ResolvedStream } from '../../shared/types';
import type { YtDlpBinaryManager } from './YtDlpBinaryManager';

const execFileAsync = promisify(execFile);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const CACHE_LIMIT = 100;
const EXPIRY_SAFETY_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 3600 * 1000;

export interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  tbr?: number;
  abr?: number;
  url?: string;
  protocol?: string;
}

export interface YtDlpInfoJson {
  formats?: YtDlpFormat[];
  is_live?: boolean;
}

export type YtDlpRunner = (videoId: string) => Promise<YtDlpInfoJson>;
export type InnertubeFallbackResolver = (videoId: string) => Promise<ResolvedStream>;

function extractExpireMs(urls: Array<string | undefined>): number {
  const expirations: number[] = [];
  for (const rawUrl of urls) {
    if (!rawUrl) continue;
    try {
      const u = new URL(rawUrl);
      const exp = u.searchParams.get('expire');
      if (exp) {
        const sec = Number(exp);
        if (Number.isFinite(sec) && sec > 0) {
          expirations.push(sec * 1000);
        }
      }
    } catch {
      // ignore invalid URL parse
    }
  }
  return expirations.length > 0 ? Math.min(...expirations) : Date.now() + DEFAULT_TTL_MS;
}

function isHttpProtocol(fmt: YtDlpFormat): boolean {
  if (!fmt.url || !fmt.url.startsWith('http')) return false;
  if (fmt.protocol && (fmt.protocol.includes('m3u8') || fmt.protocol.includes('dash'))) {
    return false;
  }
  return true;
}

function formatMime(fmt: YtDlpFormat, kind: 'muxed' | 'video' | 'audio'): string {
  const ext = fmt.ext?.toLowerCase();
  if (kind === 'audio') {
    return ext === 'webm' || ext === 'opus' ? 'audio/webm' : 'audio/mp4';
  }
  return ext === 'webm' ? 'video/webm' : 'video/mp4';
}

function selectBestFormats(videoId: string, info: YtDlpInfoJson): ResolvedStream {
  if (info.is_live) {
    throw new Error('Livestreams cannot be mixed in TubeDeck VDJ');
  }

  const formats = (info.formats ?? []).filter(isHttpProtocol);

  const muxedCandidates = formats
    .filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        f.acodec &&
        f.acodec !== 'none' &&
        (f.height ?? 0) <= 1080 &&
        (f.fps ?? 30) <= 60
    )
    .sort((a, b) => {
      const aMp4 = a.ext === 'mp4' ? 1 : 0;
      const bMp4 = b.ext === 'mp4' ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      const hDiff = (b.height ?? 0) - (a.height ?? 0);
      if (hDiff !== 0) return hDiff;
      return (b.tbr ?? 0) - (a.tbr ?? 0);
    });

  if (muxedCandidates.length > 0) {
    const chosen = muxedCandidates[0];
    return {
      videoId,
      mode: 'muxed',
      muxedUrl: chosen.url!,
      expiresAtMs: extractExpireMs([chosen.url]),
      mimeTypes: { muxed: formatMime(chosen, 'muxed') }
    };
  }

  const videoCandidates = formats
    .filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        (f.height ?? 0) <= 1080 &&
        (f.fps ?? 30) <= 60
    )
    .sort((a, b) => {
      const hDiff = (b.height ?? 0) - (a.height ?? 0);
      if (hDiff !== 0) return hDiff;
      const aMp4 = a.ext === 'mp4' ? 1 : 0;
      const bMp4 = b.ext === 'mp4' ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return (b.tbr ?? 0) - (a.tbr ?? 0);
    });

  const audioCandidates = formats
    .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => {
      const aM4a = a.ext === 'm4a' || a.ext === 'mp4' ? 1 : 0;
      const bM4a = b.ext === 'm4a' || b.ext === 'mp4' ? 1 : 0;
      if (aM4a !== bM4a) return bM4a - aM4a;
      return (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0);
    });

  if (videoCandidates.length > 0 && audioCandidates.length > 0) {
    const v = videoCandidates[0];
    const a = audioCandidates[0];
    return {
      videoId,
      mode: 'dash-split',
      videoUrl: v.url!,
      audioUrl: a.url!,
      expiresAtMs: extractExpireMs([v.url, a.url]),
      mimeTypes: {
        video: formatMime(v, 'video'),
        audio: formatMime(a, 'audio')
      }
    };
  }

  throw new Error(`No compatible streaming formats found for ${videoId}`);
}

export function createDefaultYtDlpRunner(binaryManager: YtDlpBinaryManager): YtDlpRunner {
  return async (videoId: string): Promise<YtDlpInfoJson> => {
    const binPath = await binaryManager.ensureInstalled();
    const { stdout } = await execFileAsync(
      binPath,
      ['-J', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`],
      {
        timeout: 15_000,
        maxBuffer: 12 * 1024 * 1024
      }
    );
    return JSON.parse(stdout) as YtDlpInfoJson;
  };
}

export async function defaultInnertubeFallback(videoId: string): Promise<ResolvedStream> {
  const { Innertube } = await import('youtubei.js');
  const yt = await Innertube.create();
  const info = await yt.getBasicInfo(videoId);
  const streaming = info.streaming_data;
  if (!streaming) {
    throw new Error(`No Innertube streaming data for ${videoId}`);
  }

  const muxed = streaming.formats?.find((f) => f.has_audio && f.has_video && (f.height ?? 0) <= 1080);
  if (muxed) {
    const url = await muxed.decipher(yt.session.player);
    return {
      videoId,
      mode: 'muxed',
      muxedUrl: url,
      expiresAtMs: extractExpireMs([url]),
      mimeTypes: { muxed: 'video/mp4' }
    };
  }

  const videoFmt = streaming.adaptive_formats?.find(
    (f) => f.has_video && !f.has_audio && (f.height ?? 0) <= 1080
  );
  const audioFmt = streaming.adaptive_formats?.find((f) => f.has_audio && !f.has_video);
  if (videoFmt && audioFmt) {
    const [videoUrl, audioUrl] = await Promise.all([
      videoFmt.decipher(yt.session.player),
      audioFmt.decipher(yt.session.player)
    ]);
    return {
      videoId,
      mode: 'dash-split',
      videoUrl,
      audioUrl,
      expiresAtMs: extractExpireMs([videoUrl, audioUrl]),
      mimeTypes: { video: 'video/mp4', audio: 'audio/mp4' }
    };
  }

  throw new Error(`No Innertube fallback streams available for ${videoId}`);
}

export class StreamResolverService {
  private readonly runner: YtDlpRunner;
  private readonly fallbackResolver: InnertubeFallbackResolver;
  private readonly cache = new Map<string, ResolvedStream>();
  private readonly inFlight = new Map<string, Promise<ResolvedStream>>();

  constructor(
    runner: YtDlpRunner,
    fallbackResolver: InnertubeFallbackResolver = defaultInnertubeFallback
  ) {
    this.runner = runner;
    this.fallbackResolver = fallbackResolver;
  }

  async resolve(videoId: string): Promise<ResolvedStream> {
    if (!VIDEO_ID_REGEX.test(videoId)) {
      throw new Error(`Invalid videoId: ${videoId}`);
    }

    const cached = this.cache.get(videoId);
    if (cached && Date.now() < cached.expiresAtMs - EXPIRY_SAFETY_MS) {
      // refresh LRU order
      this.cache.delete(videoId);
      this.cache.set(videoId, cached);
      return cached;
    }

    return this.resolveFresh(videoId);
  }

  async invalidateAndResolve(videoId: string): Promise<ResolvedStream> {
    if (!VIDEO_ID_REGEX.test(videoId)) {
      throw new Error(`Invalid videoId: ${videoId}`);
    }
    this.cache.delete(videoId);
    return this.resolveFresh(videoId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async resolveFresh(videoId: string): Promise<ResolvedStream> {
    const existingFlight = this.inFlight.get(videoId);
    if (existingFlight) {
      return existingFlight;
    }

    const promise = (async () => {
      try {
        const info = await this.runner(videoId);
        const resolved = selectBestFormats(videoId, info);
        this.putCache(videoId, resolved);
        return resolved;
      } catch (primaryErr) {
        try {
          const fallback = await this.fallbackResolver(videoId);
          this.putCache(videoId, fallback);
          return fallback;
        } catch (fallbackErr) {
          const msgA = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
          const msgB = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(`Failed to resolve stream for ${videoId}: ${msgA}; fallback: ${msgB}`);
        }
      }
    })().finally(() => {
      this.inFlight.delete(videoId);
    });

    this.inFlight.set(videoId, promise);
    return promise;
  }

  private putCache(videoId: string, entry: ResolvedStream): void {
    if (this.cache.has(videoId)) {
      this.cache.delete(videoId);
    } else if (this.cache.size >= CACHE_LIMIT) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(videoId, entry);
  }
}
