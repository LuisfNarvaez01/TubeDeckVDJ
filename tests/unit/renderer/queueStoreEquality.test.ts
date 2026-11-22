import { describe, it, expect, vi } from 'vitest';
import { sameQueue, useLibraryStore } from '../../../src/renderer/store/useLibraryStore';
import type { QueueItem } from '../../../src/renderer/dj/QueueAndAutomixEngine';

const track = { videoId: 'abcdefghijk', title: 'Song', channel: 'A', durationSec: 1, thumbnailUrl: '', isLive: false };
const item = (status: QueueItem['status'] = 'pending'): QueueItem => ({ queueId: 'q1', track, status, source: 'user' });

describe('queue store', () => {
  it('treats fresh copies of the same queue as unchanged', () => {
    expect(sameQueue([item()], [{ ...item() }])).toBe(true);
    expect(sameQueue([item()], [item('loaded')])).toBe(false);
  });

  it('does not notify listeners when Automix republishes an identical queue', () => {
    useLibraryStore.getState().setQueue([item()]);
    const listener = vi.fn();
    const unsub = useLibraryStore.subscribe(listener);
    useLibraryStore.getState().setQueue([{ ...item() }]);
    expect(listener).not.toHaveBeenCalled();
    useLibraryStore.getState().setQueue([item('loaded')]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});
