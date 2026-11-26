/**
 * v3.5: the booth (DJ in the booth or not, decisions and autopilot from Lantify POS) and
 * the Lantify account Proyecta opens with.
 */
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SongRequestsSnapshot, YouTubeTrack } from '../../../src/shared/types';
import { CloudMusicConnector } from '../../../src/main/services/CloudMusicConnector';
import { LantifyAccountService, type AccountHttp } from '../../../src/main/services/LantifyAccountService';
import { QueueAndAutomixEngine } from '../../../src/renderer/dj/QueueAndAutomixEngine';
import { SongRequestBridge } from '../../../src/renderer/dj/SongRequestBridge';
import { fakeCloud, FakeSocket, flush, makeHub, MemorySettings } from './songRequestsTestKit';

const byQuery = (q: string): YouTubeTrack[] => [
  { videoId: q.padEnd(11, '0'), title: `Song ${q}`, channel: 'Artista', durationSec: 200, thumbnailUrl: 'https://i.ytimg.com/vi/x/hq.jpg', isLive: false }
];

async function linkedBooth() {
  const settings = new MemorySettings();
  const { hub, gateway } = makeHub({ settings, search: async (q) => byQuery(q) });
  const { http, calls } = fakeCloud((c) =>
    c.path === '/v1/music/link-license'
      ? { status: 200, body: { venueId: 'ab12cd34', hostSecret: 'secret-secret-secret-123', business: { name: 'Nativos', slug: 'nativos' } } }
      : { status: 200, body: { venueId: 'ab12cd34', hostSecret: 'secret-secret-secret-123', business: { name: 'Nativos', slug: 'nativos' } } }
  );
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
  await cloud.link('AB12CD34');
  hub.setMode('cloud');
  cloud.setActive(true);
  await flush();
  socket!.open();
  socket!.push({ t: 'ready', v: 1, chat: [], autopilot: { enabled: false, maxPerHour: 12, maxPerTable: 3, skipOnLoadError: true } });
  await flush();
  const relay = socket!;
  const phone = async (rid: string, body: Record<string, unknown>) => {
    relay.push({ t: 'req', rid, op: 'request', body, clientKey: `key-${rid}` });
    await flush();
    await flush();
  };

  const engine = new QueueAndAutomixEngine();
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
    queue: { enqueue: (t, s, r) => engine.enqueue(t, s, r), requestConflict: (t, now) => engine.requestConflict(t, now) },
    onQueueChanged: () => undefined,
    now: () => 1_000_000
  });
  const snapshot = (): SongRequestsSnapshot => ({
    mode: hub.getMode(),
    prefs: hub.getPrefs(),
    page: hub.getPageSettings(),
    requests: hub.getRequests(),
    chat: [],
    cloud: cloud.getStatus(),
    local: { running: false, url: null, addresses: [], port: null, qrSvgDataUrl: null, qrPngDataUrl: null, error: null, settings: { address: '' } },
    desk: { ...hub.getDesk(), posLinked: cloud.posLinked() }
  });
  return { hub, cloud, relay, phone, engine, bridge, snapshot, settings, calls };
}

describe('the booth: DJ present or not', () => {
  it('a DJ is in the booth by default; the choice and the autopilot survive a restart', () => {
    const settings = new MemorySettings();
    const { hub } = makeHub({ settings });
    expect(hub.getDesk()).toMatchObject({ djPresent: true, autopilot: { enabled: false } });
    hub.setDjPresent(false);
    hub.setAutopilot({ enabled: true, maxPerHour: 8, maxPerTable: 2, skipOnLoadError: true });
    const again = makeHub({ settings }).hub;
    expect(again.getDesk()).toEqual({ djPresent: false, autopilot: { enabled: true, maxPerHour: 8, maxPerTable: 2, skipOnLoadError: true } });
    // Odd rules from the relay fall back to the defaults
    expect(again.setAutopilot({ enabled: 'yes', maxPerHour: 999 })).toMatchObject({ enabled: false, maxPerHour: 12 });
  });

  it('with a DJ, the POS gets nothing; without one, it sees the pending requests', async () => {
    const { hub, relay, phone } = await linkedBooth();
    await phone('r1', { client: 'phone-aaaaaaa1', table: '4', guest: 'Ana', query: 'aa' });
    expect(relay.last('desk')).toEqual({ t: 'desk', desk: { djPresent: true, pending: [] } });

    hub.setDjPresent(false);
    expect(relay.last('desk')).toMatchObject({
      desk: { djPresent: false, pending: [{ title: 'Song aa', table: '4', guest: 'Ana', thumbnailUrl: expect.stringMatching(/^https:/) }] }
    });
    const sent = relay.sent.filter((f) => f.t === 'desk').length;
    hub.setPageSettings({ venueName: 'Nativos' }); // nothing changed for the POS: no new frame
    expect(relay.sent.filter((f) => f.t === 'desk').length).toBe(sent);
  });

  it('the POS approves (queued like a DJ approval) or rejects, only while no DJ is in the booth', async () => {
    const { hub, relay, phone, engine, bridge, snapshot } = await linkedBooth();
    await phone('r1', { client: 'phone-aaaaaaa1', table: '4', guest: 'Ana', query: 'aa' });
    await phone('r2', { client: 'phone-aaaaaaa2', table: '5', query: 'bb' });
    const [r1, r2] = hub.getRequests();

    relay.push({ t: 'decide', id: r1.externalId, action: 'approve', by: 'Caja' });
    await flush();
    expect(hub.getRequests()[0].approvedBy).toBeUndefined(); // the DJ is in the booth

    hub.setDjPresent(false);
    relay.push({ t: 'decide', id: r1.externalId, action: 'approve', by: 'Laura' });
    relay.push({ t: 'decide', id: r2.externalId, action: 'reject', by: 'Laura' });
    await flush();
    expect(hub.getRequests()[0].approvedBy).toBe('Laura');
    expect(hub.getRequests()[1].state).toBe('rejected');

    await bridge.sync(snapshot());
    expect(hub.getRequests()[0].state).toBe('queued');
    expect(engine.getQueue()[0]).toMatchObject({ source: 'request', request: { guest: 'Ana' } });
    expect(relay.last('desk')).toMatchObject({ desk: { djPresent: false, pending: [] } });
  });

  it('without a DJ, the POS autopilot approves within its own limits (not the DJ\'s)', async () => {
    const { hub, relay, phone, bridge, snapshot } = await linkedBooth();
    hub.setPrefs({ autoApprove: false });
    hub.setDjPresent(false);
    relay.push({ t: 'autopilot', rules: { enabled: true, maxPerHour: 10, maxPerTable: 2, skipOnLoadError: true } });
    await flush();
    let n = 0;
    for (const q of ['aa', 'bb', 'cc']) await phone(`r${n}`, { client: `phone-aaaaaaa${n++}`, guest: 'Ana', query: q });
    await bridge.sync(snapshot());
    // No table: the limit counts the guest's name
    expect(hub.getRequests().map((r) => r.state)).toEqual(['queued', 'queued', 'pending']);

    // The DJ is back: their own setting (off) applies again
    hub.setDjPresent(true);
    await phone('r9', { client: 'phone-aaaaaaa9', table: '8', query: 'dd' });
    await bridge.sync(snapshot());
    expect(hub.getRequests().at(-1)!.state).toBe('pending');
  });

  it('load errors reach the POS only when no DJ is in the booth', async () => {
    const { hub, cloud, relay } = await linkedBooth();
    cloud.sendAlert('load_failed', 'Song aa no cargó');
    expect(relay.last('alert')).toBeUndefined();
    hub.setDjPresent(false);
    cloud.sendAlert('load_failed', '  Song aa   no cargó ');
    expect(relay.last('alert')).toEqual({ t: 'alert', alert: { kind: 'load_failed', text: 'Song aa no cargó' } });
  });

  it('links Lantify Música with the signed-in account, without a code', async () => {
    const settings = new MemorySettings();
    const { hub, gateway } = makeHub({ settings });
    const { http, calls } = fakeCloud(() => ({ status: 200, body: { venueId: 'ab12cd34', hostSecret: 'secret-secret-secret-123', business: { name: 'Nativos', slug: 'nativos' } } }));
    const cloud = new CloudMusicConnector({ hub, gateway, settings, http, openSocket: (u) => new FakeSocket(u), setTimer: () => 0, clearTimer: () => undefined });
    await expect(cloud.linkWithAccount(null)).rejects.toThrow(/Entra con tu cuenta/);
    const status = await cloud.linkWithAccount('licencia.firmada.x');
    expect(calls[0]).toMatchObject({ path: '/v1/music/link-license', headers: { Authorization: 'Bearer licencia.firmada.x' } });
    expect(status.business).toEqual({ name: 'Nativos', slug: 'nativos' });
  });
});

// ── Lantify account ─────────────────────────────────────────

const keys = crypto.generateKeyPairSync('ed25519');
const NOW = Date.parse('2026-11-26T20:00:00Z');

function license(claims: Record<string, unknown> = {}, key = keys.privateKey): string {
  const iat = Math.floor(NOW / 1000);
  const body = {
    iss: 'lantify-cloud', typ: 'license', sub: 'u1', tid: 't1', tcode: 'BAR-AB12', tname: 'Bar Nativos', usr: 'duena', name: 'Dueña', role: 'ADMIN',
    plan: 'pro', features: ['orders', 'proyecta'], subStatus: 'ACTIVE', periodEnd: null, graceUntil: null, iat, exp: iat + 7 * 86400, olu: iat + 72 * 3600, app: 'proyecta',
    ...claims
  };
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}

function account(handler: (url: string, body: any, headers: Record<string, string>) => { status: number; body?: unknown } | Error, opts: { now?: () => number; settings?: MemorySettings } = {}) {
  const settings = opts.settings ?? new MemorySettings();
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const http: AccountHttp = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, headers: init.headers });
    const out = handler(url, body, init.headers);
    if (out instanceof Error) throw out;
    return { status: out.status, json: async () => out.body ?? {} };
  };
  const svc = new LantifyAccountService({
    settings,
    http,
    deviceName: 'PC-DJ',
    publicKey: keys.publicKey,
    now: opts.now ?? (() => NOW),
    setTimer: () => 0,
    clearTimer: () => undefined
  });
  return { svc, calls, settings };
}

describe('Lantify account', () => {
  it('signs in with the business code, username and password (as Proyecta, with its own device id)', async () => {
    const { svc, calls, settings } = account(() => ({ status: 200, body: { license: license() } }));
    const status = await svc.signIn({ tenantCode: ' bar-ab12 ', username: 'Duena', password: 'Clave-Segura-1' });
    expect(status).toMatchObject({ state: 'signed-in', business: { code: 'BAR-AB12', name: 'Bar Nativos' }, user: { username: 'duena' }, plan: 'pro', viaPos: false });
    expect(calls[0].url).toBe('https://api.lantifypos.com/v1/auth/login');
    expect(calls[0].body).toMatchObject({ app: 'proyecta', tenantCode: 'BAR-AB12', username: 'duena', device: { name: 'PC-DJ', fingerprint: expect.stringMatching(/^proyecta-[a-f0-9]{32}$/) } });
    expect(svc.licenseToken()).toBeTruthy();
    // The licence stays in the main process settings (private lantify.* key)
    expect(settings.data.has('lantify.account')).toBe(true);
  });

  it('refuses a forged licence and explains cloud errors in Spanish', async () => {
    const other = crypto.generateKeyPairSync('ed25519');
    const forged = account(() => ({ status: 200, body: { license: license({}, other.privateKey) } }));
    await expect(forged.svc.signIn({ tenantCode: 'BAR-AB12', username: 'duena', password: 'x' })).rejects.toThrow(/no válida/);
    const wrong = account(() => ({ status: 401, body: { code: 'AUTH_INVALID_CREDENTIALS' } }));
    await expect(wrong.svc.signIn({ tenantCode: 'BAR-AB12', username: 'duena', password: 'x' })).rejects.toThrow(/no coinciden/);
    const noPlan = account(() => ({ status: 200, body: { license: license({ features: ['orders'] }) } }));
    await expect(noPlan.svc.signIn({ tenantCode: 'BAR-AB12', username: 'duena', password: 'x' })).rejects.toThrow(/no incluye Proyecta/);
    expect(noPlan.svc.getStatus().state).toBe('signed-out');
  });

  it('signs in by itself through Lantify POS on this computer; without a POS the sign-in screen just shows', async () => {
    const viaPos = account((url) => (url.startsWith('http://127.0.0.1:5000/api/cloud/proyecta-handoff') ? { status: 200, body: { license: license() } } : { status: 500 }));
    expect(await viaPos.svc.start()).toMatchObject({ state: 'signed-in', viaPos: true });
    const noPos = account(() => new Error('ECONNREFUSED'));
    expect(await noPos.svc.start()).toMatchObject({ state: 'signed-out', error: null });
    await expect(noPos.svc.signInWithLocalPos()).rejects.toThrow(/No se encontró Lantify POS/);
  });

  it('works offline inside the licence window, renews online, and signs out when the licence is revoked', async () => {
    let now = NOW;
    let mode: 'ok' | 'offline' | 'revoked' = 'ok';
    const { svc, settings } = account(
      (url) => (mode === 'offline' ? new Error('offline') : mode === 'revoked' ? { status: 401, body: { code: 'CLOUD_LICENSE_REVOKED' } } : { status: 200, body: { license: license({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 7 * 86400, olu: Math.floor(now / 1000) + 72 * 3600 }) } }),
      { now: () => now }
    );
    await svc.signIn({ tenantCode: 'BAR-AB12', username: 'duena', password: 'x' });
    mode = 'offline';
    now += 48 * 3600_000;
    expect((await svc.refresh()).state).toBe('signed-in');
    // A restart offline keeps the session
    const again = account(() => new Error('offline'), { now: () => now, settings });
    expect(again.svc.getStatus().state).toBe('signed-in');
    // Setting the clock back does not buy offline time
    now -= 24 * 3600_000;
    expect(svc.getStatus().state).toBe('signed-out');
    now += 24 * 3600_000;
    mode = 'revoked';
    const out = await svc.refresh();
    expect(out).toMatchObject({ state: 'signed-out', error: expect.stringMatching(/venció/) });
    expect(settings.getSetting('lantify.account', 'x')).toBeNull();
  });
});

describe('Lantify account without the business code (v3.7 cloud)', () => {
  it('signs in with username or email and password only: no tenantCode is sent', async () => {
    const { svc, calls } = account(() => ({ status: 200, body: { license: license() } }));
    const status = await svc.signIn({ username: '  Duena@Nativos.co ', password: 'Clave-Segura-1' });
    expect(status).toMatchObject({ state: 'signed-in', business: { code: 'BAR-AB12' }, businessChoices: null });
    expect(calls[0].body.username).toBe('duena@nativos.co');
    expect('tenantCode' in calls[0].body).toBe(false);
    const empty = account(() => ({ status: 200, body: { license: license() } }));
    await empty.svc.signIn({ tenantCode: '  ', username: 'duena', password: 'x' });
    expect('tenantCode' in empty.calls[0].body).toBe(false);
  });

  it('lists the businesses when the account opens several, then signs in with the one picked', async () => {
    const { svc, calls } = account((_url, body) =>
      body.tenantCode
        ? { status: 200, body: { license: license({ tcode: body.tenantCode, tname: 'Bar Centro' }) } }
        : {
            status: 409,
            body: {
              code: 'CLOUD_TENANT_REQUIRED',
              businesses: [{ code: 'bar-ab12', name: 'Bar Nativos' }, { code: 'CEN-9X', name: 'Bar Centro' }, { code: 'x' }, { code: 'CEN-9X' }]
            }
          }
    );
    const first = await svc.signIn({ username: 'duena', password: 'x' });
    expect(first).toMatchObject({ state: 'signed-out', error: null });
    expect(first.businessChoices).toEqual([
      { code: 'BAR-AB12', name: 'Bar Nativos' },
      { code: 'CEN-9X', name: 'Bar Centro' }
    ]);
    const second = await svc.signIn({ tenantCode: 'CEN-9X', username: 'duena', password: 'x' });
    expect(calls[1].body).toMatchObject({ tenantCode: 'CEN-9X', username: 'duena' });
    expect(second).toMatchObject({ state: 'signed-in', business: { code: 'CEN-9X', name: 'Bar Centro' }, businessChoices: null });
  });

  it('explains the new errors', async () => {
    const wrong = account(() => ({ status: 401, body: { code: 'AUTH_INVALID_CREDENTIALS' } }));
    await expect(wrong.svc.signIn({ username: 'duena', password: 'x' })).rejects.toThrow(
      'El usuario (o correo) o la contraseña no coinciden.'
    );
    const loyalty = account(() => ({ status: 402, body: { code: 'CLOUD_PLAN_LOYALTY_ONLY' } }));
    await expect(loyalty.svc.signIn({ username: 'duena', password: 'x' })).rejects.toThrow(/no incluye Proyecta/);
    const badList = account(() => ({ status: 409, body: { code: 'CLOUD_TENANT_REQUIRED', businesses: [] } }));
    await expect(badList.svc.signIn({ username: 'duena', password: 'x' })).rejects.toThrow();
    await expect(account(() => ({ status: 200 })).svc.signIn({ username: '', password: 'x' })).rejects.toThrow(/usuario \(o correo\)/);
  });
});
