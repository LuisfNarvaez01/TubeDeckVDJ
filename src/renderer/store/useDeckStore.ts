import { create } from 'zustand';
import type { DeckId, HotCue, LoopState, YouTubeTrack } from '../../shared/types';
import type { AudioFxId, FxBeatDivision } from '../audio/AudioDspEngine';

export type DeckAudioFxState = Record<
  AudioFxId,
  { enabled: boolean; wet: number; beatDiv: FxBeatDivision }
>;

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
  keyShiftSemitones: number;
  cueEnabled: boolean;
  synced: boolean;
  bufferRatio: number;
  customOsdTitle: string | null;
  bpm: number | null;
  hotCues: HotCue[];
  loop: LoopState | null;
  waveformPeaks: number[] | null;
  mainCueSec: number;
  autoGainDb: number;
  audioFx: DeckAudioFxState;
  /** Camelot code detected for the loaded track (before key shift), e.g. "8A". */
  musicalKey: string | null;
  /** Track time of a beat (grid anchor) for phase metering, seconds. */
  beatAnchorSec: number | null;
}

function createInitialAudioFx(): DeckAudioFxState {
  return {
    echo: { enabled: false, wet: 0.45, beatDiv: '3/4' },
    reverb: { enabled: false, wet: 0.45, beatDiv: '3/4' },
    flanger: { enabled: false, wet: 0.45, beatDiv: '3/4' }
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
    keyShiftSemitones: 0,
    cueEnabled: false,
    synced: false,
    bufferRatio: 0,
    customOsdTitle: null,
    bpm: null,
    hotCues: [],
    loop: null,
    waveformPeaks: null,
    mainCueSec: 0,
    autoGainDb: 0,
    audioFx: createInitialAudioFx(),
    musicalKey: null,
    beatAnchorSec: null
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
