import crypto from 'crypto';
import fs from 'fs';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ResolvedStream, VideoQualityTier } from '../../shared/types';

export type StreamRole = 'muxed' | 'video' | 'audio';

export interface StreamResolverLike {
  resolve(videoId: string): Promise<ResolvedStream>;
  invalidateAndResolve(videoId: string): Promise<ResolvedStream>;
}

const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VALID_ROLES = new Set<StreamRole>(['muxed', 'video', 'audio']);
const VALID_QUALITIES = new Set<VideoQualityTier>(['1080p', '720p', '480p', '360p']);
const VIDEO_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB bounded chunk prevents YouTube CDN open-range throttling
const UPSTREAM_TIMEOUT_MS = 12_000;

const LOCAL_MIME_MAP: Record<string, { mimeType: string; mediaKind: 'video' | 'audio' }> = {
  '.mp4': { mimeType: 'video/mp4', mediaKind: 'video' },
  '.m4v': { mimeType: 'video/mp4', mediaKind: 'video' },
  '.webm': { mimeType: 'video/webm', mediaKind: 'video' },
  '.mkv': { mimeType: 'video/x-matroska', mediaKind: 'video' },
  '.mov': { mimeType: 'video/quicktime', mediaKind: 'video' },
  '.mp3': { mimeType: 'audio/mpeg', mediaKind: 'audio' },
  '.wav': { mimeType: 'audio/wav', mediaKind: 'audio' },
  '.flac': { mimeType: 'audio/flac', mediaKind: 'audio' },
  '.m4a': { mimeType: 'audio/mp4', mediaKind: 'audio' },
  '.aac': { mimeType: 'audio/aac', mediaKind: 'audio' },
  '.ogg': { mimeType: 'audio/ogg', mediaKind: 'audio' }
};

function tokensMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function selectRoleUrl(
  resolved: ResolvedStream,
  role: StreamRole,
  quality?: VideoQualityTier | null
): { url: string; contentType: string } {
  if (role === 'muxed') {
    const url = resolved.muxedUrl ?? resolved.videoUrl;
    if (!url) throw new Error('No muxed URL resolved');
    return { url, contentType: resolved.mimeTypes.muxed ?? 'video/mp4' };
  }
  if (role === 'video') {
    const variant = quality ? resolved.videoVariants?.[quality] : undefined;
    if (variant) {
      return { url: variant.url, contentType: variant.mimeType };
    }
    const url = resolved.videoUrl ?? resolved.muxedUrl;
    if (!url) throw new Error('No video URL resolved');
    return { url, contentType: resolved.mimeTypes.video ?? 'video/mp4' };
  }
  const url = resolved.audioUrl ?? resolved.muxedUrl;
  if (!url) throw new Error('No audio URL resolved');
  return { url, contentType: resolved.mimeTypes.audio ?? 'audio/mp4' };
}

export function buildUpstreamRangeHeader(
  role: StreamRole,
  method: string,
  incomingRange: string | undefined
): string | undefined {
  if (method === 'GET' && role === 'video') {
    if (!incomingRange) {
      return `bytes=0-${VIDEO_CHUNK_BYTES - 1}`;
    }
    const openMatch = /^bytes=(\d+)-$/.exec(incomingRange.trim());
    if (openMatch) {
      const start = Number(openMatch[1]);
      if (Number.isFinite(start) && start >= 0) {
        return `bytes=${start}-${start + VIDEO_CHUNK_BYTES - 1}`;
      }
    }
  }
  return incomingRange;
}

export class RamStreamProxy {
  private readonly resolver: StreamResolverLike;
  private readonly token: string;
  private server: http.Server | null = null;
  private port = 0;
  private localFilesById = new Map<string, string>();
  private localIdsByPath = new Map<string, string>();

  constructor(resolver: StreamResolverLike) {
    this.resolver = resolver;
    this.token = crypto.randomBytes(24).toString('hex');
  }

  async start(): Promise<{ port: number; token: string }> {
    if (this.server) {
      return { port: this.port, token: this.token };
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
    });

    return { port: this.port, token: this.token };
  }

  buildLocalUrl(videoId: string, role: StreamRole, quality?: VideoQualityTier): string {
    if (!this.server || this.port === 0) {
      throw new Error('RamStreamProxy has not been started');
    }
    const qParam = role === 'video' && quality ? `&quality=${quality}` : '';
    return `http://127.0.0.1:${this.port}/stream/${encodeURIComponent(videoId)}/${role}?token=${this.token}${qParam}`;
  }

  registerLocalFile(filePath: string): {
    id: string;
    url: string;
    mimeType: string;
    mediaKind: 'video' | 'audio';
  } {
    if (!this.server || this.port === 0) {
      throw new Error('RamStreamProxy has not been started');
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`Local media file not found: ${resolvedPath}`);
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const meta = LOCAL_MIME_MAP[ext];
    if (!meta) {
      throw new Error(`Unsupported local media extension: ${ext}`);
    }

    let id = this.localIdsByPath.get(resolvedPath);
    if (!id) {
      id = crypto.randomUUID();
      this.localIdsByPath.set(resolvedPath, id);
      this.localFilesById.set(id, resolvedPath);
    }

    return {
      id,
      url: `http://127.0.0.1:${this.port}/local/${encodeURIComponent(id)}?token=${this.token}`,
      mimeType: meta.mimeType,
      mediaKind: meta.mediaKind
    };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.port = 0;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Cache-Control', 'no-store');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!tokensMatch(parsed.searchParams.get('token'), this.token)) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }

    const localMatch = /^\/local\/([^/]+)$/.exec(parsed.pathname);
    if (localMatch) {
      await this.handleLocalFileRequest(decodeURIComponent(localMatch[1]), req, res);
      return;
    }

    const match = /^\/stream\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
    if (!match) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const videoId = decodeURIComponent(match[1]);
    const role = match[2] as StreamRole;
    const rawQuality = parsed.searchParams.get('quality') as VideoQualityTier | null;
    const quality = rawQuality && VALID_QUALITIES.has(rawQuality) ? rawQuality : null;

    if (!VALID_VIDEO_ID.test(videoId) || !VALID_ROLES.has(role)) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());
    res.on('close', () => abortController.abort());

    try {
      let resolved = await this.resolver.resolve(videoId);
      let target = selectRoleUrl(resolved, role, quality);
      let upstream = await this.fetchUpstreamWithRetry(target.url, role, req, abortController.signal);

      if (upstream.status === 403 || upstream.status === 410) {
        try {
          await upstream.body?.cancel();
        } catch {
          // ignore body cancel error
        }
        resolved = await this.resolver.invalidateAndResolve(videoId);
        target = selectRoleUrl(resolved, role, quality);
        upstream = await this.fetchUpstreamWithRetry(target.url, role, req, abortController.signal);
      }

      if (!upstream.ok && upstream.status !== 206) {
        res.statusCode = upstream.status || 502;
        res.end(`Upstream error ${upstream.status}`);
        return;
      }

      res.statusCode = upstream.status;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? target.contentType);

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      if (req.method === 'HEAD' || !upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('stream/web').ReadableStream
      );
      await pipeline(nodeStream, res);
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(err instanceof Error ? err.message : 'Proxy stream error');
      } else {
        res.destroy();
      }
    }
  }

  private async handleLocalFileRequest(
    fileId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const filePath = this.localFilesById.get(fileId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Local file not found');
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = LOCAL_MIME_MAP[ext]?.mimeType ?? 'application/octet-stream';
    const fileSize = stat.size;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);

    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

    if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
      const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
      const requestedEnd = rangeMatch[2]
        ? Number(rangeMatch[2])
        : Math.min(fileSize - 1, start + VIDEO_CHUNK_BYTES - 1);
      const end = Math.min(fileSize - 1, Math.max(start, requestedEnd));

      if (start >= fileSize || start < 0) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(chunkSize));

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath, { start, end });
      try {
        await pipeline(stream, res);
      } catch {
        // ignore client abort during local seek
      }
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(fileSize));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    try {
      await pipeline(stream, res);
    } catch {
      // ignore client abort
    }
  }

  private async fetchUpstreamWithRetry(
    url: string,
    role: StreamRole,
    req: IncomingMessage,
    requestAbortSignal: AbortSignal
  ): Promise<Response> {
    try {
      return await this.fetchUpstream(url, role, req, requestAbortSignal);
    } catch (err) {
      if (requestAbortSignal.aborted) {
        throw err;
      }
      return this.fetchUpstream(url, role, req, requestAbortSignal);
    }
  }

  private async fetchUpstream(
    url: string,
    role: StreamRole,
    req: IncomingMessage,
    requestAbortSignal: AbortSignal
  ): Promise<Response> {
    const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.youtube.com/'
    };
    const rangeVal = buildUpstreamRangeHeader(
      role,
      method,
      typeof req.headers.range === 'string' ? req.headers.range : undefined
    );
    if (rangeVal) {
      headers.Range = rangeVal;
    }

    const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const signal = AbortSignal.any([requestAbortSignal, timeoutSignal]);

    return fetch(url, {
      method,
      headers,
      signal
    });
  }
}
