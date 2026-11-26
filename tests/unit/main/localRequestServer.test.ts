import { afterEach, describe, expect, it } from 'vitest';
import { listLanAddresses, LocalRequestServer } from '../../../src/main/services/LocalRequestServer';
import { GUEST_JS } from '../../../src/main/services/localRequestPage';
import { flush, makeHub, track } from './songRequestsTestKit';

const servers: LocalRequestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

const RESULTS = [
  track('good1', 'KAROL G - BICHOTA (Official Video)'),
  track('short', 'Bichota #shorts', 40),
  track('good2', 'Bichota (Letra)')
];

async function setup(opts: { now?: () => number } = {}) {
  const { hub, gateway, settings } = makeHub({ now: opts.now, search: async () => RESULTS });
  hub.setMode('local');
  const server = new LocalRequestServer({
    hub,
    gateway,
    settings,
    host: '127.0.0.1',
    port: 0,
    getAddresses: () => ['127.0.0.1']
  });
  servers.push(server);
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;
  const key = new URL(status.url!).searchParams.get('k')!;
  const api = (path: string, init: RequestInit & { key?: string } = {}) =>
    fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Proyecta-Key': init.key ?? key } });
  const post = (body: unknown) => api('/api/requests', { method: 'POST', body: JSON.stringify(body) });
  return { hub, server, status, base, key, api, post };
}

const CLIENT = 'phone-aaaaaaaaaaaa';

describe('listLanAddresses', () => {
  it('prefers the WiFi / Ethernet private address over virtual adapters', () => {
    const ifaces = {
      'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      Public: [{ address: '8.8.8.8', family: 'IPv4', internal: false }]
    } as unknown as Parameters<typeof listLanAddresses>[0];
    expect(listLanAddresses(ifaces)).toEqual(['192.168.1.20', '172.20.0.1']);
  });
});

describe('guest page script', () => {
  it('is valid JavaScript and never writes guest text as HTML', () => {
    expect(() => new Function(GUEST_JS)).not.toThrow();
    expect(GUEST_JS).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('LocalRequestServer ("Solo red del local")', () => {
  it('serves the guest page with a strict CSP that allows YouTube thumbnails', async () => {
    const { base, status } = await setup();
    const res = await fetch(`${base}/?k=x&mesa=7`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('https://i.ytimg.com');
    expect(await res.text()).toContain('Pide tu canción');
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toContain('javascript');
    expect(status.qrSvgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(status.qrPngDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses API calls without the QR key', async () => {
    const { api } = await setup();
    expect((await api('/api/info', { key: 'wrong-key-wrong-key' })).status).toBe(403);
  });

  it('search returns only songs that pass the radio filters', async () => {
    const { api } = await setup();
    const res = (await (await api('/api/search?q=bichota')).json()) as { items: Array<{ title: string }> };
    expect(res.items.map((t) => t.title)).toEqual(['KAROL G - BICHOTA (Official Video)', 'Bichota (Letra)']);
  });

  it('a guest picks the exact video and follows its status', async () => {
    const { api, post, hub } = await setup();
    await api('/api/search?q=bichota');
    const res = await post({ client: CLIENT, table: '7', guest: 'Ana', videoId: RESULTS[2].videoId });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; state: string; title: string };
    expect(created).toMatchObject({ state: 'pending', title: 'Bichota (Letra)' });
    const req = hub.getRequests()[0];
    expect(req).toMatchObject({ origin: 'local', table: '7', guest: 'Ana', candidates: [RESULTS[2]] });

    await hub.decide(req.id, { action: 'queued', videoId: RESULTS[2].videoId });
    expect(await (await api(`/api/requests/${created.id}`)).json()).toMatchObject({ state: 'queued' });
  });

  it('a video id that was never offered falls back to the free text, or is refused', async () => {
    const { post } = await setup();
    const forged = await post({ client: CLIENT, videoId: 'zzzzzzzzzzz' });
    expect(forged.status).toBe(400);
    const free = await post({ client: CLIENT, videoId: 'zzzzzzzzzzz', query: 'bichota' });
    expect(free.status).toBe(201);
    await flush();
  });

  it('limits each phone: cooldown between requests', async () => {
    let now = 1_000_000;
    const { post } = await setup({ now: () => now });
    expect((await post({ client: CLIENT, query: 'bichota' })).status).toBe(201);
    const second = await post({ client: CLIENT, query: 'bichota' });
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toMatch(/Espera \d+ s/);
    now += 31_000;
    expect((await post({ client: CLIENT, query: 'bichota' })).status).toBe(201);
  });

  it('rejects bodies over 2 KB and empty songs', async () => {
    const { post } = await setup();
    expect((await post({ query: 'x'.repeat(3000) })).status).toBe(413);
    expect((await post({ query: ' ' })).status).toBe(400);
  });

  it('closes requests when the mode is not "local", and rotating the key invalidates old QRs', async () => {
    const { api, hub, server, key } = await setup();
    hub.setMode('off');
    expect((await api('/api/info')).status).toBe(503);
    hub.setMode('local');
    await server.rotateKey();
    expect((await api('/api/info', { key })).status).toBe(403);
  });

  it('builds a printable sheet with one QR per table and the WiFi hint', async () => {
    const { server, hub } = await setup();
    hub.setPageSettings({ venueName: 'Bar <X>', wifiName: 'BarX-Clientes' });
    const html = await server.buildTableSheet(3);
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(html).toContain('Mesa 3');
    expect(html).toContain('Bar &lt;X&gt;');
    expect(html).toContain('BarX-Clientes');
  });

  it('serves now-playing and the venue name to guests', async () => {
    const { api, hub } = await setup();
    hub.setPageSettings({ venueName: 'Bar X' });
    hub.setNowPlaying({ title: 'Feid - Normal', artist: 'Feid', videoId: null });
    expect(await (await api('/api/info')).json()).toMatchObject({
      venueName: 'Bar X',
      nowPlaying: { title: 'Feid - Normal', artist: 'Feid' }
    });
  });
});
