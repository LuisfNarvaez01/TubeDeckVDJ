import { describe, expect, it } from 'vitest';
import { LantifyRequestsService, nextPollDelayMs, normalizePairCode } from '../../../src/main/services/LantifyRequestsService';
import { fakeCloud, makeHub, MemorySettings, track, type CloudCall } from './songRequestsTestKit';

const pairOk = { status: 200, body: { token: 'secret-token-123', business: { name: 'Bar X', slug: 'bar-x' } } };

function setup(handler: (c: CloudCall) => { status: number; body?: unknown } | Error, search?: NonNullable<Parameters<typeof makeHub>[0]>['search']) {
  const settings = new MemorySettings();
  const { hub } = makeHub({ settings, search });
  const { http, calls } = fakeCloud(handler);
  const timers: Array<{ ms: number }> = [];
  const lantify = new LantifyRequestsService({
    http,
    settings,
    hub,
    setTimer: (_fn, ms) => {
      timers.push({ ms });
      return timers.length;
    },
    clearTimer: () => undefined
  });
  hub.onModeChange(() => lantify.handleModeChange());
  return { hub, lantify, calls, settings, timers };
}

describe('backoff and codes', () => {
  it('polls every 5 s and backs off to 60 s at most after failures', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map((f) => nextPollDelayMs(f))).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000, 60000
    ]);
  });

  it('accepts the 8-character code with spaces or dashes', () => {
    expect(normalizePairCode('ab12-cd34')).toBe('AB12CD34');
    expect(normalizePairCode(' AB12 CD34 ')).toBe('AB12CD34');
    expect(normalizePairCode('AB12CD3')).toBeNull();
  });
});

describe('LantifyRequestsService (connector)', () => {
  it('pairs, stores the token in settings, switches to "lantify" mode and never exposes the token', async () => {
    const { hub, lantify, calls, settings } = setup(() => pairOk);
    const status = await lantify.pair('ab12cd34');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/proyecta/pair', body: { code: 'AB12CD34' } });
    expect(status).toMatchObject({ paired: true, business: { name: 'Bar X' }, connection: 'ok' });
    expect(settings.getSetting('lantify.token', null)).toBe('secret-token-123');
    expect(hub.getMode()).toBe('lantify');
    expect(JSON.stringify(lantify.getStatus())).not.toContain('secret-token-123');
    expect(JSON.stringify(hub.getRequests())).not.toContain('secret-token-123');
  });

  it('rejects a wrong code with a readable message', async () => {
    const { lantify } = setup(() => ({ status: 404 }));
    await expect(lantify.pair('AB12CD34')).rejects.toThrow(/Código no válido/);
    expect(lantify.getStatus().paired).toBe(false);
  });

  it('fetches requests with the bearer token and cursor, and the hub matches them', async () => {
    const { hub, lantify, calls, settings } = setup((c) => {
      if (c.path === '/v1/proyecta/pair') return pairOk;
      if (c.method === 'GET') {
        return {
          status: 200,
          body: { items: [{ id: 'r1', table: 7, guest: 'Ana', query: 'bichota', createdAt: '2026-11-25T22:00:00Z' }], cursor: 'c-1' }
        };
      }
      return { status: 200 };
    });
    await lantify.pair('AB12CD34');
    await lantify.pollOnce();
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.path).toBe('/v1/proyecta/requests');
    expect(get.headers.Authorization).toBe('Bearer secret-token-123');
    const [req] = hub.getRequests();
    expect(req).toMatchObject({ id: 'lantify:r1', externalId: 'r1', origin: 'lantify', table: '7', guest: 'Ana', state: 'pending' });
    expect(settings.getSetting('lantify.cursor', null)).toBe('c-1');

    await lantify.pollOnce();
    expect(calls.filter((c) => c.method === 'GET')[1].path).toBe('/v1/proyecta/requests?since=c-1');
    expect(hub.getRequests()).toHaveLength(1);
  });

  it('answers REJECTED NO_MATCH in the same poll when nothing valid is found', async () => {
    const { lantify, calls } = setup(
      (c) => {
        if (c.path === '/v1/proyecta/pair') return pairOk;
        if (c.method === 'GET') return { status: 200, body: { items: [{ id: 'r9', table: '3', query: 'tutorial', createdAt: 'x' }] } };
        return { status: 200 };
      },
      async () => [track('tt', 'Tutorial de guitarra')]
    );
    await lantify.pair('AB12CD34');
    await lantify.pollOnce();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/v1/proyecta/requests/r9');
    expect(post?.body).toEqual({ status: 'REJECTED', reason: 'NO_MATCH' });
  });

  it('on 401 forgets the token and asks to pair again', async () => {
    let revoked = false;
    const { lantify, settings, timers } = setup((c) => {
      if (c.path === '/v1/proyecta/pair') return pairOk;
      return revoked ? { status: 401 } : { status: 200, body: { items: [], cursor: null } };
    });
    lantify.start();
    await lantify.pair('AB12CD34');
    revoked = true;
    const before = timers.length;
    await lantify.pollOnce();
    expect(settings.getSetting('lantify.token', 'still')).toBeNull();
    expect(lantify.getStatus()).toMatchObject({ paired: false, connection: 'revoked', business: { name: 'Bar X' } });
    expect(lantify.getStatus().lastError).toMatch(/Vincula de nuevo/);
    expect(timers.length).toBe(before); // no more polling until re-paired
  });

  it('keeps working offline: polls back off, decisions wait in the outbox', async () => {
    let online = true;
    const { hub, lantify, calls, timers } = setup((c) => {
      if (!online) return new Error('ENOTFOUND');
      if (c.path === '/v1/proyecta/pair') return pairOk;
      if (c.method === 'GET') return { status: 200, body: { items: [{ id: 'r1', table: '2', guest: 'Leo', query: 'bichota', createdAt: 'x' }], cursor: 'c' } };
      return { status: 200 };
    });
    lantify.start();
    await lantify.pair('AB12CD34');
    await lantify.pollOnce();

    online = false;
    await expect(lantify.pollOnce()).resolves.toBeUndefined();
    await lantify.pollOnce();
    expect(lantify.getStatus().connection).toBe('retrying');
    expect(timers.at(-1)?.ms).toBe(20_000);

    const req = hub.getRequests()[0];
    expect((await hub.decide(req.id, { action: 'queued', videoId: req.candidates[0].videoId })).state).toBe('queued');

    online = true;
    await lantify.pollOnce();
    expect(timers.at(-1)?.ms).toBe(5_000);
    const queued = calls.filter((c) => c.method === 'POST' && c.path === '/v1/proyecta/requests/r1');
    expect(queued.at(-1)?.body).toMatchObject({ status: 'QUEUED', videoId: req.candidates[0].videoId });
  });

  it('stops polling when the mode leaves "lantify"', async () => {
    const { hub, lantify, timers } = setup((c) => (c.path === '/v1/proyecta/pair' ? pairOk : { status: 200, body: { items: [] } }));
    lantify.start();
    await lantify.pair('AB12CD34');
    hub.setMode('local');
    const before = timers.length;
    await lantify.pollOnce();
    expect(timers.length).toBe(before);
  });
});
