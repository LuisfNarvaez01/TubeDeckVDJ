import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ResolvedStream, VideoQualityTier } from '../../shared/types';
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

function codecScore(vcodec?: string): number {
  const vc = (vcodec ?? '').toLowerCase();
  if (vc.startsWith('avc1') || vc.includes('h264')) return 3; // hardware-decoded H.264 everywhere
  if (vc.startsWith('vp9') || vc.includes('vp09')) return 2;
  return 1; // av01 / others (heavier CPU if no hardware AV1)
}

function compareVideoFormats(a: YtDlpFormat, b: YtDlpFormat): number {
  const codecDiff = codecScore(b.vcodec) - codecScore(a.vcodec);
  if (codecDiff !== 0) return codecDiff;
  const hDiff = (b.height ?? 0) - (a.height ?? 0);
  if (hDiff !== 0) return hDiff;
  const aFps = (a.fps ?? 30) <= 30 ? 1 : 0;
  const bFps = (b.fps ?? 30) <= 30 ? 1 : 0;
  if (aFps !== bFps) return bFps - aFps;
  const aMp4 = a.ext === 'mp4' ? 1 : 0;
  const bMp4 = b.ext === 'mp4' ? 1 : 0;
  if (aMp4 !== bMp4) return bMp4 - aMp4;
  return (b.tbr ?? 0) - (a.tbr ?? 0);
}

const TIER_RANGES: Array<{ tier: VideoQualityTier; minH: number; maxH: number }> = [
  { tier: '1080p', minH: 900, maxH: 1080 },
  { tier: '720p', minH: 600, maxH: 899 },
  { tier: '480p', minH: 420, maxH: 599 },
  { tier: '360p', minH: 240, maxH: 419 }
];

function selectBestFormats(videoId: string, info: YtDlpInfoJson): ResolvedStream {
  if (info.is_live) {
    throw new Error('Livestreams cannot be mixed in Proyecta');
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

  const videoCandidates = formats
    .filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        (f.height ?? 0) <= 1080 &&
        (f.fps ?? 30) <= 60
    )
    .sort(compareVideoFormats);

  const audioCandidates = formats
    .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => {
      const aM4a = a.ext === 'm4a' || a.ext === 'mp4' ? 1 : 0;
      const bM4a = b.ext === 'm4a' || b.ext === 'mp4' ? 1 : 0;
      if (aM4a !== bM4a) return bM4a - aM4a;
      return (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0);
    });

  // Prefer high-quality muxed MP4 (>= 480p) only when multi-tier DASH variants aren't present
  if (
    muxedCandidates.length > 0 &&
    (muxedCandidates[0].height ?? 0) >= 480 &&
    (videoCandidates.length === 0 || audioCandidates.length === 0)
  ) {
    const chosen = muxedCandidates[0];
    return {
      videoId,
      mode: 'muxed',
      muxedUrl: chosen.url!,
      expiresAtMs: extractExpireMs([chosen.url]),
      mimeTypes: { muxed: formatMime(chosen, 'muxed') }
    };
  }

  if (videoCandidates.length > 0 && audioCandidates.length > 0) {
    const videoVariants: ResolvedStream['videoVariants'] = {};
    for (const { tier, minH, maxH } of TIER_RANGES) {
      const match = videoCandidates.find((f) => {
        const h = f.height ?? 0;
        return h >= minH && h <= maxH;
      });
      if (match?.url) {
        videoVariants[tier] = { url: match.url, mimeType: formatMime(match, 'video') };
      }
    }

    // Default to 720p H.264 for rock-solid smooth playback without buffering stalls
    const primaryVideo =
      videoCandidates.find((f) => (f.height ?? 0) >= 600 && (f.height ?? 0) <= 899) ??
      videoCandidates.find((f) => (f.height ?? 0) >= 420 && (f.height ?? 0) <= 599) ??
      videoCandidates[0];
    const primaryAudio = audioCandidates[0];

    const allUrls = [
      primaryVideo.url,
      primaryAudio.url,
      ...Object.values(videoVariants).map((v) => v.url)
    ];

    return {
      videoId,
      mode: 'dash-split',
      videoUrl: primaryVideo.url!,
      audioUrl: primaryAudio.url!,
      videoVariants,
      expiresAtMs: extractExpireMs(allUrls),
      mimeTypes: {
        video: formatMime(primaryVideo, 'video'),
        audio: formatMime(primaryAudio, 'audio')
      }
    };
  }

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
  const { Innertube, Log } = await import('youtubei.js');
  Log.setLevel(Log.Level.NONE);
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

  const videoFmt =
    streaming.adaptive_formats?.find(
      (f) => f.has_video && !f.has_audio && (f.height ?? 0) <= 720 && (f.height ?? 0) >= 360
    ) ??
    streaming.adaptive_formats?.find(
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
      videoVariants: { '720p': { url: videoUrl, mimeType: 'video/mp4' } },
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
