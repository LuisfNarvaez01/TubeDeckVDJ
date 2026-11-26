import fs from 'fs';
import path from 'path';
import type { ResolvedStream, YouTubeTrack } from '../../shared/types';

/**
 * Disk cache of YouTube songs that already played. A cached song loads without asking YouTube
 * (no yt-dlp resolve, no network) and still plays when the internet is down, which is what lets
 * Automix keep going offline. Audio is saved first (small, what matters most); the video follows,
 * throttled so it does not compete with the live stream on a weak connection.
 */

export interface CachedFile {
  file: string;
  mime: string;
  bytes: number;
}

export interface MediaCacheEntry {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  audio?: CachedFile;
  video?: CachedFile;
  muxed?: CachedFile;
  savedAtMs: number;
  lastUsedMs: number;
}

export interface MediaCacheUsage {
  bytes: number;
  maxBytes: number;
  songs: number;
  withVideo: number;
}

export interface MediaCacheOptions {
  maxBytes?: number;
  saveVideo?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Bytes per second for video downloads (audio is not throttled). */
  videoBytesPerSec?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Wait after a song is loaded before saving it. Saving right away competed with the
   * deck's own first chunks from the same YouTube servers, and the first load of a song
   * stayed at 00:00 until it was loaded again.
   */
  captureDelayMs?: number;
}

/** Default wait before saving a song that just started (see `captureDelayMs`). */
export const CAPTURE_DELAY_MS = 30_000;

export type CaptureMeta = Pick<YouTubeTrack, 'title' | 'channel' | 'durationSec' | 'thumbnailUrl'>;

const INDEX_FILE = 'index.json';
const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 600 * 1024 * 1024;
const CHUNK_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BYTES = 5 * 1024 ** 3;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;

function extFor(mime: string): string {
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('audio/mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('mpeg')) return '.mp3';
  return '.mp4';
}

export class MediaCache {
  private entries = new Map<string, MediaCacheEntry>();
  private queue: Array<{ videoId: string; resolved: ResolvedStream; meta: CaptureMeta; readyAtMs: number }> = [];
  private readonly captureDelayMs: number;
  private running = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private maxBytes: number;
  private saveVideo: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly videoBytesPerSec: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private listeners = new Set<() => void>();

  constructor(
    private readonly dir: string,
    options: MediaCacheOptions = {}
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.saveVideo = options.saveVideo ?? true;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.videoBytesPerSec = options.videoBytesPerSec ?? 1_500_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.captureDelayMs = options.captureDelayMs ?? CAPTURE_DELAY_MS;
    fs.mkdirSync(dir, { recursive: true });
    this.loadIndex();
  }

  /** Called after the set of cached songs changes. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  configure(opts: { maxBytes?: number; saveVideo?: boolean }): void {
    if (opts.maxBytes && opts.maxBytes > 0) this.maxBytes = opts.maxBytes;
    if (typeof opts.saveVideo === 'boolean') this.saveVideo = opts.saveVideo;
    this.evict();
  }

  /** The entry when its files are on disk (and marks it as used). */
  get(videoId: string): MediaCacheEntry | null {
    const e = this.entries.get(videoId);
    if (!e) return null;
    const files = [e.audio, e.video, e.muxed].filter((f): f is CachedFile => Boolean(f));
    if (files.length === 0 || files.some((f) => !fs.existsSync(this.abs(f)))) {
      this.remove(videoId);
      return null;
    }
    e.lastUsedMs = this.now();
    this.scheduleSave();
    return e;
  }

  /** Has picture and sound, so it can replace the YouTube stream completely. */
  isComplete(e: MediaCacheEntry): boolean {
    return Boolean(e.muxed || (e.audio && e.video));
  }

  abs(f: CachedFile): string {
    return path.join(this.dir, f.file);
  }

  list(): YouTubeTrack[] {
    return [...this.entries.values()]
      .filter((e) => e.audio || e.muxed)
      .sort((a, b) => b.lastUsedMs - a.lastUsedMs)
      .map((e) => ({
        videoId: e.videoId,
        title: e.title,
        channel: e.channel,
        durationSec: e.durationSec,
        thumbnailUrl: e.thumbnailUrl,
        isLive: false
      }));
  }

  usage(): MediaCacheUsage {
    let bytes = 0;
    let withVideo = 0;
    for (const e of this.entries.values()) {
      bytes += (e.audio?.bytes ?? 0) + (e.video?.bytes ?? 0) + (e.muxed?.bytes ?? 0);
      if (this.isComplete(e)) withVideo += 1;
    }
    return { bytes, maxBytes: this.maxBytes, songs: this.entries.size, withVideo };
  }

  clear(): void {
    this.queue = [];
    for (const id of [...this.entries.keys()]) this.remove(id, false);
    this.saveIndexNow();
    this.emit();
  }

  /** Saves a song in the background (one at a time). Live streams and duplicates are skipped. */
  capture(videoId: string, resolved: ResolvedStream, meta: CaptureMeta): void {
    if (!VALID_ID.test(videoId) || (meta.durationSec ?? 0) > 20 * 60) return;
    const existing = this.entries.get(videoId);
    if (existing && (this.isComplete(existing) || !this.saveVideo)) return;
    if (this.queue.some((j) => j.videoId === videoId)) return;
    this.queue.push({ videoId, resolved, meta, readyAtMs: this.now() + this.captureDelayMs });
    if (!this.running) void this.drain();
  }

  /** Resolves when the background queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        const wait = job.readyAtMs - this.now();
        if (wait > 0) await this.sleep(wait);
        try {
          await this.captureNow(job.videoId, job.resolved, job.meta);
        } catch {
          // Network hiccup or expired URL: the song will be tried again the next time it plays.
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async captureNow(videoId: string, r: ResolvedStream, meta: CaptureMeta): Promise<void> {
    const entry: MediaCacheEntry = this.entries.get(videoId) ?? {
      videoId,
      title: meta.title,
      channel: meta.channel,
      durationSec: meta.durationSec,
      thumbnailUrl: meta.thumbnailUrl,
      savedAtMs: this.now(),
      lastUsedMs: this.now()
    };
    if (r.mode === 'muxed') {
      const url = r.muxedUrl;
      if (!url || entry.muxed) return;
      entry.muxed = await this.download(url, `${videoId}.muxed`, r.mimeTypes.muxed ?? 'video/mp4', false);
      this.commit(entry);
      return;
    }
    if (!entry.audio && r.audioUrl) {
      // Throttled too: a full-speed download stole bandwidth from the decks.
      entry.audio = await this.download(r.audioUrl, `${videoId}.audio`, r.mimeTypes.audio ?? 'audio/mp4', true);
      this.commit(entry);
    }
    if (this.saveVideo && !entry.video) {
      const variant = r.videoVariants?.['720p'] ?? r.videoVariants?.['480p'];
      const url = variant?.url ?? r.videoUrl;
      const mime = variant?.mimeType ?? r.mimeTypes.video ?? 'video/mp4';
      if (url) {
        entry.video = await this.download(url, `${videoId}.video`, mime, true);
        this.commit(entry);
      }
    }
  }

  private commit(entry: MediaCacheEntry): void {
    this.entries.set(entry.videoId, entry);
    this.evict(entry.videoId);
    this.saveIndexNow();
    this.emit();
  }

  /** Downloads in 2 MB ranges (YouTube throttles open-ended requests) to a .part, then renames. */
  private async download(url: string, base: string, mime: string, throttle: boolean): Promise<CachedFile> {
    const file = `${base}${extFor(mime)}`;
    const dest = path.join(this.dir, file);
    const part = `${dest}.part`;
    const fd = fs.openSync(part, 'w');
    let written = 0;
    try {
      let total = Infinity;
      while (written < total) {
        const t0 = this.now();
        const res = await this.fetchImpl(url, {
          headers: {
            Range: `bytes=${written}-${written + CHUNK_BYTES - 1}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://www.youtube.com/'
          },
          signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS)
        });
        if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) break;
        fs.writeSync(fd, buf);
        written += buf.length;
        const range = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
        total = res.status === 200 ? written : range ? Number(range[1]) : written;
        if (written > MAX_FILE_BYTES) throw new Error('Archivo demasiado grande para la caché');
        if (throttle && written < total) {
          const minMs = (buf.length / this.videoBytesPerSec) * 1000;
          const spent = this.now() - t0;
          if (spent < minMs) await this.sleep(minMs - spent);
        }
      }
    } catch (err) {
      fs.closeSync(fd);
      fs.rmSync(part, { force: true });
      throw err;
    }
    fs.closeSync(fd);
    fs.renameSync(part, dest);
    return { file, mime, bytes: written };
  }

  /** Drops the least recently used songs until the cache fits (never the one just saved). */
  private evict(keep?: string): void {
    let { bytes } = this.usage();
    if (bytes <= this.maxBytes) return;
    const byAge = [...this.entries.values()]
      .filter((e) => e.videoId !== keep)
      .sort((a, b) => a.lastUsedMs - b.lastUsedMs);
    for (const e of byAge) {
      if (bytes <= this.maxBytes) break;
      bytes -= (e.audio?.bytes ?? 0) + (e.video?.bytes ?? 0) + (e.muxed?.bytes ?? 0);
      this.remove(e.videoId, false);
    }
    this.saveIndexNow();
  }

  private remove(videoId: string, save = true): void {
    const e = this.entries.get(videoId);
    if (!e) return;
    for (const f of [e.audio, e.video, e.muxed]) {
      if (f) fs.rmSync(this.abs(f), { force: true });
    }
    this.entries.delete(videoId);
    if (save) {
      this.saveIndexNow();
      this.emit();
    }
  }

  private loadIndex(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, INDEX_FILE), 'utf8')) as MediaCacheEntry[];
      for (const e of Array.isArray(raw) ? raw : []) {
        if (e && VALID_ID.test(e.videoId)) this.entries.set(e.videoId, e);
      }
    } catch {
      // first run or damaged index: start empty
    }
    // Leftovers of downloads interrupted by closing the app.
    for (const name of fs.readdirSync(this.dir)) {
      if (name.endsWith('.part')) fs.rmSync(path.join(this.dir, name), { force: true });
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveIndexNow();
    }, 3000);
  }

  private saveIndexNow(): void {
    const tmp = path.join(this.dir, `${INDEX_FILE}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify([...this.entries.values()]));
    fs.renameSync(tmp, path.join(this.dir, INDEX_FILE));
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
