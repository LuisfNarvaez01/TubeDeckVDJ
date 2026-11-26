import { describe, expect, it } from 'vitest';
import {
  isPrivateRequestSetting,
  pickRequestCandidates,
  type RequestConnector,
  type RequestStatusUpdate
} from '../../../src/main/services/SongRequestsService';
import { emptyTaste, makeHub, MemorySettings, track } from './songRequestsTestKit';

function recorder(origin: 'lantify' | 'local') {
  const updates: Array<{ id: string; update: RequestStatusUpdate }> = [];
  const nowPlaying: unknown[] = [];
  const connector: RequestConnector = {
    origin,
    reportStatus: (id, update) => void updates.push({ id, update }),
    reportNowPlaying: (np) => void nowPlaying.push(np)
  };
  return { connector, updates, nowPlaying };
}

const item = (externalId: string, query = 'bichota') => ({
  externalId,
  table: '7',
  guest: 'Ana',
  query,
  createdAt: '2026-11-25T22:00:00Z'
});

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

describe('SongRequestsService (hub)', () => {
  it('keeps the token and QR key out of the renderer settings bridge', () => {
    expect(isPrivateRequestSetting('lantify.token')).toBe(true);
    expect(isPrivateRequestSetting('requests.local')).toBe(true);
    expect(isPrivateRequestSetting('mediaCache')).toBe(false);
  });

  it('ingests, matches and reports NO_MATCH only to the connector of that origin', async () => {
    const { hub } = makeHub({ search: async (q) => (q === 'nada' ? [track('tt', 'Tutorial de guitarra')] : [track('ok', 'Bichota')]) });
    const lantify = recorder('lantify');
    const local = recorder('local');
    hub.registerConnector(lantify.connector);
    hub.registerConnector(local.connector);

    await hub.ingest('local', [item('a1'), item('a2', 'nada')]);
    await hub.ingest('local', [item('a1')]); // duplicate ignored
    const reqs = hub.getRequests();
    expect(reqs.map((r) => [r.id, r.state])).toEqual([
      ['local:a1', 'pending'],
      ['local:a2', 'rejected']
    ]);
    expect(local.updates).toEqual([{ id: 'a2', update: { status: 'REJECTED', reason: 'NO_MATCH' } }]);
    expect(lantify.updates).toEqual([]);
  });

  it('runs the decision lifecycle and sends QUEUED with title, artist and videoId', async () => {
    const { hub } = makeHub();
    const local = recorder('local');
    hub.registerConnector(local.connector);
    await hub.ingest('local', [item('x1')]);
    const req = hub.getRequests()[0];
    await hub.decide(req.id, { action: 'queued', videoId: req.candidates[0].videoId });
    await hub.decide(req.id, { action: 'playing' });
    await hub.decide(req.id, { action: 'played' });
    expect(local.updates.map((u) => u.update.status)).toEqual(['QUEUED', 'PLAYING', 'PLAYED']);
    expect(local.updates[0].update).toMatchObject({ title: 'KAROL G - BICHOTA (Official Video)', artist: 'Karol G' });
    await expect(hub.decide(req.id, { action: 'queued', videoId: req.candidates[0].videoId })).rejects.toThrow(/atendido/);
  });

  it('a search that fails waits for a retry instead of rejecting', async () => {
    let fail = true;
    const { hub } = makeHub({
      search: async () => {
        if (fail) throw new Error('offline');
        return [track('ok', 'Bichota')];
      }
    });
    await hub.ingest('lantify', [item('r1')]);
    expect(hub.getRequests()[0].state).toBe('searching');
    fail = false;
    await hub.matchPending();
    expect(hub.getRequests()[0].state).toBe('pending');
  });

  it('sends now-playing only to the active mode', () => {
    const { hub } = makeHub();
    const lantify = recorder('lantify');
    const local = recorder('local');
    hub.registerConnector(lantify.connector);
    hub.registerConnector(local.connector);
    hub.setNowPlaying({ title: 'A', artist: 'B', videoId: null });
    hub.setMode('local');
    hub.setNowPlaying({ title: 'C', artist: 'D', videoId: null });
    expect(lantify.nowPlaying).toEqual([]);
    expect(local.nowPlaying).toEqual([{ title: 'C', artist: 'D', videoId: null }]);
    expect(hub.getNowPlaying()?.title).toBe('C');
  });

  it('keeps an existing Lantify pairing as "lantify" mode after updating', () => {
    const settings = new MemorySettings();
    settings.setSetting('lantify.token', 'tok');
    expect(makeHub({ settings }).hub.getMode()).toBe('lantify');
    expect(makeHub().hub.getMode()).toBe('off');
  });
});
