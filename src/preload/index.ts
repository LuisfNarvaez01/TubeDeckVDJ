import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  Crate,
  DeckStreamEndpoints,
  DisplayInfo,
  HistoryEntry,
  MidiMapping,
  MixSession,
  Result,
  RtcSignalPayload,
  TrackMetadataRecord,
  UpdateStatus,
  YouTubeTrack,
  YtDlpStatus
} from '../shared/types';

export interface TubeDeckAPI {
  searchYouTube: (query: string) => Promise<Result<{ items: YouTubeTrack[]; hasMore: boolean }>>;
  searchYouTubeNext: () => Promise<Result<{ items: YouTubeTrack[]; hasMore: boolean }>>;
  getSuggestions: (query: string) => Promise<Result<string[]>>;
  getPlaylistTracks: (urlOrId: string) => Promise<Result<YouTubeTrack[]>>;
  getRelatedTracks: (videoId: string, excludeIds?: string[]) => Promise<Result<YouTubeTrack[]>>;
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
  openOutputWindow: (displayId?: number | null, fullscreen?: boolean) => Promise<Result<boolean>>;
  moveOutputToDisplay: (displayId: number, fullscreen?: boolean) => Promise<Result<boolean>>;
  closeOutputWindow: () => Promise<Result<void>>;
  sendSignalToOutput: (signal: RtcSignalPayload) => Promise<Result<boolean>>;
  sendSignalToMain: (signal: RtcSignalPayload) => Promise<Result<boolean>>;
  onDisplaysChanged: (cb: (displays: DisplayInfo[]) => void) => () => void;
  onOutputClosed: (cb: () => void) => () => void;
  onSignalFromMain: (cb: (signal: RtcSignalPayload) => void) => () => void;
  onSignalFromOutput: (cb: (signal: RtcSignalPayload) => void) => () => void;
  startSession: (title?: string) => Promise<Result<MixSession>>;
  endSession: (sessionId: string) => Promise<Result<void>>;
  listSessions: () => Promise<Result<MixSession[]>>;
  logTrackPlay: (entry: Omit<HistoryEntry, 'id'>) => Promise<Result<HistoryEntry>>;
  getSessionHistory: (sessionId: string) => Promise<Result<HistoryEntry[]>>;
  exportSession: (sessionId: string, format: 'json' | 'csv' | 'm3u') => Promise<Result<string | null>>;
  listCrates: () => Promise<Result<Crate[]>>;
  createCrate: (name: string, color?: string) => Promise<Result<Crate>>;
  addTrackToCrate: (crateId: string, track: YouTubeTrack) => Promise<Result<void>>;
  getCrateTracks: (crateId: string) => Promise<Result<YouTubeTrack[]>>;
  listMidiMappings: (deviceName?: string) => Promise<Result<MidiMapping[]>>;
  saveMidiMapping: (mapping: Omit<MidiMapping, 'id'>) => Promise<Result<MidiMapping>>;
  deleteMidiMapping: (id: string) => Promise<Result<void>>;
  getUpdateStatus: () => Promise<Result<UpdateStatus | null>>;
  checkForUpdates: () => Promise<Result<UpdateStatus | null>>;
  downloadUpdate: () => Promise<Result<UpdateStatus | null>>;
  installUpdate: () => Promise<Result<boolean>>;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
}

function subscribeChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: TubeDeckAPI = {
  searchYouTube: (query) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SEARCH, query),
  searchYouTubeNext: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SEARCH_NEXT),
  getSuggestions: (query) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_SUGGESTIONS, query),
  getPlaylistTracks: (urlOrId) => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_PLAYLIST, urlOrId),
  getRelatedTracks: (videoId, excludeIds = []) =>
    ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_RELATED, videoId, excludeIds),
  resolveStream: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_RESOLVE, videoId),
  invalidateStream: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.STREAM_INVALIDATE, videoId),
  getYtDlpStatus: () => ipcRenderer.invoke(IPC_CHANNELS.YTDLP_STATUS),
  ensureYtDlp: () => ipcRenderer.invoke(IPC_CHANNELS.YTDLP_ENSURE),
  getSetting: (key, fallback) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SETTING, key, fallback),
  setSetting: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.DB_SET_SETTING, key, value),
  getTrackMeta: (videoId) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_TRACK_META, videoId),
  upsertTrackMeta: (track) => ipcRenderer.invoke(IPC_CHANNELS.DB_UPSERT_TRACK_META, track),
  listDisplays: () => ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_LIST),
  openOutputWindow: (displayId, fullscreen = true) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_OPEN_OUTPUT, displayId, fullscreen),
  moveOutputToDisplay: (displayId, fullscreen = true) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_MOVE_OUTPUT, displayId, fullscreen),
  closeOutputWindow: () => ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_CLOSE_OUTPUT),
  sendSignalToOutput: (signal) => ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_SIGNAL_TO_OUTPUT, signal),
  sendSignalToMain: (signal) => ipcRenderer.invoke(IPC_CHANNELS.DISPLAY_SIGNAL_TO_MAIN, signal),
  onDisplaysChanged: (cb) => subscribeChannel(IPC_CHANNELS.DISPLAY_CHANGED_EVENT, cb),
  onOutputClosed: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC_CHANNELS.DISPLAY_OUTPUT_CLOSED_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DISPLAY_OUTPUT_CLOSED_EVENT, listener);
  },
  onSignalFromMain: (cb) => subscribeChannel(IPC_CHANNELS.DISPLAY_SIGNAL_TO_OUTPUT, cb),
  onSignalFromOutput: (cb) => subscribeChannel(IPC_CHANNELS.DISPLAY_SIGNAL_TO_MAIN, cb),
  startSession: (title) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_START_SESSION, title),
  endSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_END_SESSION, sessionId),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST_SESSIONS),
  logTrackPlay: (entry) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LOG_PLAY, entry),
  getSessionHistory: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_ENTRIES, sessionId),
  exportSession: (sessionId, format) =>
    ipcRenderer.invoke(IPC_CHANNELS.HISTORY_EXPORT_SESSION, sessionId, format),
  listCrates: () => ipcRenderer.invoke(IPC_CHANNELS.CRATE_LIST),
  createCrate: (name, color) => ipcRenderer.invoke(IPC_CHANNELS.CRATE_CREATE, name, color),
  addTrackToCrate: (crateId, track) => ipcRenderer.invoke(IPC_CHANNELS.CRATE_ADD_TRACK, crateId, track),
  getCrateTracks: (crateId) => ipcRenderer.invoke(IPC_CHANNELS.CRATE_GET_TRACKS, crateId),
  listMidiMappings: (deviceName) => ipcRenderer.invoke(IPC_CHANNELS.MIDI_LIST_MAPPINGS, deviceName),
  saveMidiMapping: (mapping) => ipcRenderer.invoke(IPC_CHANNELS.MIDI_SAVE_MAPPING, mapping),
  deleteMidiMapping: (id) => ipcRenderer.invoke(IPC_CHANNELS.MIDI_DELETE_MAPPING, id),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_STATUS),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_INSTALL),
  onUpdateStatus: (cb) => subscribeChannel(IPC_CHANNELS.UPDATER_STATUS_EVENT, cb)
};

contextBridge.exposeInMainWorld('tubedeckAPI', api);
