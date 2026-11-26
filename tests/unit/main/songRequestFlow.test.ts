/**
 * Request flow end to end, without Electron: hub (main) + transport + queue engine +
 * bridge (renderer). Runs against a simulated Lantify Música relay ("Por internet") and
 * against Proyecta's own WiFi server ("Solo red del local").
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SongRequestsSnapshot, YouTubeTrack } from '../../../src/shared/types';
import { CloudMusicConnector } from '../../../src/main/services/CloudMusicConnector';
import { LocalRequestServer } from '../../../src/main/services/LocalRequestServer';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { ON_AIR_SETTLE_MS, SongRequestBridge } from '../../../src/renderer/dj/SongRequestBridge';
import type { SongRequestsService } from '../../../src/main/services/SongRequestsService';
import { fakeCloud, FakeSocket, flush, makeHub, MemorySettings } from './songRequestsTestKit';

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
  const snapshot = (): SongRequestsSnapshot => ({
    mode: hub.getMode(),
    prefs: hub.getPrefs(),
    page: hub.getPageSettings(),
    requests: hub.getRequests(),
    chat: [],
    cloud: {
      registered: true,
      venueId: 'ab12cd34',
      business: null,
      connection: 'online',
      url: null,
      qrSvgDataUrl: null,
      qrPngDataUrl: null,
      error: null
    },
    local: {
      running: true,
      url: null,
      addresses: [],
      port: null,
      qrSvgDataUrl: null,
      qrPngDataUrl: null,
      error: null,
      settings: { address: '' }
    }
  });
  return { engine, bridge, settle, snapshot, advance: (ms: number) => (clock += ms) };
}

async function cloudSetup(search: (q: string) => Promise<YouTubeTrack[]> = async () => [SONG]) {
  const settings = new MemorySettings();
  const { hub, gateway } = makeHub({ settings, search });
  const { http } = fakeCloud(() => ({ status: 201, body: { venueId: 'ab12cd34', hostSecret: 'secret-secret-secret-123' } }));
  let socket: FakeSocket | null = null;
  const cloud = new CloudMusicConnector({
    hub,
    gateway,
    settings,
    http,
    openSocket: (url) => (socket = new FakeSocket(url)),
    setTimer: () => 0,
    clearTimer: () => undefined
  });
  await cloud.register();
  hub.setMode('cloud');
  cloud.setActive(true);
  await flush();
  socket!.open();
  socket!.push({ t: 'ready', v: 1, chat: [] });
  const relay = socket!;
  /** A phone's request as the Durable Object forwards it. */
  const phone = async (rid: string, body: Record<string, unknown>) => {
    relay.push({ t: 'req', rid, op: 'request', body, clientKey: `key-${rid}` });
    await flush();
    return relay.last('res') as { status: number; body: { id: string; state: string } };
  };
  return { hub, relay, phone, ...wireBridge(hub) };
}

const servers: LocalRequestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

describe('song request flow "Por internet" (Lantify Música relay)', () => {
  it('approve → QUEUED → PLAYING → PLAYED; the phone reads each state from the relay cache', async () => {
    const { hub, relay, phone, engine, bridge, settle, snapshot } = await cloudSetup();
    const created = await phone('r1', { client: 'phone-aaaaaaaa', table: '7', guest: 'Ana', query: 'bichota' });
    expect(created.status).toBe(201);
    await flush();
    await bridge.sync(snapshot());

    const req = hub.getRequests()[0];
    expect(await bridge.approve(req)).toBe('queued');
    expect(engine.getQueue()[0]).toMatchObject({ source: 'request', request: { table: '7', guest: 'Ana' } });
    expect(relay.last('view')).toMatchObject({ view: { id: created.body.id, state: 'queued', title: SONG.title } });

    engine.dequeueById(engine.getQueue()[0].queueId); // Automix (or request auto-play) takes it
    expect(settle(SONG)).toMatchObject({ table: '7' }); // → "Pedida por la mesa 7" on Screen 2
    expect(relay.last('view')).toMatchObject({ view: { state: 'playing' } });
    expect(relay.last('info')).toMatchObject({ info: { nowPlaying: { title: SONG.title, artist: 'KarolG' } } });

    settle(OTHER);
    expect(relay.last('view')).toMatchObject({ view: { state: 'played' } });
    expect(hub.getRequests()[0].state).toBe('played');
  });

  it('rejects ALREADY_PLAYED when the song played in the last 60 minutes or is queued', async () => {
    const { hub, relay, phone, engine, bridge, advance } = await cloudSetup();
    await phone('r1', { client: 'phone-aaaaaaa1', table: '7', query: 'bichota' });
    await phone('r2', { client: 'phone-aaaaaaa2', table: '3', query: 'bichota' });
    await phone('r3', { client: 'phone-aaaaaaa3', table: '4', query: 'bichota' });
    await flush();
    const [r1, r2, r3] = hub.getRequests();

    engine.recordPlayed('otherupload', 'Bichota (Letra)', 1_000_000);
    expect(await bridge.approve(r1)).toBe('already-played');
    expect(relay.last('view')).toMatchObject({ view: { state: 'rejected', reason: expect.stringMatching(/ya sonó/) } });

    advance(61 * 60 * 1000);
    expect(await bridge.approve(r2)).toBe('queued');
    expect(await bridge.approve(r3)).toBe('already-queued');
  });

  it('auto-approve respects the per-table limit and leaves the rest to the DJ', async () => {
    const byQuery = (q: string): YouTubeTrack[] => [{ ...SONG, videoId: `${q}`.padEnd(11, '0'), title: `Song ${q}` }];
    const { hub, phone, bridge, snapshot } = await cloudSetup(async (q) => byQuery(q));
    hub.setPrefs({ autoApprove: true, maxPerTable: 2 });
    let n = 0;
    for (const q of ['aa', 'bb', 'cc']) await phone(`r${n}`, { client: `phone-aaaaaaa${n++}`, table: '7', query: q });
    await flush();
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

describe('song request flow "Solo red del local" (no internet, no Lantify)', () => {
  it('a phone on the WiFi picks a video, the DJ approves it and the phone sees it play', async () => {
    const settings = new MemorySettings();
    const { hub, gateway } = makeHub({ settings, search: async () => [SONG] });
    hub.setMode('local');
    const server = new LocalRequestServer({ hub, gateway, settings, host: '127.0.0.1', port: 0, getAddresses: () => ['127.0.0.1'] });
    servers.push(server);
    const status = await server.start();
    const key = new URL(status.url!).searchParams.get('k')!;
    const call = (path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${status.port}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Proyecta-Key': key },
        body: body ? JSON.stringify(body) : undefined
      }).then((r) => r.json() as Promise<{ id: string; state: string; title?: string }>);

    await call('/api/search?q=bichota');
    const created = await call('/api/requests', { client: 'phone-aaaaaaaa', table: '5', guest: 'Leo', videoId: SONG.videoId });
    const { engine, bridge, settle, snapshot } = wireBridge(hub);
    expect(await bridge.approve(hub.getRequests()[0])).toBe('queued');
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
