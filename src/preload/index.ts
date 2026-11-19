import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  DeckStreamEndpoints,
  DisplayInfo,
  Result,
  TrackMetadataRecord,
  YouTubeTrack,
  YtDlpStatus
} from '../shared/types';

export interface TubeDeckAPI {
  searchYouTube: (query: string) => Promise<Result<{ items: YouTubeTrack[]; hasMore: boolean }>>;
  searchYouTubeNext: () => Promise<Result<{ items: YouTubeTrack[]; hasMore: boolean }>>;
  getSuggestions: (query: string) => Promise<Result<string[]>>;
  getPlaylistTracks: (urlOrId: string) => Promise<Result<YouTubeTrack[]>>;
  resolveStream: (videoId: string) => Promise<Result<DeckStreamEndpoints>>;
  invalidateStream: (videoId: string) => Promise<Result<DeckStreamEndpoints>>;
  getYtDlpStatus: () => Promise<Result<YtDlpStatus>>;
  ensureYtDlp: () => Promise<Result<YtDlpStatus>>;
  getSetting: <T>(key: string, fallback: T) => Promise<Result<T>>;
  setSetting: <T>(key: string, value: T) => Promise<Result<void>>;
  getTrackMeta: (videoId: string) => Promise<Result<TrackMetadataRecord | null>>;
  upsertTrackMeta: (
    track: Partial<TrackMetadataRecord> & { videoId: string }
  ) => Promise<Result<TrackMetadataRecord>>;
  listDisplays: () => Promise<Result<DisplayInfo[]>>;
}

const api: TubeDeckAPI = {
  searchYouTube: (query) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SEARCH, query),
  searchYouTubeNext: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SEARCH_NEXT),
  getSuggestions: (query) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SUGGESTIONS, query),
  getPlaylistTracks: (urlOrId) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_PLAYLIST, urlOrId),
  resolveStream: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_RESOLVE, videoId),
  invalidateStream: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_INVALIDATE, videoId),
  getYtDlpStatus: () => ipcRenderer.invoke(IPC_CHANNELS.YTDLP_STATUS),
  ensureYtDlp: () => ipcRenderer.invoke(IPC_CHANNELS.YTDLP_ENSURE),
  getSetting: (key, fallback) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SETTING, key, fallback),
  setSetting: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.DB_SET_SETTING, key, value),
  getTrackMeta: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_TRACK_META, videoId),
  upsertTrackMeta: (track) => ipcRenderer.invoke(IPC_CHANNELS.DB_UPSERT_TRACK_META, track),
  listDisplays: () => ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_LIST)
};

contextBridge.exposeInMainWorld('tubedeckAPI', api);
