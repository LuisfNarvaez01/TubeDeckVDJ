import { create } from 'zustand';
import type { YouTubeTrack } from '../../shared/types';
import type { QueueItem } from '../dj/QueueAndAutomixEngine';

interface LibraryStore {
  queue: QueueItem[];
  automixEnabled: boolean;
  automixStatusNote: string | null;
  setQueue: (items: QueueItem[]) => void;
  setAutomixEnabled: (enabled: boolean) => void;
  setAutomixStatusNote: (note: string | null) => void;
  searchInput: string;
  setSearchInput: (q: string) => void;
  searchResults: YouTubeTrack[];
  setSearchResults: (tracks: YouTubeTrack[]) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  queue: [],
  automixEnabled: false,
  automixStatusNote: null,
  setQueue: (queue) => set({ queue }),
  setAutomixEnabled: (automixEnabled) => set({ automixEnabled }),
  setAutomixStatusNote: (automixStatusNote) => set({ automixStatusNote }),
  searchInput: '',
  setSearchInput: (searchInput) => set({ searchInput }),
  searchResults: [],
  setSearchResults: (searchResults) => set({ searchResults })
}));
