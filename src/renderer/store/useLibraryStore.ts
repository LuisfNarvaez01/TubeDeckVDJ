import { create } from 'zustand';
import type { YouTubeTrack } from '../../shared/types';
import type { AutomixFadeType, QueueItem } from '../dj/QueueAndAutomixEngine';

interface LibraryStore {
  queue: QueueItem[];
  automixEnabled: boolean;
  autoRadioEnabled: boolean;
  automixFadeType: AutomixFadeType;
  automixFadeDurationSec: number;
  automixStatusNote: string | null;
  setQueue: (items: QueueItem[]) => void;
  setAutomixEnabled: (enabled: boolean) => void;
  setAutoRadioEnabled: (enabled: boolean) => void;
  setAutomixFadeType: (fadeType: AutomixFadeType) => void;
  setAutomixFadeDurationSec: (sec: number) => void;
  setAutomixStatusNote: (note: string | null) => void;
  searchInput: string;
  setSearchInput: (q: string) => void;
  searchResults: YouTubeTrack[];
  setSearchResults: (tracks: YouTubeTrack[]) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  queue: [],
  automixEnabled: false,
  autoRadioEnabled: true,
  automixFadeType: 'smart-crossfade',
  automixFadeDurationSec: 8,
  automixStatusNote: null,
  setQueue: (queue) => set({ queue }),
  setAutomixEnabled: (automixEnabled) => set({ automixEnabled }),
  setAutoRadioEnabled: (autoRadioEnabled) => set({ autoRadioEnabled }),
  setAutomixFadeType: (automixFadeType) => set({ automixFadeType }),
  setAutomixFadeDurationSec: (automixFadeDurationSec) => set({ automixFadeDurationSec }),
  setAutomixStatusNote: (automixStatusNote) => set({ automixStatusNote }),
  searchInput: '',
  setSearchInput: (searchInput) => set({ searchInput }),
  searchResults: [],
  setSearchResults: (searchResults) => set({ searchResults })
}));
