/**
 * Request flow end to end, without Electron: hub (main) + connector + queue engine +
 * bridge (renderer). Runs once against a simulated Lantify Cloud and once against
 * Proyecta's own QR server, which is the stand-alone module.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { YouTubeTrack } from '../../../src/shared/types';
import { LantifyRequestsService } from '../../../src/main/services/LantifyRequestsService';
import { LocalRequestServer } from '../../../src/main/services/LocalRequestServer';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { ON_AIR_SETTLE_MS, SongRequestBridge } from '../../../src/renderer/dj/SongRequestBridge';
import type { SongRequestsService } from '../../../src/main/services/SongRequestsService';
import { fakeCloud, flush, makeHub, MemorySettings } from './songRequestsTestKit';

const SONG: YouTubeTrack = {
  videoId: 'bichota0001',
  title: 'KAROL G - BICHOTA (Official Video)',
  channel: 'KarolGVEVO',
  durationSec: 190,
  thumbnailUrl: 'https://i.ytimg.com/vi/bichota0001/hqdefault.jpg',
  isLive: false
};
const OTHER: YouTubeTrack = { ...SONG, videoId: 'otrasong001', title: 'Feid - Normal', channel: 'Feid' };

function wireBridge(hub: SongRequestsService) {
  const engine = new QueueAndAutomixEngine();
  let clock = 1_000_000;
  const bridge = new SongRequestBridge({
    api: {
      decide: async (id, d) => {
        try {
          return { success: true, data: await hub.decide(id, d) };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
      nowPlaying: async (np) => hub.setNowPlaying(np)
    },
    queue: {
      enqueue: (t, s, r) => engine.enqueue(t, s, r),
      requestConflict: (t, now) => engine.requestConflict(t, now)
    },
    onQueueChanged: () => undefined,
    now: () => clock
  });
  const settle = (t: YouTubeTrack | null) => {
    bridge.observeOnAir(t, clock);
    clock += ON_AIR_SETTLE_MS + 1;
    return bridge.observeOnAir(t, clock);
  };
  const snapshot = () => ({
    mode: hub.getMode(),
    prefs: hub.getPrefs(),
    requests: hub.getRequests(),
    lantify: { paired: true, business: null, connection: 'ok' as const, lastError: null, pollDelayMs: 5000 },
    local: {
      running: true,
      url: null,
      addresses: [],
      port: null,
      qrSvgDataUrl: null,
      qrPngDataUrl: null,
      error: null,
      settings: { venueName: '', wifiName: '', address: '', qrOnScreen: true }
    }
  });
  return { engine, bridge, settle, snapshot, advance: (ms: number) => (clock += ms) };
}

const REQ = { id: 'r1', table: '7', guest: 'Ana', query: 'bichota', createdAt: '2026-11-25T22:00:00Z' };

function lantifySetup(items: Array<Record<string, unknown>>) {
  let served = false;
  const { http, calls } = fakeCloud((c) => {
    if (c.path === '/v1/proyecta/pair') return { status: 200, body: { token: 'tok-abcdefgh', business: { name: 'Bar X', slug: 'bar-x' } } };
    if (c.method === 'GET') {
      const out = served ? [] : items;
      served = true;
      return { status: 200, body: { items: out, cursor: 'c1' } };
    }
    return { status: 200 };
  });
  const settings = new MemorySettings();
  const { hub } = makeHub({ settings, search: async () => [SONG] });
  const lantify = new LantifyRequestsService({ http, settings, hub, setTimer: () => 0, clearTimer: () => undefined });
  const posts = () => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/v1/proyecta/requests/'));
  const puts = () => calls.filter((c) => c.method === 'PUT');
  return { hub, lantify, posts, puts, ...wireBridge(hub) };
}

const servers: LocalRequestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

describe('song request flow with Lantify POS', () => {
  it('approve → QUEUED → PLAYING → PLAYED, with now-playing on each change', async () => {
    const { hub, lantify, engine, bridge, posts, puts, settle } = lantifySetup([REQ]);
    await lantify.pair('AB12CD34');
    await lantify.pollOnce();

    const req = hub.getRequests()[0];
    expect(await bridge.approve(req)).toBe('queued');
    const [item] = engine.getQueue();
    expect(item).toMatchObject({ source: 'request', request: { requestId: 'lantify:r1', table: '7', guest: 'Ana' } });
    await flush();
    expect(posts().at(-1)).toMatchObject({
      path: '/v1/proyecta/requests/r1',
      body: { status: 'QUEUED', title: SONG.title, artist: 'KarolG', videoId: SONG.videoId }
    });

    await bridge.sync(lantifySnapshot(hub));
    engine.dequeueById(item.queueId); // Automix takes it onto a deck
    expect(settle(SONG)).toMatchObject({ table: '7' }); // → "Pedida por la mesa 7" on Screen 2
    await flush();
    expect(posts().at(-1)?.body).toEqual({ status: 'PLAYING' });
    expect(puts().at(-1)?.body).toEqual({ title: SONG.title, artist: 'KarolG', videoId: SONG.videoId });

    expect(settle(OTHER)).toBeNull();
    await flush();
    expect(posts().at(-1)?.body).toEqual({ status: 'PLAYED' });
    expect(puts().at(-1)?.body).toMatchObject({ title: OTHER.title, videoId: OTHER.videoId });
    expect(hub.getRequests()[0].state).toBe('played');
  });

  it('rejects ALREADY_PLAYED when the song played in the last 60 minutes or is queued', async () => {
    const { hub, lantify, engine, bridge, posts, advance } = lantifySetup([
      REQ,
      { ...REQ, id: 'r2', table: '3' },
      { ...REQ, id: 'r3', table: '4' }
    ]);
    await lantify.pair('AB12CD34');
    await lantify.pollOnce();
    const [r1, r2, r3] = hub.getRequests();

    engine.recordPlayed('otherupload', 'Bichota (Letra)', 1_000_000); // another upload, same song
    expect(await bridge.approve(r1)).toBe('already-played');
    await flush();
    expect(posts().at(-1)).toMatchObject({ path: '/v1/proyecta/requests/r1', body: { status: 'REJECTED', reason: 'ALREADY_PLAYED' } });

    advance(61 * 60 * 1000);
    expect(await bridge.approve(r2)).toBe('queued');
    expect(await bridge.approve(r3)).toBe('already-queued');
  });

  it('auto-approve respects the per-table limit and leaves the rest to the DJ', async () => {
    const songs = [SONG, { ...SONG, videoId: 'song2000002', title: 'Song Two' }, { ...SONG, videoId: 'song3000003', title: 'Song Three' }];
    let n = 0;
    const settings = new MemorySettings();
    const { hub } = makeHub({ settings, search: async () => [songs[n++]] });
    const { bridge, snapshot } = wireBridge(hub);
    hub.setMode('local');
    hub.setPrefs({ autoApprove: true, maxPerTable: 2 });
    await hub.ingest('local', ['a', 'b', 'c'].map((q, i) => ({ externalId: `t${i}`, table: '7', guest: '', query: q, createdAt: 'x' })));
    await bridge.sync(snapshot());
    expect(hub.getRequests().map((r) => r.state)).toEqual(['queued', 'queued', 'pending']);
  });

  it('a short blip on air (crossfade) is not a song change', () => {
    const { hub } = makeHub();
    const { bridge } = wireBridge(hub);
    bridge.observeOnAir(SONG, 0);
    expect(bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS + 10)).toBeNull();
    bridge.observeOnAir(OTHER, ON_AIR_SETTLE_MS + 20);
    bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS + 40);
    expect(bridge.observeOnAir(SONG, ON_AIR_SETTLE_MS * 3)).toBeNull();
  });
});

function lantifySnapshot(hub: SongRequestsService) {
  return { ...wireBridge(hub).snapshot(), mode: 'lantify' as const };
}

describe('song request flow stand-alone (own QR, no Lantify)', () => {
  it('a phone on the WiFi asks for a song, the DJ approves it and the phone sees it play', async () => {
    const settings = new MemorySettings();
    const { hub } = makeHub({ settings, search: async () => [SONG] });
    hub.setMode('local');
    const server = new LocalRequestServer({ hub, settings, host: '127.0.0.1', port: 0, getAddresses: () => ['127.0.0.1'] });
    servers.push(server);
    const status = await server.start();
    const key = new URL(status.url!).searchParams.get('k')!;
    const call = (path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${status.port}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Proyecta-Key': key },
        body: body ? JSON.stringify(body) : undefined
      }).then((r) => r.json() as Promise<{ id: string; state: string; title?: string }>);

    const created = await call('/api/requests', { table: '5', guest: 'Leo', query: 'bichota' });
    await flush();
    const { engine, bridge, settle, snapshot } = wireBridge(hub);
    const req = hub.getRequests()[0];
    expect(await bridge.approve(req)).toBe('queued');
    expect((await call(`/api/requests/${created.id}`)).state).toBe('queued');

    await bridge.sync(snapshot());
    engine.dequeueById(engine.getQueue()[0].queueId);
    expect(settle(SONG)).toMatchObject({ table: '5', guest: 'Leo' });
    await flush();
    expect(await call(`/api/requests/${created.id}`)).toMatchObject({ state: 'playing', title: SONG.title });
    settle(OTHER);
    await flush();
    expect((await call(`/api/requests/${created.id}`)).state).toBe('played');
  });
});
