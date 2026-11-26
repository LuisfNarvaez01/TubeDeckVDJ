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
  /** Camelot code detected for the track, e.g. "8A". */
  musicalKey?: string | null;
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
  /** Progress of the file being downloaded right now, 0-100. */
  currentPercent?: number;
  outputDir: string | null;
  errors: string[];
}

export type LocalPlaceKind = 'drive' | 'removable' | 'optical' | 'network' | 'folder' | 'library';

export interface LocalPlace {
  kind: LocalPlaceKind;
  label: string;
  path: string;
  /** Secondary text, e.g. the full path. */
  detail?: string;
}

export interface LocalDirListing {
  path: string;
  parent: string | null;
  folders: { name: string; path: string }[];
  tracks: YouTubeTrack[];
  /** True when the listing includes files from sub-folders. */
  recursive: boolean;
  /** True when a recursive scan hit the file limit. */
  truncated: boolean;
}

export type SmartCrateKind = 'match' | 'most-played' | 'recent' | 'liked' | 'forgotten';

export interface SmartCrateQuery {
  kind: SmartCrateKind;
  /** For "match": Camelot code of what is playing (after key shift). */
  camelot?: string | null;
  /** For "match": effective BPM of what is playing. */
  bpm?: number | null;
}

export interface SmartCrateTrack extends YouTubeTrack {
  playCount?: number;
  lastPlayedAt?: number;
  musicalKey?: string | null;
  bpm?: number | null;
}

export type YouTubeAccessState = 'unknown' | 'checking' | 'ok' | 'blocked' | 'offline';

/** Why a song is suggested (shown as small labels to the DJ). */
export type DjSuggestionReason = 'follows' | 'this-hour' | 'key' | 'bpm' | 'liked' | 'favorite' | 'forgotten';

export interface DjSuggestionRequest {
  onAirVideoId?: string | null;
  onAirChannel?: string | null;
  onAirKey?: string | null;
  onAirBpm?: number | null;
  /** Already queued, loaded or played this session. */
  excludeVideoIds?: string[];
}

export interface DjSuggestion extends YouTubeTrack {
  score: number;
  reasons: DjSuggestionReason[];
  bpm: number | null;
  musicalKey: string | null;
  playCount: number;
}

export interface DjSuggestions {
  suggestions: DjSuggestion[];
  /** Median BPM of what the DJ usually plays at this hour (null with little history). */
  typicalBpm: number | null;
  historySize: number;
}

export interface MediaCacheUsage {
  bytes: number;
  maxBytes: number;
  songs: number;
  withVideo: number;
}

export interface MediaCacheSettings {
  maxGb: number;
  saveVideo: boolean;
}

export interface NetworkStatus {
  online: boolean;
  checkedAtMs: number | null;
  /** When the current outage started (null while online). */
  offlineSinceMs: number | null;
}

export interface YouTubeAccessStatus {
  state: YouTubeAccessState;
  connected: boolean;
  checkedAtMs: number | null;
  detail: string | null;
}

// ---- Song requests from guests (Lantify POS table QR, or Proyecta's own QR) ----

/**
 * Where requests come from: `cloud` = guests' phones reach Proyecta from any network
 * through the Lantify Música relay (musica.lantifypos.com), with or without Lantify POS;
 * `local` = only phones on the venue's WiFi, served by Proyecta itself (no internet needed).
 */
export type SongRequestMode = 'off' | 'cloud' | 'local';
export type SongRequestOrigin = 'cloud' | 'local';

/** Life of a guest's song request inside Proyecta. */
export type SongRequestState = 'searching' | 'pending' | 'queued' | 'playing' | 'played' | 'rejected';

/** Automatic rejection codes; a DJ rejection carries the DJ's short text or `DJ_DECLINED`. */
export type SongRequestRejectCode = 'NO_MATCH' | 'ALREADY_PLAYED' | 'DJ_DECLINED';

export interface SongRequest {
  /** Unique inside Proyecta: `<origin>:<externalId>`. */
  id: string;
  origin: SongRequestOrigin;
  /** Id in the source (Lantify's request id, or the local server's id). */
  externalId: string;
  /** Table label ("7", "Terraza 2"); empty when the guest did not say. */
  table: string;
  guest: string;
  /** What the guest typed. */
  query: string;
  createdAt: string;
  receivedAtMs: number;
  state: SongRequestState;
  /** Valid YouTube matches, best first ("Otra versión" walks this list). */
  candidates: YouTubeTrack[];
  candidateIndex: number;
  /** The song that went to the queue. */
  chosenVideoId?: string;
  rejectReason?: string;
  /** Approved from Lantify POS while no DJ was in the booth (name of who approved). */
  approvedBy?: string;
}

export interface SongRequestPrefs {
  autoApprove: boolean;
  /** Auto-approved requests allowed per hour (all tables). */
  maxPerHour: number;
  /** Auto-approved requests allowed per table per hour. */
  maxPerTable: number;
  /** "Pedida por la mesa 7" on Screen 2 for the first 10 s. */
  overlayEnabled: boolean;
  /** Approved requests play on their own even while Automix is off. */
  autoPlay: boolean;
}

/** Shown to guests on the page, the printed QR sheet and Screen 2. */
export interface GuestPageSettings {
  venueName: string;
  /** Optional WiFi name printed next to the QR (local mode). */
  wifiName: string;
  /** QR shown in a corner of Screen 2. */
  qrOnScreen: boolean;
  /** Venue logo on the Screen 2 QR card (PNG/JPEG/WebP data URL, max ~400 KB); empty = the name. */
  logoDataUrl: string;
}

/** Proyecta opens with the business's Lantify account (v3.5). */
export interface AccountStatus {
  state: 'signed-in' | 'signed-out' | 'checking';
  business: { code: string; name: string } | null;
  user: { name: string; username: string; role: string } | null;
  /** 'proyecta' = pays only Proyecta; anything else = a Lantify POS plan (Proyecta included). */
  plan: string | null;
  subscription: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'SUSPENDED' | null;
  /** Proyecta keeps working offline until then. */
  offlineUntil: string | null;
  /** Signed in through Lantify POS on this computer. */
  viaPos: boolean;
  error: string | null;
}

/** Autopilot set from Lantify POS; Proyecta applies it only while no DJ is in the booth. */
export interface AutopilotRules {
  enabled: boolean;
  maxPerHour: number;
  maxPerTable: number;
  skipOnLoadError: boolean;
}

/**
 * The booth: is a DJ deciding? With a DJ, everything happens in Proyecta and Lantify POS
 * gets no notifications. Without one, pending requests and load errors go to the POS,
 * which decides (or leaves it to the autopilot).
 */
export interface DeskState {
  djPresent: boolean;
  autopilot: AutopilotRules;
  /** Linked to a Lantify POS business and connected: the POS can see the booth. */
  posLinked: boolean;
}

export type CloudConnection = 'unregistered' | 'connecting' | 'online' | 'offline' | 'revoked';

export interface CloudRequestStatus {
  /** Has a venue on the relay (registered alone or linked to Lantify POS). */
  registered: boolean;
  venueId: string | null;
  /** Lantify POS business this venue is linked to (null = stand-alone module). */
  business: { name: string; slug: string } | null;
  connection: CloudConnection;
  /** Page guests open (the QR content). */
  url: string | null;
  qrSvgDataUrl: string | null;
  qrPngDataUrl: string | null;
  error: string | null;
}

export interface ChatMessage {
  id: string;
  from: 'dj' | 'pos';
  author: string;
  text: string;
  at: string;
}

export interface LocalRequestSettings {
  /** LAN address chosen by the DJ; empty = automatic. */
  address: string;
}

export interface LocalRequestStatus {
  running: boolean;
  /** Address guests open (the QR content), e.g. http://192.168.1.20:8765/?k=… */
  url: string | null;
  addresses: string[];
  port: number | null;
  /** QR of `url`: SVG for the booth, PNG for Screen 2 (canvas-safe). */
  qrSvgDataUrl: string | null;
  qrPngDataUrl: string | null;
  error: string | null;
  settings: LocalRequestSettings;
}

export interface SongRequestsSnapshot {
  mode: SongRequestMode;
  prefs: SongRequestPrefs;
  page: GuestPageSettings;
  cloud: CloudRequestStatus;
  local: LocalRequestStatus;
  requests: SongRequest[];
  /** DJ ↔ Lantify POS messages (only when linked to a business). */
  chat: ChatMessage[];
  desk: DeskState;
}

/** A song a guest can pick on the phone page (already filtered like the radio). */
export interface GuestTrack {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
}

/** What a guest's phone sees about its own request. */
export interface GuestRequestView {
  id: string;
  state: SongRequestState;
  query: string;
  title?: string;
  artist?: string;
  thumbnailUrl?: string;
  reason?: string;
}

export type SongRequestDecision =
  | { action: 'next-candidate' }
  | { action: 'reject'; reason?: string }
  | { action: 'queued'; videoId: string }
  | { action: 'playing' }
  | { action: 'played' };

export interface NowPlayingInfo {
  title: string;
  artist: string;
  /** YouTube id, or null for a local file. */
  videoId: string | null;
}

/** The next song in the queue (contract `upNext`), shown as "Sigue" on the phone page. */
export interface UpNextInfo {
  title: string;
  artist: string;
}
