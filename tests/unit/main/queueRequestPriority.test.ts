import { describe, expect, it } from 'vitest';
import type { YouTubeTrack } from '../../../src/shared/types';
import { QueueAndAutomixEngine, type AutomixCallbacks } from '../../../src/renderer/dj/QueueAndAutomixEngine';

const t = (id: string): YouTubeTrack => ({
  videoId: id.padEnd(11, '0').slice(0, 11),
  title: `Song ${id}`,
  channel: 'Ch',
  durationSec: 200,
  thumbnailUrl: '',
  isLive: false
});
const req = (n: string) => ({ requestId: `local:${n}`, table: n, guest: '' });
const titles = (e: QueueAndAutomixEngine) => e.getQueue().map((q) => q.track.title.replace('Song ', ''));

describe('queue hierarchy for guest requests', () => {
  it('puts requests ahead of DJ and radio songs, first approved first', () => {
    const e = new QueueAndAutomixEngine();
    e.enqueue(t('u1'), 'user');
    e.enqueue(t('r1'), 'youtube-radio');
    e.enqueue(t('q1'), 'request', req('7'));
    e.enqueue(t('q2'), 'request', req('3'));
    expect(titles(e)).toEqual(['q1', 'q2', 'u1', 'r1']);
  });

  it('respects what the DJ placed by hand', () => {
    const e = new QueueAndAutomixEngine();
    e.enqueue(t('u1'), 'user');
    e.enqueue(t('u2'), 'user');
    e.moveToNext(e.getQueue()[1].queueId); // DJ: u2 next
    e.enqueue(t('q1'), 'request', req('7'));
    expect(titles(e)).toEqual(['u2', 'q1', 'u1']);
    // the DJ can still push a request back; the next request lands after the pinned ones
    e.reorder(1, 2);
    e.enqueue(t('q2'), 'request', req('4'));
    expect(titles(e)).toEqual(['u2', 'q2', 'u1', 'q1']);
  });

  it('with Automix off, plays only the request at the head (no radio, no other songs)', async () => {
    const e = new QueueAndAutomixEngine();
    e.enqueue(t('u1'), 'user');
    e.enqueue(t('q1'), 'request', req('7'));
    expect(e.nextIsRequest()).toBe(true);
    const loaded: string[] = [];
    const callbacks: AutomixCallbacks = {
      loadDeck: async (_d, track) => void loaded.push(track.title),
      startTransition: async () => undefined,
      onTrackSkipped: () => undefined
    };
    await e.tick(
      {
        activeDeck: 'A',
        activeVideoId: 'onair000001',
        otherDeckVideoId: null,
        elapsedSec: 150,
        remainingSec: 25,
        isActivePlaying: true,
        isActiveEnded: false
      },
      {
        enabled: true,
        preloadLeadSec: 30,
        crossfadeDurationSec: 6,
        outroTriggerSec: 6,
        autoRadioEnabled: false,
        fadeType: 'smart-crossfade',
        onlyRequests: true
      },
      callbacks
    );
    expect(loaded).toEqual(['Song q1']);
    expect(e.nextIsRequest()).toBe(true); // q1 is on deck B, waiting for the outro
  });
});
