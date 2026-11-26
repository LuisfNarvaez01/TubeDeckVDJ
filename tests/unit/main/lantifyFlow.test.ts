/**
 * End-to-end request flow with a simulated Lantify Cloud: the real service (main), the
 * real queue engine and the bridge (renderer) wired together without Electron.
 */
import { describe, expect, it } from 'vitest';
import type { YouTubeTrack } from '../../../src/shared/types';
import { LantifyRequestsService, type LantifyHttp } from '../../../src/main/services/LantifyRequestsService';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { LantifyRequestBridge, ON_AIR_SETTLE_MS } from '../../../src/renderer/dj/LantifyRequestBridge';

const SONG: YouTubeTrack = {
  videoId: 'bichota0001',
  title: 'KAROL G - BICHOTA (Official Video)',
  channel: 'KarolGVEVO',
  durationSec: 190,
  thumbnailUrl: 'https://i.ytimg.com/vi/bichota0001/hqdefault.jpg',
  isLive: false
};
const OTHER: YouTubeTrack = { ...SONG, videoId: 'otrasong001', title: 'Feid - Normal', channel: 'Feid' };

function setup(items: Array<Record<string, unknown>>) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const puts: Array<Record<string, unknown>> = [];
  let served = false;
  const http: LantifyHttp = async (url, init) => {
    const path = url.replace('https://api.lantifypos.com', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (path === '/v1/proyecta/pair') {
      return { status: 200, json: async () => ({ token: 'tok-abcdefgh', business: { name: 'Bar X', slug: 'bar-x' } }) };
    }
    if (init.method === 'GET') {
      const out = served ? [] : items;
      served = true;
      return { status: 200, json: async () => ({ items: out, cursor: 'c1' }) };
    }
    if (init.method === 'PUT') puts.push(body);
    else posts.push({ path, body });
    return { status: 200, json: async () => ({}) };
  };
  const store = new Map<string, unknown>();
  const service = new LantifyRequestsService({
    http,
    settings: {
      getSetting: <T,>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f),
      setSetting: (k, v) => void store.set(k, v)
    },
    search: async () => [SONG],
    getTasteSnapshot: () => ({ dislikedVideoIds: new Set(), blockedNames: new Set() }),
    setTimer: () => 0,
    clearTimer: () => undefined
  });
  const engine = new QueueAndAutomixEngine();
  let clock = 1_000_000;
  const bridge = new LantifyRequestBridge({
    api: {
      decide: async (id, d) => {
        try {
          return { success: true, data: await service.decide(id, d) };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
      nowPlaying: async (np) => service.setNowPlaying(np)
    },
    queue: {
      enqueue: (t, s, r) => engine.enqueue(t, s, r),
      requestConflict: (t, now) => engine.requestConflict(t, now)
    },
    onQueueChanged: () => undefined,
    now: () => clock
  });
  const settle = (track: YouTubeTrack | null) => {
    bridge.observeOnAir(track, clock);
    clock += ON_AIR_SETTLE_MS + 1;
    return bridge.observeOnAir(track, clock);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { service, engine, bridge, posts, puts, settle, flush, advance: (ms: number) => (clock += ms) };
}

const REQ = { id: 'r1', table: '7', guest: 'Ana', query: 'bichota', createdAt: '2026-11-25T22:00:00Z' };

describe('Lantify request flow', () => {
  it('approve → QUEUED → PLAYING → PLAYED, with now-playing on each change', async () => {
    const { service, engine, bridge, posts, puts, settle, flush } = setup([REQ]);
    await service.pair('AB12CD34');
    await service.pollOnce();
    await bridge.sync(service.getSnapshot());

    const req = service.getRequests()[0];
    expect(await bridge.approve(req)).toBe('queued');
    const [item] = engine.getQueue();
    expect(item).toMatchObject({ source: 'request', request: { requestId: 'r1', table: '7', guest: 'Ana' } });
    await flush();
    expect(posts.at(-1)).toEqual({
      path: '/v1/proyecta/requests/r1',
      body: { status: 'QUEUED', title: SONG.title, artist: 'KarolG', videoId: SONG.videoId }
    });

    // Automix takes it from the queue onto a deck and it becomes the loudest song on air
    engine.dequeueById(item.queueId);
    const started = settle(SONG);
    expect(started).toMatchObject({ table: '7' }); // → "Pedida por la mesa 7" on Screen 2
    await flush();
    expect(posts.at(-1)?.body).toEqual({ status: 'PLAYING' });
    expect(puts.at(-1)).toEqual({ title: SONG.title, artist: 'KarolG', videoId: SONG.videoId });
    expect(service.getRequests()[0].state).toBe('playing');

    // the next song takes over: the request is done
    expect(settle(OTHER)).toBeNull();
    await flush();
    expect(posts.at(-1)?.body).toEqual({ status: 'PLAYED' });
    expect(puts.at(-1)).toMatchObject({ title: OTHER.title, videoId: OTHER.videoId });
    expect(service.getRequests()[0].state).toBe('played');
  });

  it('a short blip on air (crossfade) is not a song change', () => {
    const { bridge } = setup([]);
    bridge.observeOnAir(SONG, 0);
    expect(bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS + 10)).toBeNull();
    bridge.observeOnAir(OTHER, ON_AIR_SETTLE_MS + 20);
    bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS + 40); // back before OTHER settled
    expect(bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS * 3)).toBeNull();
  });

  it('rejects ALREADY_PLAYED when the song played in the last 60 minutes or is queued', async () => {
    const { service, engine, bridge, posts, flush, advance } = setup([
      REQ,
      { ...REQ, id: 'r2', table: '3' },
      { ...REQ, id: 'r3', table: '4' }
    ]);
    await service.pair('AB12CD34');
    await service.pollOnce();
    const [r1, r2, r3] = service.getRequests();

    engine.recordPlayed('otherupload', 'Bichota (Letra)', 1_000_000); // another upload, same song
    expect(await bridge.approve(r1)).toBe('already-played');
    await flush();
    expect(posts.at(-1)).toEqual({ path: '/v1/proyecta/requests/r1', body: { status: 'REJECTED', reason: 'ALREADY_PLAYED' } });

    advance(61 * 60 * 1000); // more than an hour later it is fine again
    expect(await bridge.approve(r2)).toBe('queued');
    expect(await bridge.approve(r3)).toBe('already-queued');
  });

  it('auto-approve respects the per-table limit and leaves the rest to the DJ', async () => {
    const items = ['a', 'b', 'c'].map((s, i) => ({ ...REQ, id: `t${i}`, query: s }));
    const { service, bridge } = setup(items);
    const songs = [SONG, { ...SONG, videoId: 'song2000002', title: 'Song Two' }, { ...SONG, videoId: 'song3000003', title: 'Song Three' }];
    let n = 0;
    (service as unknown as { deps: { search: () => Promise<YouTubeTrack[]> } }).deps.search = async () => [songs[n++]];
    await service.pair('AB12CD34');
    service.setPrefs({ autoApprove: true, maxPerTable: 2 });
    await service.pollOnce();
    await bridge.sync(service.getSnapshot());
    expect(service.getRequests().map((r) => r.state)).toEqual(['queued', 'queued', 'pending']);
  });
});
