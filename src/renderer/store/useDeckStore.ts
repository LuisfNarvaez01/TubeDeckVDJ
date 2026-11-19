import { create } from 'zustand';
import type { DeckId, HotCue, LoopState, YouTubeTrack } from '../../shared/types';

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
    waveformPeaks: null
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
