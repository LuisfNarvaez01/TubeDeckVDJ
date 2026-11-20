import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { RamStreamProxy } from '../../../src/main/services/RamStreamProxy';
import type { ResolvedStream } from '../../../src/shared/types';

describe('RamStreamProxy', () => {
  let upstream: http.Server | null = null;
  let proxy: RamStreamProxy | null = null;

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
      proxy = null;
    }
    if (upstream) {
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      upstream = null;
    }
  });

  it('serves 206 Partial Content on 127.0.0.1 with token auth and refreshes once on 403', async () => {
    const payload = Buffer.from('0123456789ABCDEFGHIJ');
    let expiredHits = 0;

    upstream = http.createServer((req, res) => {
      if (req.url === '/expired') {
        expiredHits += 1;
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      if (req.url === '/fresh') {
        const range = req.headers.range;
        if (range === 'bytes=0-9') {
          res.statusCode = 206;
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Range', `bytes 0-9/${payload.length}`);
          res.setHeader('Content-Length', '10');
          res.end(payload.subarray(0, 10));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', String(payload.length));
        res.end(payload);
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address() as { port: number };
    const expiredUrl = `http://127.0.0.1:${addr.port}/expired`;
    const freshUrl = `http://127.0.0.1:${addr.port}/fresh`;

    const resolver = {
      resolve: vi.fn(async (): Promise<ResolvedStream> => ({
        videoId: 'dQw4w9WgXcQ',
        mode: 'muxed',
        muxedUrl: expiredUrl,
        expiresAtMs: Date.now() + 60_000,
        mimeTypes: { muxed: 'video/mp4' }
      })),
      invalidateAndResolve: vi.fn(async (): Promise<ResolvedStream> => ({
        videoId: 'dQw4w9WgXcQ',
        mode: 'muxed',
        muxedUrl: freshUrl,
        expiresAtMs: Date.now() + 60_000,
        mimeTypes: { muxed: 'video/mp4' }
      }))
    };

    proxy = new RamStreamProxy(resolver);
    const info = await proxy.start();
    const localUrl = proxy.buildLocalUrl('dQw4w9WgXcQ', 'muxed');
    expect(localUrl).toContain(`http://127.0.0.1:${info.port}/stream/dQw4w9WgXcQ/muxed?token=${info.token}`);

    // Missing/bad token must return 401
    const unauthUrl = localUrl.replace(info.token, 'wrong-token');
    const unauthRes = await fetch(unauthUrl);
    expect(unauthRes.status).toBe(401);

    // Valid token + Range request hits expired 403 -> refreshes once -> returns 206 + CORS
    const okRes = await fetch(localUrl, { headers: { Range: 'bytes=0-9' } });
    expect(okRes.status).toBe(206);
    expect(okRes.headers.get('access-control-allow-origin')).toBe('*');
    expect(okRes.headers.get('content-range')).toBe(`bytes 0-9/${payload.length}`);
    const body = Buffer.from(await okRes.arrayBuffer());
    expect(body.toString('utf8')).toBe('0123456789');
    expect(expiredHits).toBe(1);
    expect(resolver.invalidateAndResolve).toHaveBeenCalledTimes(1);
  });

  it('caps open-ended video ranges to 2MB, selects quality variants, and streams local files with 206', async () => {
    const seenRanges: string[] = [];
    const seenPaths: string[] = [];

    upstream = http.createServer((req, res) => {
      seenPaths.push(req.url ?? '');
      seenRanges.push(String(req.headers.range ?? ''));
      const chunk = Buffer.from('QUALITY_OK_CHUNK');
      res.statusCode = 206;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Range', `bytes 0-${chunk.length - 1}/4000000`);
      res.setHeader('Content-Length', String(chunk.length));
      res.end(chunk);
    });

    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const resolver = {
      resolve: vi.fn(async (): Promise<ResolvedStream> => ({
        videoId: 'dQw4w9WgXcQ',
        mode: 'dash-split',
        videoUrl: `${base}/v720`,
        audioUrl: `${base}/a140`,
        videoVariants: {
          '720p': { url: `${base}/v720`, mimeType: 'video/mp4' },
          '480p': { url: `${base}/v480`, mimeType: 'video/mp4' }
        },
        expiresAtMs: Date.now() + 60_000,
        mimeTypes: { video: 'video/mp4', audio: 'audio/mp4' }
      })),
      invalidateAndResolve: vi.fn()
    };

    proxy = new RamStreamProxy(resolver);
    await proxy.start();

    const url480 = proxy.buildLocalUrl('dQw4w9WgXcQ', 'video', '480p');
    const vidRes = await fetch(url480, { headers: { Range: 'bytes=0-' } });
    expect(vidRes.status).toBe(206);
    expect(seenPaths[0]).toBe('/v480');
    expect(seenRanges[0]).toBe('bytes=0-2097151');

    // Local file Range streaming
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-proxy-local-'));
    const localVideo = path.join(tmpDir, 'test-karaoke.mp4');
    fs.writeFileSync(localVideo, 'LOCAL_MEDIA_BYTES_PAYLOAD');

    try {
      const reg = proxy.registerLocalFile(localVideo);
      expect(reg.mediaKind).toBe('video');
      const localRes = await fetch(reg.url, { headers: { Range: 'bytes=6-10' } });
      expect(localRes.status).toBe(206);
      expect(localRes.headers.get('content-range')).toBe('bytes 6-10/25');
      expect(Buffer.from(await localRes.arrayBuffer()).toString('utf8')).toBe('MEDIA');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

