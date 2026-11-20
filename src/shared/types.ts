export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type DeckId = 'A' | 'B';
export type VideoQualityTier = '1080p' | '720p' | '480p' | '360p';
export type VideoQualityPreference = 'auto' | VideoQualityTier;

export interface YouTubeTrack {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  isLive: boolean;
  source?: 'youtube' | 'local';
  localFilePath?: string;
  mediaKind?: 'video' | 'audio';
  viewsText?: string;
  publishedText?: string;
  /** Artist names when known (YouTube Music radio). */
  artists?: string[];
  /** Human-readable reason shown on radio suggestions, e.g. "Porque escuchaste X". */
  recommendReason?: string;
}

/** Explicit and implicit feedback signals that feed the local taste model. */
export type FeedbackSignal = 'like' | 'dislike' | 'skip' | 'complete' | 'block-channel';

export interface TrackFeedbackInput {
  track: Pick<YouTubeTrack, 'videoId' | 'title' | 'channel'> & { artists?: string[] };
  signal: FeedbackSignal;
}

export interface TasteSeedTrack {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
}

export interface TasteSummary {
  seedCount: number;
  likes: number;
  dislikes: number;
  blockedChannels: string[];
  topArtists: Array<{ name: string; score: number }>;
}

export type StreamMode = 'muxed' | 'dash-split';

export interface ResolvedStream {
  videoId: string;
  mode: StreamMode;
  muxedUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  videoVariants?: Partial<Record<VideoQualityTier, { url: string; mimeType: string }>>;
  expiresAtMs: number;
  mimeTypes: {
    muxed?: string;
    video?: string;
    audio?: string;
  };
}

export interface DeckStreamEndpoints {
  videoId: string;
  mode: StreamMode;
  muxedUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  videoQualityUrls?: Partial<Record<VideoQualityTier, string>>;
  sourceType?: 'youtube' | 'local';
  mediaKind?: 'video' | 'audio';
  expiresAtMs: number;
}

export interface HotCue {
  slot: number;
  timeSec: number;
  label: string;
  color: string;
}

export interface LoopState {
  active: boolean;
  inSec: number;
  outSec: number;
  beats?: number;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isPrimary: boolean;
}

export interface RtcSignalPayload {
  type: 'ready' | 'offer' | 'answer' | 'ice';
  sdp?: string;
  candidate?: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
  };
}

export interface MixSession {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  notes: string;
}

export interface HistoryEntry {
  id: string;
  sessionId: string;
  deck: DeckId;
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  playedAt: number;
  endedAt: number | null;
  bpm: number | null;
  transitionUsed: string | null;
}

export interface Crate {
  id: string;
  name: string;
  color: string;
  trackCount: number;
}

export interface MidiMapping {
  id: string;
  deviceName: string;
  controlKey: string;
  channel: number;
  statusType: 'cc' | 'note';
  ccOrNote: number;
  mode: 'absolute' | 'toggle' | 'trigger';
  minVal: number;
  maxVal: number;
}

export interface YtDlpStatus {
  available: boolean;
  binaryPath: string | null;
  downloading: boolean;
  error: string | null;
}

export interface TrackMetadataRecord {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  bpm: number | null;
  beatOffsetSec: number | null;
  gainDb: number;
  hotCues: HotCue[];
  loop: LoopState | null;
  waveformPeaks: number[] | null;
  playCount: number;
}

export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'dev-mode';
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number;
  releaseNotes: string | null;
  error: string | null;
}

export interface HistoryTasteProfile {
  totalPlays: number;
  topChannels: Array<{ name: string; count: number }>;
  topKeywords: Array<{ word: string; weight: number }>;
  avgDurationSec: number;
  recentVideoIds: string[];
}

export interface BatchDownloadProgress {
  jobId: string;
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  total: number;
  completed: number;
  failed: number;
  currentTitle: string;
  outputDir: string | null;
  errors: string[];
}
