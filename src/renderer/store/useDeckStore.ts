import { create } from 'zustand';
import type { DeckId, HotCue, LoopState, YouTubeTrack } from '../../shared/types';
import type { AudioFxId } from '../audio/AudioDspEngine';

export type DeckAudioFxState = Record<AudioFxId, { enabled: boolean; wet: number }>;

export interface DeckRuntimeState {
  track: YouTubeTrack | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  pitchPercent: number;
  pitchRange: 8 | 16 | 50;
  keyLock: boolean;
  cueEnabled: boolean;
  bpm: number | null;
  hotCues: HotCue[];
  loop: LoopState | null;
  waveformPeaks: number[] | null;
  mainCueSec: number;
  autoGainDb: number;
  audioFx: DeckAudioFxState;
}

function createInitialAudioFx(): DeckAudioFxState {
  return {
    echo: { enabled: false, wet: 0.45 },
    reverb: { enabled: false, wet: 0.45 },
    flanger: { enabled: false, wet: 0.45 }
  };
}

function createInitialDeckState(): DeckRuntimeState {
  return {
    track: null,
    loading: false,
    error: null,
    playing: false,
    currentTimeSec: 0,
    durationSec: 0,
    pitchPercent: 0,
    pitchRange: 16,
    keyLock: true,
    cueEnabled: false,
    bpm: null,
    hotCues: [],
    loop: null,
    waveformPeaks: null,
    mainCueSec: 0,
    autoGainDb: 0,
    audioFx: createInitialAudioFx()
  };
}

interface DeckStore {
  decks: Record<DeckId, DeckRuntimeState>;
  setDeckPatch: (deck: DeckId, patch: Partial<DeckRuntimeState>) => void;
}

export const useDeckStore = create<DeckStore>((set) => ({
  decks: {
    A: createInitialDeckState(),
    B: createInitialDeckState()
  },
  setDeckPatch: (deck, patch) =>
    set((state) => ({
      decks: {
        ...state.decks,
        [deck]: { ...state.decks[deck], ...patch }
      }
    }))
}));
