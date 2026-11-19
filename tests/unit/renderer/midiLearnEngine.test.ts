import { describe, it, expect, vi } from 'vitest';
import { MidiLearnEngine } from '../../../src/renderer/controllers/MidiLearnEngine';

describe('MidiLearnEngine', () => {
  it('learns CC mapping, triggers absolute values, handles note triggers and ignores note-off', () => {
    const engine = new MidiLearnEngine();
    const onLearned = vi.fn();
    const onControl = vi.fn();

    engine.startLearn('mixer.crossfader', 'absolute', onLearned);
    engine.processMidiMessage('Pioneer DDJ-FLX4', new Uint8Array([0xb0, 0x0a, 64]), onControl);

    expect(onLearned).toHaveBeenCalledTimes(1);
    const mapping = onLearned.mock.calls[0][0];
    expect(mapping.deviceName).toBe('Pioneer DDJ-FLX4');
    expect(mapping.channel).toBe(0);
    expect(mapping.statusType).toBe('cc');
    expect(mapping.ccOrNote).toBe(10);

    // Normal operation after learn completed
    engine.processMidiMessage('Pioneer DDJ-FLX4', new Uint8Array([0xb0, 0x0a, 127]), onControl);
    expect(onControl).toHaveBeenCalledWith('mixer.crossfader', 1.0, mapping);

    // Note trigger vs Note off
    engine.loadMappings([
      mapping,
      {
        id: 'm2',
        deviceName: 'Pioneer DDJ-FLX4',
        controlKey: 'deckA.playPause',
        channel: 0,
        statusType: 'note',
        ccOrNote: 0x24,
        mode: 'trigger',
        minVal: 0,
        maxVal: 1
      }
    ]);

    onControl.mockClear();
    // Note off -> ignored
    engine.processMidiMessage('Pioneer DDJ-FLX4', new Uint8Array([0x80, 0x24, 0]), onControl);
    engine.processMidiMessage('Pioneer DDJ-FLX4', new Uint8Array([0x90, 0x24, 0]), onControl);
    expect(onControl).not.toHaveBeenCalled();

    // Note on -> triggered
    engine.processMidiMessage('Pioneer DDJ-FLX4', new Uint8Array([0x90, 0x24, 127]), onControl);
    expect(onControl).toHaveBeenCalledTimes(1);
    expect(onControl.mock.calls[0][0]).toBe('deckA.playPause');
  });
});
