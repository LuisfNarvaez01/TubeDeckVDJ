import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaCache } from '../../../src/main/services/MediaCache';
import type { ResolvedStream } from '../../../src/shared/types';

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecta-cache-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Fake CDN serving `size` bytes per URL with Range support. */
function fakeFetch(sizes: Record<string, number>, calls: string[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const total = sizes[String(url)];
    if (total === undefined) return new Response('nope', { status: 403 });
    const range = /bytes=(\d+)-(\d+)/.exec(String((init?.headers as Record<string, string>)?.Range ?? ''));
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(total - 1, range ? Number(range[2]) : total - 1);
    return new Response(new Uint8Array(end - start + 1).fill(7), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${total}` }
    });
  }) as unknown as typeof fetch;
}

const resolved: ResolvedStream = {
  videoId: 'abcdefghijk',
  mode: 'dash-split',
  audioUrl: 'https://cdn/audio',
  videoUrl: 'https://cdn/video',
  expiresAtMs: Date.now() + 3600_000,
  mimeTypes: { audio: 'audio/mp4', video: 'video/mp4' }
};
const meta = { title: 'Song', channel: 'Artist', durationSec: 200, thumbnailUrl: '' };

describe('media cache', () => {
  it('saves audio and video in chunks and survives a restart', async () => {
    const dir = tmp();
    const cache = new MediaCache(dir, {
      fetchImpl: fakeFetch({ 'https://cdn/audio': 5_000_000, 'https://cdn/video': 3_000_000 }),
      sleep: async () => {}
    });
    cache.capture('abcdefghijk', resolved, meta);
    await cache.idle();
    const e = cache.get('abcdefghijk');
    expect(e && cache.isComplete(e)).toBe(true);
    expect(e?.audio?.bytes).toBe(5_000_000);
    expect(fs.statSync(cache.abs(e!.audio!)).size).toBe(5_000_000);

    const reopened = new MediaCache(dir);
    expect(reopened.list().map((t) => t.title)).toEqual(['Song']);
  });

  it('keeps the audio when the video download fails, and leaves no partial files', async () => {
    const dir = tmp();
    const cache = new MediaCache(dir, { fetchImpl: fakeFetch({ 'https://cdn/audio': 1000 }), sleep: async () => {} });
    cache.capture('abcdefghijk', resolved, meta);
    await cache.idle();
    const e = cache.get('abcdefghijk');
    expect(e?.audio).toBeTruthy();
    expect(e && cache.isComplete(e)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.part'))).toBe(false);
  });

  it('drops the least recently used songs when over the size limit', async () => {
    const dir = tmp();
    let t = 1000;
    const sizes: Record<string, number> = {};
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) sizes[`https://cdn/${id}`] = 400;
    const cache = new MediaCache(dir, {
      maxBytes: 1000,
      saveVideo: false,
      fetchImpl: fakeFetch(sizes),
      now: () => (t += 10),
      sleep: async () => {}
    });
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) {
      cache.capture(id, { ...resolved, videoId: id, audioUrl: `https://cdn/${id}` }, meta);
      await cache.idle();
    }
    expect(cache.list().map((x) => x.videoId).sort()).toEqual(['bbbbbbbbbbb', 'ccccccccccc']);
    expect(cache.usage().bytes).toBeLessThanOrEqual(1000);
  });

  it('does not download a song twice', async () => {
    const calls: string[] = [];
    const cache = new MediaCache(tmp(), {
      saveVideo: false,
      fetchImpl: fakeFetch({ 'https://cdn/audio': 100 }, calls),
      sleep: async () => {}
    });
    cache.capture('abcdefghijk', resolved, meta);
    cache.capture('abcdefghijk', resolved, meta);
    await cache.idle();
    cache.capture('abcdefghijk', resolved, meta);
    await cache.idle();
    expect(calls).toHaveLength(1);
  });
});
