import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';
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
});

