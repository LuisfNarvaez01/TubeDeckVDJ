import { describe, expect, it } from 'vitest';
import {
  CloudMusicConnector,
  normalizeLinkCode,
  reconnectDelayMs
} from '../../../src/main/services/CloudMusicConnector';
import { fakeCloud, FakeSocket, flush, makeHub, MemorySettings, track, type CloudCall } from './songRequestsTestKit';

const VENUE = { venueId: 'ab12cd34', hostSecret: 'secret-secret-secret-123' };
const RESULTS = [track('good1', 'KAROL G - BICHOTA (Official Video)'), track('tuto', 'Bichota tutorial')];

function setup(handler: (c: CloudCall) => { status: number; body?: unknown } | Error = () => ({ status: 201, body: VENUE })) {
  const settings = new MemorySettings();
  const { hub, gateway } = makeHub({ settings, search: async () => RESULTS });
  const { http, calls } = fakeCloud(handler);
  const sockets: FakeSocket[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const cloud = new CloudMusicConnector({
    hub,
    gateway,
    settings,
    http,
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    appVersion: '3.4.0',
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined
  });
  hub.onModeChange((m) => cloud.setActive(m === 'cloud'));
  const connected = async () => {
    hub.setMode('cloud');
    await flush();
    const s = sockets.at(-1)!;
    s.open();
    s.push({ t: 'ready', v: 1, chat: [] });
    return s;
  };
  return { hub, cloud, calls, settings, sockets, timers, connected };
}

describe('codes and backoff', () => {
  it('accepts the Lantify link code with spaces or dashes', () => {
    expect(normalizeLinkCode('ab12-cd34')).toBe('AB12CD34');
    expect(normalizeLinkCode('abc')).toBeNull();
  });
  it('reconnects after 2, 4, 8… s, at most every 60 s', () => {
    expect([1, 2, 3, 6, 20].map(reconnectDelayMs)).toEqual([2000, 4000, 8000, 60000, 60000]);
  });
});

describe('CloudMusicConnector ("Por internet")', () => {
  it('registers a stand-alone venue, keeps the secret private and builds the QR for musica.lantifypos.com', async () => {
    const { cloud, calls, settings, hub } = setup();
    hub.setPageSettings({ venueName: 'Bar X' });
    const status = await cloud.register();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/music/venues', body: { name: 'Bar X' } });
    expect(status).toMatchObject({ registered: true, venueId: 'ab12cd34', business: null, url: 'https://musica.lantifypos.com/ab12cd34' });
    expect(status.qrSvgDataUrl).toMatch(/^data:image\/svg/);
    expect(settings.getSetting<{ hostSecret: string }>('requests.cloud', { hostSecret: '' }).hostSecret).toBe(VENUE.hostSecret);
    expect(JSON.stringify(status)).not.toContain(VENUE.hostSecret);
    expect(cloud.guestUrl('7')).toBe('https://musica.lantifypos.com/ab12cd34?mesa=7');
  });

  it('links to a Lantify POS business with its code', async () => {
    const { cloud, calls } = setup(() => ({ status: 200, body: { ...VENUE, business: { name: 'Nativos', slug: 'nativos' } } }));
    const status = await cloud.link('ab12 cd34');
    expect(calls[0]).toMatchObject({ path: '/v1/music/link', body: { code: 'AB12CD34' } });
    expect(status.business).toEqual({ name: 'Nativos', slug: 'nativos' });
  });

  it('explains a wrong link code', async () => {
    const { cloud } = setup(() => ({ status: 404, body: { error: 'x' } }));
    await expect(cloud.link('AB12CD34')).rejects.toThrow(/Código no válido/);
    expect(cloud.getStatus().registered).toBe(false);
  });

  it('connects with an outgoing WebSocket, authenticates and sends the venue info', async () => {
    const { cloud, sockets, connected, hub } = setup();
    await cloud.register();
    hub.setPageSettings({ venueName: 'Bar X' });
    const s = await connected();
    expect(sockets).toHaveLength(1);
    expect(s.url).toBe('wss://api.lantifypos.com/v1/music/ab12cd34/host');
    expect(s.sent[0]).toEqual({ t: 'auth', secret: VENUE.hostSecret, v: 1, app: 'proyecta/3.4.0' });
    expect(cloud.getStatus().connection).toBe('online');
    expect(s.last('info')).toMatchObject({ info: { venueName: 'Bar X', accepting: true } });
  });

  it('answers searches and requests from phones, and pushes status changes to the relay cache', async () => {
    const { cloud, connected, hub } = setup();
    await cloud.register();
    const s = await connected();

    s.push({ t: 'req', rid: 'r1', op: 'search', q: 'bichota' });
    await flush();
    expect(s.last('res')).toMatchObject({ rid: 'r1', status: 200, body: { items: [{ title: 'KAROL G - BICHOTA (Official Video)' }] } });

    s.push({ t: 'req', rid: 'r2', op: 'request', body: { client: 'phone-aaaaaaaa', table: '7', videoId: RESULTS[0].videoId }, clientKey: 'k1' });
    await flush();
    const res = s.last('res') as { rid: string; status: number; body: { id: string; state: string } };
    expect(res).toMatchObject({ rid: 'r2', status: 201, body: { state: 'pending' } });
    const req = hub.getRequests()[0];
    expect(req).toMatchObject({ origin: 'cloud', externalId: res.body.id, table: '7' });

    await hub.decide(req.id, { action: 'queued', videoId: RESULTS[0].videoId });
    expect(s.last('view')).toMatchObject({ view: { id: res.body.id, state: 'queued', title: RESULTS[0].title } });

    hub.setNowPlaying({ title: 'Feid - Normal', artist: 'Feid', videoId: null });
    expect(s.last('info')).toMatchObject({ info: { nowPlaying: { title: 'Feid - Normal', artist: 'Feid' } } });
  });

  it('chats with the POS when linked', async () => {
    const { cloud, connected } = setup(() => ({ status: 200, body: { ...VENUE, business: { name: 'Nativos', slug: 'nativos' } } }));
    await cloud.link('AB12CD34');
    const s = await connected();
    s.push({ t: 'chat', msg: { id: 'm1', from: 'pos', author: 'Caja', text: 'Cumpleaños en la mesa 7', at: '2026-11-26T01:00:00Z' } });
    await flush();
    expect(cloud.getChat().map((m) => m.text)).toEqual(['Cumpleaños en la mesa 7']);
    cloud.sendChat('  Listo,   la pongo ya ');
    expect(s.last('chat')).toEqual({ t: 'chat', text: 'Listo, la pongo ya' });
    expect(cloud.getChat().at(-1)).toMatchObject({ from: 'dj', text: 'Listo, la pongo ya' });
  });

  it('refuses chat for a stand-alone venue (nobody on the other side)', async () => {
    const { cloud, connected } = setup();
    await cloud.register();
    await connected();
    expect(() => cloud.sendChat('hola')).toThrow(/vinculado a Lantify POS/);
  });

  it('reconnects with backoff when the connection drops, and stops on 4003', async () => {
    const { cloud, connected, timers, sockets, settings } = setup();
    await cloud.register();
    const s = await connected();
    s.drop(1006);
    expect(cloud.getStatus().connection).toBe('offline');
    expect(timers.at(-1)?.ms).toBe(2000);
    timers.at(-1)!.fn();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].drop(4003);
    expect(cloud.getStatus()).toMatchObject({ registered: false, connection: 'revoked' });
    expect(settings.getSetting('requests.cloud', 'x')).toBeNull();
  });

  it('keeps the booth working offline: registering without internet only shows a message', async () => {
    const { cloud } = setup(() => new Error('ENOTFOUND'));
    await expect(cloud.register()).rejects.toThrow(/No hay conexión/);
  });

  it('unregistering forgets the venue on the relay too', async () => {
    const { cloud, calls } = setup((c) => (c.method === 'DELETE' ? { status: 204 } : { status: 201, body: VENUE }));
    await cloud.register();
    await cloud.unregister();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/music/venues/ab12cd34', headers: { Authorization: `Bearer ${VENUE.hostSecret}` } });
    expect(cloud.getStatus().registered).toBe(false);
  });
});
