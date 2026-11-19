import { create } from 'zustand';
import type { DeckId, YouTubeTrack } from '../../shared/types';

export interface DeckRuntimeState {
  track: YouTubeTrack | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  pitchPercent: number;
  keyLock: boolean;
  cueEnabled: boolean;
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
    keyLock: true,
    cueEnabled: false
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
