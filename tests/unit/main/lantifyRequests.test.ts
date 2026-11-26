import { describe, expect, it, vi } from 'vitest';
import type { YouTubeTrack } from '../../../src/shared/types';
import {
  LantifyRequestsService,
  isPrivateLantifySetting,
  nextPollDelayMs,
  normalizePairCode,
  pickRequestCandidates,
  type LantifyHttp
} from '../../../src/main/services/LantifyRequestsService';

function track(id: string, title: string, durationSec = 210, extra: Partial<YouTubeTrack> = {}): YouTubeTrack {
  return {
    videoId: id.padEnd(11, 'x').slice(0, 11),
    title,
    channel: 'Karol G',
    durationSec,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isLive: false,
    ...extra
  };
}

const emptyTaste = { dislikedVideoIds: new Set<string>(), blockedNames: new Set<string>() };

class MemorySettings {
  data = new Map<string, unknown>();
  getSetting<T>(key: string, fallback: T): T {
    return this.data.has(key) ? (this.data.get(key) as T) : fallback;
  }
  setSetting<T>(key: string, value: T): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake Lantify Cloud: records calls and answers from a handler. */
function fakeCloud(handler: (call: Call) => { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const http: LantifyHttp = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const out = handler(call);
    if (out instanceof Error) throw out;
    return { status: out.status, json: async () => out.body ?? {} };
  };
  return { http, calls };
}

function makeService(
  http: LantifyHttp,
  opts: { settings?: MemorySettings; search?: (q: string) => Promise<YouTubeTrack[]>; taste?: typeof emptyTaste } = {}
) {
  const settings = opts.settings ?? new MemorySettings();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const onChange = vi.fn();
  const service = new LantifyRequestsService({
    http,
    settings,
    search: opts.search ?? (async () => [track('aaa', 'KAROL G - BICHOTA (Official Video)')]),
    getTasteSnapshot: () => opts.taste ?? emptyTaste,
    onChange,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined
  });
  return { service, settings, timers, onChange };
}

const pairOk = { status: 200, body: { token: 'secret-token-123', business: { name: 'Bar X', slug: 'bar-x' } } };

describe('pickRequestCandidates', () => {
  it('keeps only songs that pass the radio filters, in YouTube order', () => {
    const results = [
      track('short', 'Bichota #shorts', 40),
      track('react', 'REACCIONANDO a Bichota'),
      track('mix', 'Karol G mix 1 hora', 3600),
      track('live1', 'Bichota', 200, { isLive: true }),
      track('good1', 'KAROL G - BICHOTA (Official Video)'),
      track('tuto', 'Bichota tutorial de baile'),
      track('good2', 'Bichota (Letra)')
    ];
    expect(pickRequestCandidates(results, emptyTaste).map((t) => t.title)).toEqual([
      'KAROL G - BICHOTA (Official Video)',
      'Bichota (Letra)'
    ]);
  });

  it('drops dislikes and blocked channels from TasteFeedbackService', () => {
    const disliked = track('bad', 'Bichota en vivo');
    const blocked = track('blk', 'Bichota cover', 200, { channel: 'Canal Bloqueado' });
    const ok = track('ok1', 'Bichota');
    const taste = { dislikedVideoIds: new Set([disliked.videoId]), blockedNames: new Set(['canal bloqueado']) };
    expect(pickRequestCandidates([disliked, blocked, ok], taste)).toEqual([ok]);
  });

  it('caps the number of versions offered', () => {
    const many = Array.from({ length: 9 }, (_, i) => track(`v${i}`, `Bichota ${i}`));
    expect(pickRequestCandidates(many, emptyTaste, 5)).toHaveLength(5);
  });
});

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

  it('marks lantify.* settings private so the renderer cannot read the token', () => {
    expect(isPrivateLantifySetting('lantify.token')).toBe(true);
    expect(isPrivateLantifySetting('mediaCache')).toBe(false);
  });
});

describe('LantifyRequestsService', () => {
  it('pairs, stores the token in settings and never exposes it', async () => {
    const { http, calls } = fakeCloud(() => pairOk);
    const { service, settings, onChange } = makeService(http);
    const status = await service.pair('ab12cd34');
    expect(calls[0]).toMatchObject({ method: 'POST', body: { code: 'AB12CD34' } });
    expect(calls[0].url).toBe('https://api.lantifypos.com/v1/proyecta/pair');
    expect(status).toMatchObject({ paired: true, business: { name: 'Bar X' }, connection: 'ok' });
    expect(settings.getSetting('lantify.token', null)).toBe('secret-token-123');
    expect(JSON.stringify(service.getSnapshot())).not.toContain('secret-token-123');
    for (const [snap] of onChange.mock.calls) expect(JSON.stringify(snap)).not.toContain('secret-token-123');
  });

  it('rejects a wrong code with a readable message', async () => {
    const { http } = fakeCloud(() => ({ status: 404 }));
    const { service } = makeService(http);
    await expect(service.pair('AB12CD34')).rejects.toThrow(/Código no válido/);
    expect(service.getStatus().paired).toBe(false);
  });

  it('fetches new requests with the bearer token and cursor, and finds a candidate', async () => {
    const { http, calls } = fakeCloud((c) => {
      if (c.url.endsWith('/pair')) return pairOk;
      if (c.url.includes('/requests?') || c.url.endsWith('/requests')) {
        return {
          status: 200,
          body: {
            items: [{ id: 'r1', table: 7, guest: 'Ana', query: 'bichota', createdAt: '2026-11-25T22:00:00Z' }],
            cursor: 'c-1'
          }
        };
      }
      return { status: 200 };
    });
    const { service, settings } = makeService(http);
    await service.pair('AB12CD34');
    await service.pollOnce();
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.url).toBe('https://api.lantifypos.com/v1/proyecta/requests');
    expect(get.headers.Authorization).toBe('Bearer secret-token-123');
    const [req] = service.getRequests();
    expect(req).toMatchObject({ id: 'r1', table: '7', guest: 'Ana', query: 'bichota', state: 'pending' });
    expect(req.candidates[0].title).toContain('BICHOTA');
    expect(settings.getSetting('lantify.cursor', null)).toBe('c-1');

    await service.pollOnce();
    const second = calls.filter((c) => c.method === 'GET')[1];
    expect(second.url).toBe('https://api.lantifypos.com/v1/proyecta/requests?since=c-1');
    expect(service.getRequests()).toHaveLength(1); // the same id is not added twice
  });

  it('answers REJECTED NO_MATCH when nothing valid is found', async () => {
    const { http, calls } = fakeCloud((c) => {
      if (c.url.endsWith('/pair')) return pairOk;
      if (c.method === 'GET') {
        return { status: 200, body: { items: [{ id: 'r9', table: '3', guest: '', query: 'tutorial', createdAt: 'x' }], cursor: 'c' } };
      }
      return { status: 200 };
    });
    const { service } = makeService(http, { search: async () => [track('tt', 'Tutorial de guitarra')] });
    await service.pair('AB12CD34');
    await service.pollOnce();
    expect(service.getRequests()[0]).toMatchObject({ state: 'rejected', rejectReason: 'NO_MATCH' });
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/requests/r9'));
    expect(post?.body).toEqual({ status: 'REJECTED', reason: 'NO_MATCH' });
  });

  it('on 401 forgets the token and asks to pair again', async () => {
    let revoked = false;
    const { http } = fakeCloud((c) => {
      if (c.url.endsWith('/pair')) return pairOk;
      return revoked ? { status: 401 } : { status: 200, body: { items: [], cursor: null } };
    });
    const { service, settings, timers } = makeService(http);
    service.start();
    await service.pair('AB12CD34');
    revoked = true;
    const timersBefore = timers.length;
    await service.pollOnce();
    expect(settings.getSetting('lantify.token', 'still')).toBeNull();
    expect(service.getStatus()).toMatchObject({ paired: false, connection: 'revoked', business: { name: 'Bar X' } });
    expect(service.getStatus().lastError).toMatch(/Vincula de nuevo/);
    expect(timers.length).toBe(timersBefore); // no more polling until re-paired
  });

  it('keeps working offline: polls back off, decisions wait in the outbox', async () => {
    let online = true;
    const { http, calls } = fakeCloud((c) => {
      if (!online) return new Error('ENOTFOUND');
      if (c.url.endsWith('/pair')) return pairOk;
      if (c.method === 'GET') {
        return { status: 200, body: { items: [{ id: 'r1', table: '2', guest: 'Leo', query: 'bichota', createdAt: 'x' }], cursor: 'c' } };
      }
      return { status: 200 };
    });
    const { service, timers } = makeService(http);
    service.start();
    await service.pair('AB12CD34');
    await service.pollOnce();

    online = false;
    await expect(service.pollOnce()).resolves.toBeUndefined();
    await service.pollOnce();
    expect(service.getStatus().connection).toBe('retrying');
    expect(timers.at(-1)?.ms).toBe(20_000);

    const req = service.getRequests()[0];
    const updated = await service.decide('r1', { action: 'queued', videoId: req.candidates[0].videoId });
    expect(updated.state).toBe('queued'); // the booth is not blocked by the network

    online = true;
    await service.pollOnce();
    expect(timers.at(-1)?.ms).toBe(5_000);
    const queued = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/requests/r1'));
    expect(queued.at(-1)?.body).toMatchObject({ status: 'QUEUED', videoId: req.candidates[0].videoId });
  });

  it('cycles "Otra versión" through the candidates', async () => {
    const { http } = fakeCloud((c) => {
      if (c.url.endsWith('/pair')) return pairOk;
      if (c.method === 'GET') return { status: 200, body: { items: [{ id: 'r1', table: '1', guest: '', query: 'x', createdAt: 'x' }] } };
      return { status: 200 };
    });
    const { service } = makeService(http, { search: async () => [track('a1', 'Song A'), track('b1', 'Song B')] });
    await service.pair('AB12CD34');
    await service.pollOnce();
    expect((await service.decide('r1', { action: 'next-candidate' })).candidateIndex).toBe(1);
    expect((await service.decide('r1', { action: 'next-candidate' })).candidateIndex).toBe(0);
  });
});
