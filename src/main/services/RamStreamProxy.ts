import crypto from 'crypto';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ResolvedStream } from '../../shared/types';

export type StreamRole = 'muxed' | 'video' | 'audio';

export interface StreamResolverLike {
  resolve(videoId: string): Promise<ResolvedStream>;
  invalidateAndResolve(videoId: string): Promise<ResolvedStream>;
}

const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VALID_ROLES = new Set<StreamRole>(['muxed', 'video', 'audio']);

function tokensMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function selectRoleUrl(resolved: ResolvedStream, role: StreamRole): { url: string; contentType: string } {
  if (role === 'muxed') {
    const url = resolved.muxedUrl ?? resolved.videoUrl;
    if (!url) throw new Error('No muxed URL resolved');
    return { url, contentType: resolved.mimeTypes.muxed ?? 'video/mp4' };
  }
  if (role === 'video') {
    const url = resolved.videoUrl ?? resolved.muxedUrl;
    if (!url) throw new Error('No video URL resolved');
    return { url, contentType: resolved.mimeTypes.video ?? 'video/mp4' };
  }
  const url = resolved.audioUrl ?? resolved.muxedUrl;
  if (!url) throw new Error('No audio URL resolved');
  return { url, contentType: resolved.mimeTypes.audio ?? 'audio/mp4' };
}

export class RamStreamProxy {
  private readonly resolver: StreamResolverLike;
  private readonly token: string;
  private server: http.Server | null = null;
  private port = 0;

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

  buildLocalUrl(videoId: string, role: StreamRole): string {
    if (!this.server || this.port === 0) {
      throw new Error('RamStreamProxy has not been started');
    }
    return `http://127.0.0.1:${this.port}/stream/${encodeURIComponent(videoId)}/${role}?token=${this.token}`;
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

    const match = /^\/stream\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
    if (!match) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const videoId = decodeURIComponent(match[1]);
    const role = match[2] as StreamRole;
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
      let target = selectRoleUrl(resolved, role);
      let upstream = await this.fetchUpstream(target.url, req, abortController.signal);

      if (upstream.status === 403 || upstream.status === 410) {
        try {
          await upstream.body?.cancel();
        } catch {
          // ignore body cancel error
        }
        resolved = await this.resolver.invalidateAndResolve(videoId);
        target = selectRoleUrl(resolved, role);
        upstream = await this.fetchUpstream(target.url, req, abortController.signal);
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

      const nodeStream = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream);
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

  private async fetchUpstream(
    url: string,
    req: IncomingMessage,
    signal: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.youtube.com/'
    };
    if (typeof req.headers.range === 'string') {
      headers.Range = req.headers.range;
    }

    return fetch(url, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      signal
    });
  }
}
