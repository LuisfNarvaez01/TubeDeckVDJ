import { describe, it, expect, vi } from 'vitest';
import { CueLoopTempoController } from '../../../src/renderer/dj/CueLoopTempoController';
import type { DualDeckMediaSync } from '../../../src/renderer/audio/DualDeckMediaSync';

describe('CueLoopTempoController', () => {
  it('manages 8 Hot Cues, Auto-Loop boundaries and Pitch/KeyLock', async () => {
    const mediaMock = {
      seek: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
      pause: vi.fn(),
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

    // Real DJ CUE: set while paused away from mainCue, preview on second press-hold, pause-return on release
    const setRes = await ctrl.handleCueDown(24.5, false);
    expect(setRes).toEqual({ action: 'set', timeSec: 24.5 });
    expect(ctrl.getMainCueSec()).toBe(24.5);

    const previewRes = await ctrl.handleCueDown(24.5, false);
    expect(previewRes).toEqual({ action: 'preview', timeSec: 24.5 });
    expect(mediaMock.play).toHaveBeenCalledTimes(1);

    expect(await ctrl.handleCueUp()).toBe(true);
    expect(mediaMock.pause).toHaveBeenCalledTimes(1);
    expect(mediaMock.seek).toHaveBeenLastCalledWith(24.5);

    // Return to CUE while playing
    const retRes = await ctrl.handleCueDown(40.0, true);
    expect(retRes).toEqual({ action: 'return', timeSec: 24.5 });

    // Beat Jump (+4 beats @ 120 BPM = +2.0s)
    const jumped = await ctrl.beatJump(4, 30.0, 120, 180);
    expect(jumped).toBe(32.0);
    expect(mediaMock.seek).toHaveBeenLastCalledWith(32.0);

    // Slip Loop Roll (0.5 beats @ 120 BPM held for 1200ms -> restores & jumps +1.2s forward)
    const roll = ctrl.startLoopRoll(0.5, 50.0, 120, 1000);
    expect(roll.active).toBe(true);
    await ctrl.endLoopRoll(2200);
    expect(mediaMock.seek).toHaveBeenLastCalledWith(51.2);
  });
});

