import { describe, it, expect, vi } from 'vitest';
import { CueLoopTempoController } from '../../../src/renderer/dj/CueLoopTempoController';
import type { DualDeckMediaSync } from '../../../src/renderer/audio/DualDeckMediaSync';

describe('CueLoopTempoController', () => {
  it('manages 8 Hot Cues, Auto-Loop boundaries and Pitch/KeyLock', async () => {
    const mediaMock = {
      seek: vi.fn(async () => {}),
      setPlaybackRate: vi.fn()
    } as unknown as DualDeckMediaSync;

    const onPersist = vi.fn();
    const ctrl = new CueLoopTempoController('A', mediaMock, onPersist);
    ctrl.loadTrackState('dQw4w9WgXcQ', [], null);

    // Hot Cue set and jump
    const cue = await ctrl.triggerHotCue(1, 32.5);
    expect(cue.slot).toBe(1);
    expect(cue.timeSec).toBe(32.5);
    expect(onPersist).toHaveBeenCalledTimes(1);

    await ctrl.triggerHotCue(1, 50.0);
    expect(mediaMock.seek).toHaveBeenCalledWith(32.5);
    expect(ctrl.getHotCues()).toHaveLength(1);

    // Auto-Loop 4 beats @ 120 BPM = 2.0s -> [10.0, 12.0]
    const loop = ctrl.triggerAutoLoop(4, 10.0, 120);
    expect(loop).toEqual({ active: true, inSec: 10.0, outSec: 12.0, beats: 4 });
    expect(await ctrl.checkLoopBoundary(12.05)).toBe(true);
    expect(mediaMock.seek).toHaveBeenCalledWith(10.0);

    ctrl.toggleLoopExit();
    expect(ctrl.getLoop()?.active).toBe(false);

    ctrl.setPitchPercent(8, true);
    expect(mediaMock.setPlaybackRate).toHaveBeenCalledWith(1.08, true);

    ctrl.clearHotCue(1);
    expect(ctrl.getHotCues()).toHaveLength(0);
  });
});
