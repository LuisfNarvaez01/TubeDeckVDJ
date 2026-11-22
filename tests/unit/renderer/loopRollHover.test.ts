import { describe, it, expect, vi } from 'vitest';
import { CueLoopTempoController } from '../../../src/renderer/dj/CueLoopTempoController';
import type { DualDeckMediaSync } from '../../../src/renderer/audio/DualDeckMediaSync';

describe('loop roll pads', () => {
  it('do not move the track when the pointer only passes over a pad', async () => {
    const seek = vi.fn(async () => {});
    const media = { seek, play: vi.fn(), pause: vi.fn(), setPlaybackRate: vi.fn() } as unknown as DualDeckMediaSync;
    const ctrl = new CueLoopTempoController('A', media, vi.fn());
    await ctrl.endLoopRoll();
    expect(seek).not.toHaveBeenCalled();

    ctrl.startLoopRoll(1, 30, 120, 1000);
    await ctrl.endLoopRoll(3000);
    expect(seek).toHaveBeenCalledWith(32);
    await ctrl.endLoopRoll(9000);
    expect(seek).toHaveBeenCalledTimes(1);
  });
});
