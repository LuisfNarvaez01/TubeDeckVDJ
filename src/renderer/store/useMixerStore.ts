import { create } from 'zustand';
import type { DeckId } from '../../shared/types';
import type { CrossfaderCurve, EqBand } from '../audio/AudioDspEngine';

export interface ChannelMixerState {
  trim: number;
  eq: Record<EqBand, number>;
  eqKill: Record<EqBand, boolean>;
  colorFilter: number;
  fader: number;
}

function createInitialChannel(): ChannelMixerState {
  return {
    trim: 1,
    eq: { low: 0, mid: 0, high: 0 },
    eqKill: { low: false, mid: false, high: false },
    colorFilter: 0,
    fader: 1
  };
}

interface MixerStore {
  channels: Record<DeckId, ChannelMixerState>;
  crossfader: number;
  crossfaderCurve: CrossfaderCurve;
  masterGain: number;
  cueGain: number;
  cueMix: number;
  autoGainEnabled: boolean;
  autoFadeActive: boolean;
  autoFadeTarget: DeckId | null;
  setChannelPatch: (deck: DeckId, patch: Partial<ChannelMixerState>) => void;
  setEqValue: (deck: DeckId, band: EqBand, db: number) => void;
  setEqKill: (deck: DeckId, band: EqBand, kill: boolean) => void;
  setCrossfader: (pos: number) => void;
  setCrossfaderCurve: (curve: CrossfaderCurve) => void;
  setMasterGain: (level: number) => void;
  setCueGain: (level: number) => void;
  setCueMix: (blend: number) => void;
  setAutoGainEnabled: (enabled: boolean) => void;
  setAutoFadeState: (active: boolean, target: DeckId | null) => void;
}

export const useMixerStore = create<MixerStore>((set) => ({
  channels: {
    A: createInitialChannel(),
    B: createInitialChannel()
  },
  crossfader: 0.5,
  crossfaderCurve: 'equal-power',
  masterGain: 1,
  cueGain: 1,
  cueMix: 0,
  autoGainEnabled: true,
  autoFadeActive: false,
  autoFadeTarget: null,
  setChannelPatch: (deck, patch) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [deck]: { ...state.channels[deck], ...patch }
      }
    })),
  setEqValue: (deck, band, db) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [deck]: {
          ...state.channels[deck],
          eq: { ...state.channels[deck].eq, [band]: db }
        }
      }
    })),
  setEqKill: (deck, band, kill) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [deck]: {
          ...state.channels[deck],
          eqKill: { ...state.channels[deck].eqKill, [band]: kill }
        }
      }
    })),
  setCrossfader: (crossfader) => set({ crossfader }),
  setCrossfaderCurve: (crossfaderCurve) => set({ crossfaderCurve }),
  setMasterGain: (masterGain) => set({ masterGain }),
  setCueGain: (cueGain) => set({ cueGain }),
  setCueMix: (cueMix) => set({ cueMix }),
  setAutoGainEnabled: (autoGainEnabled) => set({ autoGainEnabled }),
  setAutoFadeState: (autoFadeActive, autoFadeTarget) => set({ autoFadeActive, autoFadeTarget })
}));
