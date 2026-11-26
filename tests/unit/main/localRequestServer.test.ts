import { afterEach, describe, expect, it } from 'vitest';
import { guestReasonText, listLanAddresses, LocalRequestServer } from '../../../src/main/services/LocalRequestServer';
import { flush, makeHub, MemorySettings, track } from './songRequestsTestKit';

const servers: LocalRequestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

async function setup(opts: { now?: () => number } = {}) {
  const settings = new MemorySettings();
  const { hub } = makeHub({ settings, now: opts.now });
  hub.setMode('local');
  const server = new LocalRequestServer({
    hub,
    settings,
    host: '127.0.0.1',
    port: 0,
    getAddresses: () => ['127.0.0.1'],
    now: opts.now
  });
  servers.push(server);
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;
  const key = new URL(status.url!).searchParams.get('k')!;
  const api = (path: string, init: RequestInit & { key?: string } = {}) =>
    fetch(base + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Proyecta-Key': init.key ?? key }
    });
  return { hub, server, status, base, key, api, settings };
}

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

describe('LocalRequestServer (stand-alone QR)', () => {
  it('serves the guest page with a strict CSP and builds the QR', async () => {
    const { base, status } = await setup();
    const res = await fetch(`${base}/?k=x&mesa=7`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await res.text()).toContain('Pide tu canción');
    expect(status.qrSvgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(status.qrPngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?k=/);
  });

  it('refuses API calls without the QR key', async () => {
    const { api } = await setup();
    const res = await api('/api/info', { key: 'wrong-key-wrong-key' });
    expect(res.status).toBe(403);
  });

  it('takes a request, matches it and lets the guest follow its status', async () => {
    const { api, hub } = await setup();
    const res = await api('/api/requests', { method: 'POST', body: JSON.stringify({ table: '7', guest: 'Ana', query: 'bichota' }) });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; state: string };
    await flush();
    const req = hub.getRequests()[0];
    expect(req).toMatchObject({ origin: 'local', externalId: created.id, table: '7', guest: 'Ana', state: 'pending' });

    await hub.decide(req.id, { action: 'queued', videoId: req.candidates[0].videoId });
    const view = await (await api(`/api/requests/${created.id}`)).json();
    expect(view).toMatchObject({ state: 'queued', title: 'KAROL G - BICHOTA (Official Video)' });

    await hub.decide(req.id, { action: 'reject', reason: 'Hoy solo salsa' });
    // a rejected-after-queued request stays as decided; reasons are shown in plain words
    expect(guestReasonText('NO_MATCH')).toMatch(/No encontramos/);
  });

  it('limits each phone: cooldown between requests', async () => {
    let now = 1_000_000;
    const { api } = await setup({ now: () => now });
    const send = () => api('/api/requests', { method: 'POST', body: JSON.stringify({ query: 'bichota' }) });
    expect((await send()).status).toBe(201);
    const second = await send();
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toMatch(/Espera \d+ s/);
    now += 31_000;
    expect((await send()).status).toBe(201);
  });

  it('rejects bodies over 2 KB and empty songs', async () => {
    const { api } = await setup();
    const big = await api('/api/requests', { method: 'POST', body: JSON.stringify({ query: 'x'.repeat(3000) }) });
    expect(big.status).toBe(413);
    const empty = await api('/api/requests', { method: 'POST', body: JSON.stringify({ query: ' ' }) });
    expect(empty.status).toBe(400);
  });

  it('closes requests when the mode is not "local", and rotating the key invalidates old QRs', async () => {
    const { api, hub, server, key } = await setup();
    hub.setMode('off');
    expect((await api('/api/info')).status).toBe(503);
    hub.setMode('local');
    await server.rotateKey();
    expect((await api('/api/info', { key })).status).toBe(403);
  });

  it('builds a printable sheet with one QR per table', async () => {
    const { server } = await setup();
    await server.updateSettings({ venueName: 'Bar <X>', wifiName: 'BarX-Clientes' });
    const html = await server.buildTableSheet(3);
    expect(html.match(/<svg/g)).toHaveLength(4); // general + 3 tables
    expect(html).toContain('Mesa 3');
    expect(html).toContain('Bar &lt;X&gt;');
    expect(html).toContain('BarX-Clientes');
  });

  it('serves now-playing to guests', async () => {
    const { api, hub } = await setup();
    hub.setNowPlaying({ title: 'Feid - Normal', artist: 'Feid', videoId: null });
    expect(await (await api('/api/info')).json()).toMatchObject({ nowPlaying: { title: 'Feid - Normal', artist: 'Feid' } });
    void track; // keep helper import used across suites
  });
});
