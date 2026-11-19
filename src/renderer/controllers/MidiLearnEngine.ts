import type { MidiMapping } from '../../shared/types';

export type MidiLearnMode = MidiMapping['mode'];

export class MidiLearnEngine {
  private mappings: MidiMapping[] = [];
  private learnTarget: {
    controlKey: string;
    mode: MidiLearnMode;
    onLearned: (mapping: MidiMapping) => void;
  } | null = null;
  private midiAccess: MIDIAccess | null = null;
  private onControlCallback:
    | ((controlKey: string, normalized01: number, mapping: MidiMapping) => void)
    | null = null;

  async init(
    onControl?: (controlKey: string, normalized01: number, mapping: MidiMapping) => void
  ): Promise<string[]> {
    if (onControl) {
      this.onControlCallback = onControl;
    }

    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      return [];
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      const names: string[] = [];
      this.midiAccess.inputs.forEach((input) => {
        const deviceName = input.name || input.id || 'MIDI Controller';
        names.push(deviceName);
        input.onmidimessage = (evt) => {
          if (evt.data && this.onControlCallback) {
            this.processMidiMessage(deviceName, evt.data, this.onControlCallback);
          }
        };
      });
      return names;
    } catch {
      return [];
    }
  }

  setOnControl(
    onControl: (controlKey: string, normalized01: number, mapping: MidiMapping) => void
  ): void {
    this.onControlCallback = onControl;
  }

  startLearn(
    controlKey: string,
    mode: MidiLearnMode,
    onLearned: (mapping: MidiMapping) => void
  ): void {
    this.learnTarget = { controlKey, mode, onLearned };
  }

  cancelLearn(): void {
    this.learnTarget = null;
  }

  isLearning(): boolean {
    return this.learnTarget !== null;
  }

  loadMappings(mappings: MidiMapping[]): void {
    this.mappings = [...mappings];
  }

  processMidiMessage(
    deviceName: string,
    data: Uint8Array,
    onControl: (controlKey: string, normalized01: number, mapping: MidiMapping) => void
  ): void {
    if (data.length < 3) return;
    const status = data[0];
    const typeNibble = status & 0xf0;
    const channel = status & 0x0f;
    const ccOrNote = data[1];
    const value = data[2];

    const isCc = typeNibble === 0xb0;
    const isNoteOn = typeNibble === 0x90 && value > 0;
    const isNoteOff = typeNibble === 0x80 || (typeNibble === 0x90 && value === 0);

    if (!isCc && !isNoteOn) {
      if (isNoteOff) return;
      return;
    }

    const statusType: 'cc' | 'note' = isCc ? 'cc' : 'note';

    if (this.learnTarget) {
      const learned: MidiMapping = {
        id: `midi-${Date.now()}-${ccOrNote}`,
        deviceName,
        controlKey: this.learnTarget.controlKey,
        channel,
        statusType,
        ccOrNote,
        mode: this.learnTarget.mode,
        minVal: 0,
        maxVal: 1
      };
      const cb = this.learnTarget.onLearned;
      this.learnTarget = null;
      this.mappings = [
        ...this.mappings.filter(
          (m) => !(m.deviceName === learned.deviceName && m.controlKey === learned.controlKey)
        ),
        learned
      ];
      cb(learned);
      return;
    }

    const matched = this.mappings.filter(
      (m) =>
        m.deviceName === deviceName &&
        m.channel === channel &&
        m.statusType === statusType &&
        m.ccOrNote === ccOrNote
    );

    const normalized = isCc ? value / 127 : 1;
    for (const mapping of matched) {
      const scaled = mapping.minVal + normalized * (mapping.maxVal - mapping.minVal);
      onControl(mapping.controlKey, scaled, mapping);
    }
  }

  dispose(): void {
    if (this.midiAccess) {
      this.midiAccess.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      this.midiAccess = null;
    }
    this.learnTarget = null;
  }
}

