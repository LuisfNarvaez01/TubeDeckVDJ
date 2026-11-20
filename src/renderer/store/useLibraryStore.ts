import { create } from 'zustand';
import type {
  BatchDownloadProgress,
  HistoryTasteProfile,
  YouTubeTrack
} from '../../shared/types';
import type { AutomixFadeType, PreloadMode, QueueItem } from '../dj/QueueAndAutomixEngine';

interface LibraryStore {
  queue: QueueItem[];
  automixEnabled: boolean;
  autoRadioEnabled: boolean;
  automixFadeType: AutomixFadeType;
  automixFadeDurationSec: number;
  preloadMode: PreloadMode;
  automixStatusNote: string | null;
  setQueue: (items: QueueItem[]) => void;
  setAutomixEnabled: (enabled: boolean) => void;
  setAutoRadioEnabled: (enabled: boolean) => void;
  setAutomixFadeType: (fadeType: AutomixFadeType) => void;
  setAutomixFadeDurationSec: (sec: number) => void;
  setPreloadMode: (mode: PreloadMode) => void;
  setAutomixStatusNote: (note: string | null) => void;
  searchInput: string;
  setSearchInput: (q: string) => void;
  searchResults: YouTubeTrack[];
  setSearchResults: (tracks: YouTubeTrack[]) => void;
  localFolders: string[];
  localTracks: YouTubeTrack[];
  setLocalLibrary: (folders: string[], tracks: YouTubeTrack[]) => void;
  tasteProfile: HistoryTasteProfile | null;
  setTasteProfile: (profile: HistoryTasteProfile | null) => void;
  batchDownload: BatchDownloadProgress | null;
  setBatchDownload: (progress: BatchDownloadProgress | null) => void;
  playedVideoIds: string[];
  markTrackPlayed: (videoId: string) => void;
  previewingVideoId: string | null;
  previewLoading: boolean;
  setPreviewState: (videoId: string | null, loading?: boolean) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  queue: [],
  automixEnabled: false,
  autoRadioEnabled: true,
  automixFadeType: 'smart-crossfade',
  automixFadeDurationSec: 8,
  preloadMode: 'immediate',
  automixStatusNote: null,
  setQueue: (queue) => set({ queue }),
  setAutomixEnabled: (automixEnabled) => set({ automixEnabled }),
  setAutoRadioEnabled: (autoRadioEnabled) => set({ autoRadioEnabled }),
  setAutomixFadeType: (automixFadeType) => set({ automixFadeType }),
  setAutomixFadeDurationSec: (automixFadeDurationSec) => set({ automixFadeDurationSec }),
  setPreloadMode: (preloadMode) => set({ preloadMode }),
  setAutomixStatusNote: (automixStatusNote) => set({ automixStatusNote }),
  searchInput: '',
  setSearchInput: (searchInput) => set({ searchInput }),
  searchResults: [],
  setSearchResults: (searchResults) => set({ searchResults }),
  localFolders: [],
  localTracks: [],
  setLocalLibrary: (localFolders, localTracks) => set({ localFolders, localTracks }),
  tasteProfile: null,
  setTasteProfile: (tasteProfile) => set({ tasteProfile }),
  batchDownload: null,
  setBatchDownload: (batchDownload) => set({ batchDownload }),
  playedVideoIds: [],
  markTrackPlayed: (videoId) =>
    set((state) => {
      if (!videoId || state.playedVideoIds.includes(videoId)) return state;
      return { playedVideoIds: [...state.playedVideoIds.slice(-199), videoId] };
    }),
  previewingVideoId: null,
  previewLoading: false,
  setPreviewState: (previewingVideoId, previewLoading = false) =>
    set({ previewingVideoId, previewLoading })
}));
