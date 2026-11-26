import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import type { MediaCache, MediaCacheEntry } from '../services/MediaCache';
import type { DjSuggestionService } from '../services/DjSuggestionService';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type {
  DeckStreamEndpoints,
  LocalPlace,
  Result,
  RtcSignalPayload,
  VideoQualityTier,
  YouTubeTrack
} from '../../shared/types';
import type { AutoUpdaterService } from '../services/AutoUpdaterService';
import type { BatchDownloadFormat, BatchDownloadService } from '../services/BatchDownloadService';
import type { DatabaseService } from '../services/DatabaseService';
import type { DisplayWindowManager } from '../services/DisplayWindowManager';
import type { HistoryAndCratesService } from '../services/HistoryAndCratesService';
import { browseDirectory, listDrivePlaces, type LocalLibraryService } from '../services/LocalLibraryService';
import type { MixRecordingService } from '../services/MixRecordingService';
import type { YouTubeAccessMonitor, YouTubeAccessStatus } from '../services/YouTubeAccessMonitor';
import type { NetworkMonitor } from '../services/NetworkMonitor';
import type { RecommendationEngine } from '../services/RecommendationEngine';
import type { TasteFeedbackService } from '../services/TasteFeedbackService';
import type { RamStreamProxy } from '../services/RamStreamProxy';
import type { ExportFormat, SessionExporter } from '../services/SessionExporter';
import type { StreamResolverService } from '../services/StreamResolverService';
import type { YouTubeSearchService } from '../services/YouTubeSearchService';
import type { YtDlpBinaryManager } from '../services/YtDlpBinaryManager';
import { isPrivateRequestSetting } from '../services/SongRequestsService';
import { LocalSettingsPatchSchema } from '../services/LocalRequestServer';
import { GuestPageSettingsSchema } from '../services/SongRequestsService';
import type { SongRequestsModule } from '../services/songRequestsModule';
import { LOGO_DATA_URL, MAX_LOGO_DATA_URL } from '../services/SongRequestsService';
import { PROYECTA_SIGNUP_URL, type LantifyAccountService } from '../services/LantifyAccountService';

const VideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'ID de video inválido');

/**
 * Exclusion lists come from the renderer and can hold local-file ids or grow long over a
 * night: keep the valid YouTube ids (most recent last) instead of rejecting the request.
 */
export function parseExcludeIds(raw: unknown, max = 400): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v));
  return Array.from(new Set(valid)).slice(-max);
}
const NonEmptyStringSchema = z.string().trim().min(1).max(500);
const CaptureMetaSchema = z.object({
  title: z.string().max(500),
  channel: z.string().max(300),
  durationSec: z.number().min(0).max(24 * 3600),
  thumbnailUrl: z.string().max(1000)
});
const DjSuggestionRequestSchema = z.object({
  onAirVideoId: z.string().max(64).nullish(),
  onAirChannel: z.string().max(300).nullish(),
  onAirKey: z.string().max(8).nullish(),
  onAirBpm: z.number().min(0).max(400).nullish(),
  excludeVideoIds: z.array(z.string().max(64)).max(2000).optional()
});
const MediaCacheSettingsSchema = z.object({
  maxGb: z.number().min(0.5).max(200),
  saveVideo: z.boolean()
});
const FeedbackSchema = z.object({
  track: z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string().max(500),
    channel: z.string().max(300),
    artists: z.array(z.string().max(200)).max(20).optional()
  }),
  signal: z.enum(['like', 'dislike', 'skip', 'complete', 'block-channel'])
});
const TasteSeedsSchema = z
  .array(
    z.object({
      videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
      title: z.string().max(500),
      channel: z.string().max(300),
      durationSec: z.number().min(0).max(36000),
      thumbnailUrl: z.string().max(2000)
    })
  )
  .max(10);
const RtcSignalSchema = z.object({
  type: z.enum(['ready', 'offer', 'answer', 'ice']),
  sdp: z.string().optional(),
  candidate: z
    .object({
      candidate: z.string(),
      sdpMid: z.string().nullable(),
      sdpMLineIndex: z.number().nullable()
    })
    .optional()
});

const LinkCodeSchema = z.object({ code: z.string().trim().min(1).max(32) });
const ChatTextSchema = z.string().trim().min(1).max(280);
const SongRequestIdSchema = z.string().trim().min(1).max(128);
const SongRequestDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('next-candidate') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal('queued'), videoId: VideoIdSchema }),
  z.object({ action: z.literal('playing') }),
  z.object({ action: z.literal('played') })
]);
const NowPlayingSchema = z.object({
  title: z.string().max(500),
  artist: z.string().max(300),
  videoId: VideoIdSchema.nullable()
});
const UpNextSchema = z.object({ title: z.string().max(500), artist: z.string().max(300) }).nullable();
const SongRequestPrefsPatchSchema = z
  .object({
    autoApprove: z.boolean(),
    maxPerHour: z.number().int().min(1).max(120),
    maxPerTable: z.number().int().min(1).max(30),
    overlayEnabled: z.boolean(),
    autoPlay: z.boolean()
  })
  .partial();

const RequestModeSchema = z.enum(['off', 'cloud', 'local']);

/** Song-request settings (relay secret, QR access key) stay in the main process. */
function assertPublicSettingKey(key: string): string {
  if (isPrivateRequestSetting(key)) throw new Error('Ajuste reservado');
  return key;
}

async function wrapResult<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export interface MainServices {
  db: DatabaseService;
  search: YouTubeSearchService;
  ytDlp: YtDlpBinaryManager;
  resolver: StreamResolverService;
  proxy: RamStreamProxy;
  displays: DisplayWindowManager;
  history: HistoryAndCratesService;
  exporter: SessionExporter;
  updater?: AutoUpdaterService;
  localLibrary?: LocalLibraryService;
  recordings?: MixRecordingService;
  network?: NetworkMonitor;
  /** Proyecta's own folder for session batch downloads (one subfolder per session). */
  sessionDownloadsDir?: string;
  mediaCache?: MediaCache;
  djSuggestions?: DjSuggestionService;
  youtubeAccess?: {
    monitor: YouTubeAccessMonitor;
    connect: () => Promise<YouTubeAccessStatus>;
    disconnect: () => Promise<YouTubeAccessStatus>;
  };
  batchDownloader?: BatchDownloadService;
  taste?: TasteFeedbackService;
  recommender?: RecommendationEngine;
  songRequests?: SongRequestsModule;
  account?: LantifyAccountService;
}

/** Endpoints served from the media cache through the local proxy (no network needed). */
function buildCachedEndpoints(proxy: RamStreamProxy, cache: MediaCache, e: MediaCacheEntry): DeckStreamEndpoints {
  const far = Date.now() + 30 * 24 * 3600 * 1000;
  if (e.muxed) {
    return {
      videoId: e.videoId,
      mode: 'muxed',
      muxedUrl: proxy.registerLocalFile(cache.abs(e.muxed)).url,
      sourceType: 'youtube',
      mediaKind: 'video',
      expiresAtMs: far
    };
  }
  const audioUrl = e.audio ? proxy.registerLocalFile(cache.abs(e.audio)).url : undefined;
  if (e.video && audioUrl) {
    return {
      videoId: e.videoId,
      mode: 'dash-split',
      videoUrl: proxy.registerLocalFile(cache.abs(e.video)).url,
      audioUrl,
      videoQualityUrls: {},
      sourceType: 'youtube',
      mediaKind: 'video',
      expiresAtMs: far
    };
  }
  if (!audioUrl) throw new Error('Canción en caché incompleta');
  return {
    videoId: e.videoId,
    mode: 'muxed',
    muxedUrl: audioUrl,
    audioUrl,
    sourceType: 'youtube',
    mediaKind: 'audio',
    expiresAtMs: far
  };
}

function buildEndpoints(
  proxy: RamStreamProxy,
  resolved: Awaited<ReturnType<StreamResolverService['resolve']>>
): DeckStreamEndpoints {
  if (resolved.mode === 'dash-split') {
    const videoQualityUrls: Partial<Record<VideoQualityTier, string>> = {};
    if (resolved.videoVariants) {
      for (const tier of Object.keys(resolved.videoVariants) as VideoQualityTier[]) {
        videoQualityUrls[tier] = proxy.buildLocalUrl(resolved.videoId, 'video', tier);
      }
    }
    return {
      videoId: resolved.videoId,
      mode: 'dash-split',
      videoUrl: proxy.buildLocalUrl(resolved.videoId, 'video'),
      audioUrl: proxy.buildLocalUrl(resolved.videoId, 'audio'),
      videoQualityUrls,
      sourceType: 'youtube',
      mediaKind: 'video',
      expiresAtMs: resolved.expiresAtMs
    };
  }

  return {
    videoId: resolved.videoId,
    mode: 'muxed',
    muxedUrl: proxy.buildLocalUrl(resolved.videoId, 'muxed'),
    sourceType: 'youtube',
    mediaKind: 'video',
    expiresAtMs: resolved.expiresAtMs
  };
}

export function registerIpcHandlers(services: MainServices): void {
  ipcMain.handle(IPC_CHANNELS.YOUTUBE_SEARCH, (_event, rawQuery: unknown) =>
    wrapResult(async () => {
      const query = NonEmptyStringSchema.parse(rawQuery);
      return services.search.search(query);
    })
  );

  ipcMain.handle(IPC_CHANNELS.YOUTUBE_SEARCH_NEXT, () =>
    wrapResult(() => services.search.nextPage())
  );

  ipcMain.handle(IPC_CHANNELS.YOUTUBE_SUGGESTIONS, (_event, rawQuery: unknown) =>
    wrapResult(async () => {
      const query = z.string().max(200).parse(rawQuery);
      return services.search.getSuggestions(query);
    })
  );

  ipcMain.handle(IPC_CHANNELS.YOUTUBE_PLAYLIST, (_event, rawUrlOrId: unknown) =>
    wrapResult(async () => {
      const urlOrId = NonEmptyStringSchema.parse(rawUrlOrId);
      return services.search.getPlaylistTracks(urlOrId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.YOUTUBE_RELATED,
    (_event, rawVideoId: unknown, rawExcludeIds: unknown) =>
      wrapResult(async () => {
        const videoId = VideoIdSchema.parse(rawVideoId);
        const excludeIds = parseExcludeIds(rawExcludeIds);
        return services.search.getRelatedTracks(videoId, excludeIds);
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.YOUTUBE_RECOMMENDED,
    (_event, rawVideoId: unknown, rawExcludeIds: unknown, rawSeedTitle: unknown) =>
      wrapResult(async () => {
        const videoId = VideoIdSchema.parse(rawVideoId);
        const excludeIds = parseExcludeIds(rawExcludeIds);
        const seedTitle =
          typeof rawSeedTitle === 'string' ? rawSeedTitle.trim().slice(0, 200) : undefined;
        if (services.recommender) {
          return services.recommender.recommend({ seedVideoId: videoId, seedTitle, excludeVideoIds: excludeIds, limit: 12 });
        }
        const profile = services.history.buildTasteProfile(100);
        return services.search.getHistoryWeightedRecommendations(videoId, profile, excludeIds, 12);
      })
  );

  const requireTaste = (): TasteFeedbackService => {
    if (!services.taste) throw new Error('Taste feedback service unavailable');
    return services.taste;
  };

  ipcMain.handle(IPC_CHANNELS.TASTE_FEEDBACK, (_event, rawInput: unknown) =>
    wrapResult(() => {
      requireTaste().recordFeedback(FeedbackSchema.parse(rawInput));
      return true;
    })
  );

  ipcMain.handle(IPC_CHANNELS.TASTE_GET_SEEDS, () => wrapResult(() => requireTaste().getTasteSeeds()));

  ipcMain.handle(IPC_CHANNELS.TASTE_SET_SEEDS, (_event, rawSeeds: unknown) =>
    wrapResult(() => requireTaste().setTasteSeeds(TasteSeedsSchema.parse(rawSeeds)))
  );

  ipcMain.handle(IPC_CHANNELS.TASTE_SUMMARY, () => wrapResult(() => requireTaste().getSummary()));

  ipcMain.handle(IPC_CHANNELS.TASTE_UNBLOCK_CHANNEL, (_event, rawName: unknown) =>
    wrapResult(() => {
      requireTaste().unblockChannel(NonEmptyStringSchema.parse(rawName));
      return true;
    })
  );

  ipcMain.handle(IPC_CHANNELS.TASTE_RESET, () =>
    wrapResult(() => {
      requireTaste().resetFeedback();
      return true;
    })
  );

  ipcMain.handle(IPC_CHANNELS.STREAM_RESOLVE, (_event, rawVideoId: unknown, rawMeta: unknown) =>
    wrapResult(async () => {
      const videoId = VideoIdSchema.parse(rawVideoId);
      const cache = services.mediaCache;
      const hit = cache?.get(videoId) ?? null;
      // Saved with picture and sound: no YouTube round trip at all (instant, works offline).
      if (cache && hit && cache.isComplete(hit)) return buildCachedEndpoints(services.proxy, cache, hit);
      if (cache && hit && services.network?.getStatus().online === false) {
        return buildCachedEndpoints(services.proxy, cache, hit);
      }
      try {
        const resolved = await services.resolver.resolve(videoId);
        services.youtubeAccess?.monitor.reportPlaybackOk();
        const meta = CaptureMetaSchema.safeParse(rawMeta);
        if (cache && meta.success) cache.capture(videoId, resolved, meta.data);
        return buildEndpoints(services.proxy, resolved);
      } catch (err) {
        services.youtubeAccess?.monitor.reportPlaybackError(err instanceof Error ? err.message : String(err));
        void services.network?.check();
        // Only the sound is saved: still better than silence.
        if (cache && hit) return buildCachedEndpoints(services.proxy, cache, hit);
        throw err;
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.DJ_SUGGESTIONS, (_event, raw: unknown) =>
    wrapResult(() => {
      if (!services.djSuggestions) return { suggestions: [], typicalBpm: null, historySize: 0 };
      return services.djSuggestions.suggest(DjSuggestionRequestSchema.parse(raw ?? {}));
    })
  );

  ipcMain.handle(IPC_CHANNELS.MEDIA_CACHE_LIST, () =>
    wrapResult(() => services.mediaCache?.list() ?? [])
  );

  ipcMain.handle(IPC_CHANNELS.MEDIA_CACHE_USAGE, () =>
    wrapResult(() => services.mediaCache?.usage() ?? { bytes: 0, maxBytes: 0, songs: 0, withVideo: 0 })
  );

  ipcMain.handle(IPC_CHANNELS.MEDIA_CACHE_CLEAR, () =>
    wrapResult(() => {
      services.mediaCache?.clear();
      return services.mediaCache?.usage() ?? { bytes: 0, maxBytes: 0, songs: 0, withVideo: 0 };
    })
  );

  ipcMain.handle(IPC_CHANNELS.MEDIA_CACHE_CONFIGURE, (_event, raw: unknown) =>
    wrapResult(() => {
      const settings = MediaCacheSettingsSchema.parse(raw);
      services.db.setSetting('mediaCache', settings);
      services.mediaCache?.configure({ maxBytes: settings.maxGb * 1024 ** 3, saveVideo: settings.saveVideo });
      return services.mediaCache?.usage() ?? { bytes: 0, maxBytes: 0, songs: 0, withVideo: 0 };
    })
  );

  ipcMain.handle(IPC_CHANNELS.STREAM_INVALIDATE, (_event, rawVideoId: unknown) =>
    wrapResult(async () => {
      const videoId = VideoIdSchema.parse(rawVideoId);
      const resolved = await services.resolver.invalidateAndResolve(videoId);
      return buildEndpoints(services.proxy, resolved);
    })
  );

  ipcMain.handle(IPC_CHANNELS.YTDLP_STATUS, () =>
    wrapResult(() => services.ytDlp.getStatus())
  );

  ipcMain.handle(IPC_CHANNELS.YTDLP_ENSURE, () =>
    wrapResult(async () => {
      await services.ytDlp.ensureInstalled();
      return services.ytDlp.getStatus();
    })
  );


  const requireRequests = (): SongRequestsModule => {
    if (!services.songRequests) throw new Error('Pedidos de canciones no disponibles');
    return services.songRequests;
  };
  ipcMain.handle(IPC_CHANNELS.REQUESTS_SNAPSHOT, () => wrapResult(() => requireRequests().snapshot()));
  ipcMain.handle(IPC_CHANNELS.REQUESTS_SET_MODE, (_event, raw: unknown) =>
    wrapResult(() => requireRequests().setMode(RequestModeSchema.parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_DECIDE, (_event, rawId: unknown, rawDecision: unknown) =>
    wrapResult(() =>
      requireRequests().hub.decide(SongRequestIdSchema.parse(rawId), SongRequestDecisionSchema.parse(rawDecision))
    )
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_NOW_PLAYING, (_event, raw: unknown) =>
    wrapResult(() => requireRequests().hub.setNowPlaying(NowPlayingSchema.parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_UP_NEXT, (_event, raw: unknown) =>
    wrapResult(() => requireRequests().hub.setUpNext(UpNextSchema.parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_SET_PREFS, (_event, raw: unknown) =>
    wrapResult(() => {
      requireRequests().hub.setPrefs(SongRequestPrefsPatchSchema.parse(raw));
      return requireRequests().snapshot();
    })
  );
  const snapshotAfter = (fn: () => unknown | Promise<unknown>) =>
    wrapResult(async () => {
      await fn();
      return requireRequests().snapshot();
    });
  ipcMain.handle(IPC_CHANNELS.REQUESTS_PAGE_SETTINGS, (_event, raw: unknown) =>
    snapshotAfter(() => requireRequests().hub.setPageSettings(GuestPageSettingsSchema.partial().parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_CHAT_SEND, (_event, raw: unknown) =>
    snapshotAfter(() => requireRequests().cloud.sendChat(ChatTextSchema.parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_REQUESTS_REGISTER, () => snapshotAfter(() => requireRequests().cloud.register()));
  ipcMain.handle(IPC_CHANNELS.CLOUD_REQUESTS_LINK, (_event, raw: unknown) =>
    snapshotAfter(() => requireRequests().cloud.link(LinkCodeSchema.parse(raw).code))
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_REQUESTS_UNREGISTER, () => snapshotAfter(() => requireRequests().cloud.unregister()));
  ipcMain.handle(IPC_CHANNELS.LOCAL_REQUESTS_SETTINGS, (_event, raw: unknown) =>
    snapshotAfter(() => requireRequests().local.updateSettings(LocalSettingsPatchSchema.parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.LOCAL_REQUESTS_ROTATE_KEY, () => snapshotAfter(() => requireRequests().local.rotateKey()));
  ipcMain.handle(IPC_CHANNELS.REQUESTS_SET_DJ_PRESENT, (_event, raw: unknown) =>
    snapshotAfter(() => requireRequests().hub.setDjPresent(z.boolean().parse(raw)))
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_ALERT, (_event, raw: unknown) =>
    wrapResult(() => {
      const a = z.object({ kind: z.enum(['load_failed', 'skipped', 'info']), text: z.string().max(300) }).parse(raw);
      requireRequests().cloud.sendAlert(a.kind, a.text);
    })
  );
  ipcMain.handle(IPC_CHANNELS.REQUESTS_PICK_LOGO, () =>
    wrapResult(async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Logo del local',
        properties: ['openFile'],
        filters: [{ name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });
      if (canceled || !filePaths[0]) return requireRequests().snapshot();
      const file = filePaths[0];
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
      const size = fs.statSync(file).size;
      if (size > 400_000) throw new Error('El logo pesa más de 400 KB. Usa una imagen más pequeña (por ejemplo 512 × 512 px).');
      const dataUrl = `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
      if (dataUrl.length > MAX_LOGO_DATA_URL || !LOGO_DATA_URL.test(dataUrl)) throw new Error('Ese archivo no es una imagen PNG, JPG o WebP.');
      requireRequests().hub.setPageSettings({ logoDataUrl: dataUrl });
      return requireRequests().snapshot();
    })
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_REQUESTS_LINK_ACCOUNT, () =>
    snapshotAfter(() => requireRequests().cloud.linkWithAccount(services.account?.licenseToken() ?? null))
  );

  const requireAccount = (): LantifyAccountService => {
    if (!services.account) throw new Error('La cuenta de Lantify no está disponible');
    return services.account;
  };
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_STATUS, () => wrapResult(() => requireAccount().getStatus()));
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_SIGN_IN, (_event, raw: unknown) =>
    wrapResult(() =>
      requireAccount().signIn(
        z.object({ tenantCode: z.string().max(40).optional(), username: z.string().max(120), password: z.string().max(256) }).parse(raw)
      )
    )
  );
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_SIGN_IN_POS, () => wrapResult(() => requireAccount().signInWithLocalPos(false)));
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_SIGN_OUT, () => wrapResult(() => requireAccount().signOut()));
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_OPEN_SIGNUP, () => wrapResult(() => shell.openExternal(PROYECTA_SIGNUP_URL)));

  ipcMain.handle(IPC_CHANNELS.REQUESTS_PRINT_SHEET, (_event, raw: unknown) =>
    wrapResult(async () => {
      const tables = z.number().int().min(0).max(100).parse(raw);
      const html = await requireRequests().buildTableSheet(tables);
      const dir = path.join(app.getPath('documents'), 'Proyecta');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'QR para pedir canciones.html');
      fs.writeFileSync(file, html, 'utf8');
      const err = await shell.openPath(file);
      if (err) throw new Error(`Se guardó en ${file}, pero no se pudo abrir: ${err}`);
      return file;
    })
  );

  ipcMain.handle(IPC_CHANNELS.DB_GET_SETTING, (_event, rawKey: unknown, fallback: unknown) =>
    wrapResult(() => {
      const key = assertPublicSettingKey(NonEmptyStringSchema.parse(rawKey));
      return services.db.getSetting(key, fallback);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DB_SET_SETTING, (_event, rawKey: unknown, value: unknown) =>
    wrapResult(() => {
      const key = assertPublicSettingKey(NonEmptyStringSchema.parse(rawKey));
      services.db.setSetting(key, value);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DB_GET_TRACK_META, (_event, rawVideoId: unknown) =>
    wrapResult(() => {
      const videoId = VideoIdSchema.parse(rawVideoId);
      return services.db.getTrackMetadata(videoId);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DB_UPSERT_TRACK_META, (_event, rawTrack: unknown) =>
    wrapResult(() => {
      const obj = z.object({ videoId: VideoIdSchema }).passthrough().parse(rawTrack);
      return services.db.upsertTrackMetadata(obj);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DISPLAY_LIST, () =>
    wrapResult(() => services.displays.listDisplays())
  );

  ipcMain.handle(
    IPC_CHANNELS.DISPLAY_OPEN_OUTPUT,
    (_event, rawDisplayId: unknown, rawFullscreen: unknown) =>
      wrapResult(() => {
        const displayId =
          rawDisplayId === null || rawDisplayId === undefined
            ? null
            : z.number().int().parse(rawDisplayId);
        const fullscreen = typeof rawFullscreen === 'boolean' ? rawFullscreen : true;
        return services.displays.openOutputWindow(displayId, fullscreen);
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.DISPLAY_MOVE_OUTPUT,
    (_event, rawDisplayId: unknown, rawFullscreen: unknown) =>
      wrapResult(() => {
        const displayId = z.number().int().parse(rawDisplayId);
        const fullscreen = typeof rawFullscreen === 'boolean' ? rawFullscreen : true;
        return services.displays.moveOutputToDisplay(displayId, fullscreen);
      })
  );

  ipcMain.handle(IPC_CHANNELS.DISPLAY_CLOSE_OUTPUT, () =>
    wrapResult(() => {
      services.displays.closeOutputWindow();
    })
  );

  ipcMain.handle(IPC_CHANNELS.DISPLAY_SIGNAL_TO_OUTPUT, (_event, rawSignal: unknown) =>
    wrapResult(() => {
      const signal = RtcSignalSchema.parse(rawSignal) as RtcSignalPayload;
      return services.displays.relaySignalToOutput(signal);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DISPLAY_SIGNAL_TO_MAIN, (_event, rawSignal: unknown) =>
    wrapResult(() => {
      const signal = RtcSignalSchema.parse(rawSignal) as RtcSignalPayload;
      return services.displays.relaySignalToMain(signal);
    })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_START_SESSION, (_event, rawTitle: unknown) =>
    wrapResult(() => {
      const title = typeof rawTitle === 'string' ? rawTitle.slice(0, 120) : undefined;
      return services.history.startSession(title);
    })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_END_SESSION, (_event, rawSessionId: unknown) =>
    wrapResult(() => {
      const sessionId = NonEmptyStringSchema.parse(rawSessionId);
      services.history.endSession(sessionId);
    })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_LIST_SESSIONS, () =>
    wrapResult(() => services.history.listSessions())
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_LOG_PLAY, (_event, rawEntry: unknown) =>
    wrapResult(() => {
      const parsed = z
        .object({
          sessionId: NonEmptyStringSchema,
          deck: z.enum(['A', 'B']),
          videoId: VideoIdSchema,
          title: NonEmptyStringSchema,
          channel: z.string(),
          durationSec: z.number().nonnegative(),
          playedAt: z.number(),
          endedAt: z.number().nullable(),
          bpm: z.number().nullable(),
          transitionUsed: z.string().nullable()
        })
        .parse(rawEntry);
      return services.history.logTrackPlay(parsed);
    })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_ENTRIES, (_event, rawSessionId: unknown) =>
    wrapResult(() => {
      const sessionId = NonEmptyStringSchema.parse(rawSessionId);
      return services.history.getSessionHistory(sessionId);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.HISTORY_EXPORT_SESSION,
    (_event, rawSessionId: unknown, rawFormat: unknown) =>
      wrapResult(async () => {
        const sessionId = NonEmptyStringSchema.parse(rawSessionId);
        const format = z.enum(['json', 'csv', 'm3u']).parse(rawFormat) as ExportFormat;
        const session = services.history.listSessions().find((s) => s.id === sessionId);
        if (!session) throw new Error('Sesión no encontrada');
        const entries = services.history.getSessionHistory(sessionId);
        const safeName = session.title.replace(/[^a-zA-Z0-9_-]+/g, '_');
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Exportar Sesión Mix',
          defaultPath: `${safeName}.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }]
        });
        if (canceled || !filePath) return null;
        await services.exporter.exportToFile(filePath, session, entries, format);
        return filePath;
      })
  );

  ipcMain.handle(IPC_CHANNELS.CRATE_LIST, () =>
    wrapResult(() => services.history.listCrates())
  );

  ipcMain.handle(IPC_CHANNELS.CRATE_CREATE, (_event, rawName: unknown, rawColor: unknown) =>
    wrapResult(() => {
      const name = NonEmptyStringSchema.parse(rawName);
      const color = typeof rawColor === 'string' ? rawColor : '#00D4FF';
      return services.history.createCrate(name, color);
    })
  );

  ipcMain.handle(IPC_CHANNELS.CRATE_ADD_TRACK, (_event, rawCrateId: unknown, rawTrack: unknown) =>
    wrapResult(() => {
      const crateId = NonEmptyStringSchema.parse(rawCrateId);
      const track = z
        .object({
          videoId: VideoIdSchema,
          title: NonEmptyStringSchema,
          channel: z.string(),
          durationSec: z.number().nonnegative(),
          thumbnailUrl: z.string(),
          isLive: z.boolean()
        })
        .parse(rawTrack) as YouTubeTrack;
      services.history.addTrackToCrate(crateId, track);
    })
  );

  ipcMain.handle(IPC_CHANNELS.CRATE_SMART, (_event, rawQuery: unknown) =>
    wrapResult(() => {
      const query = z
        .object({
          kind: z.enum(['match', 'most-played', 'recent', 'liked', 'forgotten']),
          camelot: z.string().regex(/^\d{1,2}[AB]$/).nullish(),
          bpm: z.number().positive().max(400).nullish()
        })
        .parse(rawQuery);
      return services.history.getSmartCrate(query);
    })
  );

  ipcMain.handle(IPC_CHANNELS.CRATE_GET_TRACKS, (_event, rawCrateId: unknown) =>
    wrapResult(() => {
      const crateId = NonEmptyStringSchema.parse(rawCrateId);
      return services.history.getCrateTracks(crateId);
    })
  );

  ipcMain.handle(IPC_CHANNELS.MIDI_LIST_MAPPINGS, (_event, rawDevice: unknown) =>
    wrapResult(() => {
      const dev = typeof rawDevice === 'string' && rawDevice.length > 0 ? rawDevice : undefined;
      return services.history.listMidiMappings(dev);
    })
  );

  ipcMain.handle(IPC_CHANNELS.MIDI_SAVE_MAPPING, (_event, rawMapping: unknown) =>
    wrapResult(() => {
      const parsed = z
        .object({
          deviceName: NonEmptyStringSchema,
          controlKey: NonEmptyStringSchema,
          channel: z.number().int().min(0).max(15),
          statusType: z.enum(['cc', 'note']),
          ccOrNote: z.number().int().min(0).max(127),
          mode: z.enum(['absolute', 'toggle', 'trigger']),
          minVal: z.number(),
          maxVal: z.number()
        })
        .parse(rawMapping);
      return services.history.saveMidiMapping(parsed);
    })
  );

  ipcMain.handle(IPC_CHANNELS.MIDI_DELETE_MAPPING, (_event, rawId: unknown) =>
    wrapResult(() => {
      const id = NonEmptyStringSchema.parse(rawId);
      services.history.deleteMidiMapping(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.UPDATER_STATUS, () =>
    wrapResult(() => services.updater?.getStatus() ?? null)
  );

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, () =>
    wrapResult(async () => {
      if (!services.updater) return null;
      return services.updater.checkForUpdates();
    })
  );

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, () =>
    wrapResult(async () => {
      if (!services.updater) return null;
      return services.updater.downloadUpdate();
    })
  );

  ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL, () =>
    wrapResult(() => services.updater?.quitAndInstall() ?? false)
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_TASTE_PROFILE, () =>
    wrapResult(() => services.history.buildTasteProfile(100))
  );

  ipcMain.handle(
    IPC_CHANNELS.HISTORY_BATCH_DOWNLOAD,
    (_event, rawSessionId: unknown, rawFormat: unknown) =>
      wrapResult(async () => {
        if (!services.batchDownloader) {
          throw new Error('Batch downloader unavailable');
        }
        const sessionId = NonEmptyStringSchema.parse(rawSessionId);
        const format = z.enum(['video', 'audio']).parse(rawFormat) as BatchDownloadFormat;
        const entries = services.history.getSessionHistory(sessionId);
        const tracks: YouTubeTrack[] = entries
          .filter((e) => /^[A-Za-z0-9_-]{11}$/.test(e.videoId))
          .map((e) => ({
            videoId: e.videoId,
            title: e.title,
            channel: e.channel,
            durationSec: e.durationSec,
            thumbnailUrl: `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
            isLive: false
          }));
        if (tracks.length === 0) {
          throw new Error('No hay videos de YouTube en el historial de esta sesión');
        }
        const session = services.history.listSessions().find((s) => s.id === sessionId);
        const targetDir = sessionDownloadFolder(
          services.sessionDownloadsDir ?? path.join(app.getPath('music'), 'Proyecta', 'Sesiones descargadas'),
          session?.title ?? '',
          session?.startedAt ?? Date.now()
        );
        void services.batchDownloader.startBatch(tracks, targetDir, format).catch(() => {});
        return services.batchDownloader.getProgress();
      })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_BATCH_DOWNLOAD_CANCEL, () =>
    wrapResult(() => services.batchDownloader?.cancel() ?? false)
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_BATCH_OPEN_FOLDER, (_event, rawPath: unknown) =>
    wrapResult(async () => {
      const base = services.sessionDownloadsDir;
      if (!base) throw new Error('Carpeta de descargas no disponible');
      fs.mkdirSync(base, { recursive: true });
      let target = base;
      if (typeof rawPath === 'string' && rawPath.trim()) {
        const wanted = path.resolve(rawPath.trim());
        const rel = path.relative(path.resolve(base), wanted);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(wanted)) target = wanted;
      }
      const err = await shell.openPath(target);
      if (err) throw new Error(err);
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_LIST_LIBRARY, () =>
    wrapResult(() => services.localLibrary?.listLibrary() ?? { folders: [], tracks: [] })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_PICK_FILES, () =>
    wrapResult(async () => {
      if (!services.localLibrary) return { folders: [], tracks: [] };
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Agregar archivos multimedia locales',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Video y Audio',
            extensions: ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac']
          }
        ]
      });
      if (!canceled && filePaths.length > 0) {
        services.localLibrary.addFiles(filePaths);
      }
      return services.localLibrary.listLibrary();
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_PICK_FOLDER, () =>
    wrapResult(async () => {
      if (!services.localLibrary) return { folders: [], tracks: [] };
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Agregar carpeta de videos o música local',
        properties: ['openDirectory']
      });
      if (!canceled && filePaths[0]) {
        services.localLibrary.addFolder(filePaths[0]);
      }
      return services.localLibrary.listLibrary();
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_REMOVE_FOLDER, (_event, rawFolder: unknown) =>
    wrapResult(() => {
      if (!services.localLibrary) return { folders: [], tracks: [] };
      const folderPath = NonEmptyStringSchema.parse(rawFolder);
      services.localLibrary.removeFolder(folderPath);
      return services.localLibrary.listLibrary();
    })
  );

  ipcMain.handle(IPC_CHANNELS.NET_STATUS, () =>
    wrapResult(() => services.network?.getStatus() ?? { online: true, checkedAtMs: null, offlineSinceMs: null })
  );
  ipcMain.handle(IPC_CHANNELS.NET_CHECK, () =>
    wrapResult(async () => {
      if (!services.network) return { online: true, checkedAtMs: null, offlineSinceMs: null };
      return services.network.check();
    })
  );

  ipcMain.handle(IPC_CHANNELS.YT_ACCESS_STATUS, () =>
    wrapResult(() => {
      if (!services.youtubeAccess) throw new Error('No disponible');
      return services.youtubeAccess.monitor.getStatus();
    })
  );
  ipcMain.handle(IPC_CHANNELS.YT_ACCESS_CHECK, () =>
    wrapResult(() => {
      if (!services.youtubeAccess) throw new Error('No disponible');
      return services.youtubeAccess.monitor.check();
    })
  );
  ipcMain.handle(IPC_CHANNELS.YT_ACCESS_CONNECT, () =>
    wrapResult(() => {
      if (!services.youtubeAccess) throw new Error('No disponible');
      return services.youtubeAccess.connect();
    })
  );
  ipcMain.handle(IPC_CHANNELS.YT_ACCESS_DISCONNECT, () =>
    wrapResult(() => {
      if (!services.youtubeAccess) throw new Error('No disponible');
      return services.youtubeAccess.disconnect();
    })
  );

  ipcMain.handle(IPC_CHANNELS.REC_START, (_event, rawKind: unknown) =>
    wrapResult(() => {
      if (!services.recordings) throw new Error('Grabación no disponible');
      const kind = z.enum(['audio', 'video']).parse(rawKind);
      return services.recordings.start(kind);
    })
  );

  ipcMain.handle(IPC_CHANNELS.REC_CHUNK, (_event, rawId: unknown, rawChunk: unknown) =>
    wrapResult(() => {
      if (!services.recordings) throw new Error('Grabación no disponible');
      const id = NonEmptyStringSchema.parse(rawId);
      if (!(rawChunk instanceof Uint8Array)) throw new Error('Fragmento de grabación inválido');
      return services.recordings.append(id, rawChunk);
    })
  );

  ipcMain.handle(IPC_CHANNELS.REC_STOP, (_event, rawId: unknown) =>
    wrapResult(() => {
      if (!services.recordings) throw new Error('Grabación no disponible');
      return services.recordings.stop(NonEmptyStringSchema.parse(rawId));
    })
  );

  ipcMain.handle(IPC_CHANNELS.REC_REVEAL, (_event, rawPath: unknown) =>
    wrapResult(() => {
      if (!services.recordings) return;
      const filePath = z.string().trim().min(1).max(1000).parse(rawPath);
      if (!services.recordings.isOwnRecording(filePath)) throw new Error('Ruta no permitida');
      shell.showItemInFolder(filePath);
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_LIST_PLACES, () =>
    wrapResult(async (): Promise<LocalPlace[]> => {
      const quick: LocalPlace[] = [];
      if (services.sessionDownloadsDir) {
        try {
          fs.mkdirSync(services.sessionDownloadsDir, { recursive: true });
          quick.push({
            kind: 'folder',
            label: 'Sesiones descargadas',
            path: services.sessionDownloadsDir,
            detail: 'Descargas en lote de Proyecta'
          });
        } catch {
          // folder could not be created (permissions); skip the shortcut
        }
      }
      const named: [Parameters<typeof app.getPath>[0], string][] = [
        ['music', 'Música'],
        ['videos', 'Videos'],
        ['downloads', 'Descargas'],
        ['desktop', 'Escritorio']
      ];
      for (const [key, label] of named) {
        try {
          quick.push({ kind: 'folder', label, path: app.getPath(key) });
        } catch {
          // folder not defined on this OS
        }
      }
      const saved: LocalPlace[] = (services.localLibrary?.listLibrary().folders ?? []).map((f) => ({
        kind: 'library',
        label: path.basename(f) || f,
        path: f,
        detail: f
      }));
      return [...saved, ...quick, ...(await listDrivePlaces())];
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_BROWSE_DIR, (_event, rawPath: unknown, rawRecursive: unknown) =>
    wrapResult(() => {
      const dirPath = z.string().trim().min(1).max(1000).parse(rawPath);
      return browseDirectory(dirPath, rawRecursive === true);
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_ADD_FOLDER_PATH, (_event, rawPath: unknown) =>
    wrapResult(() => {
      if (!services.localLibrary) return { folders: [], tracks: [] };
      const dirPath = z.string().trim().min(1).max(1000).parse(rawPath);
      services.localLibrary.addFolder(dirPath);
      return services.localLibrary.listLibrary();
    })
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_RESOLVE_FILE, (_event, rawFilePath: unknown) =>
    wrapResult((): DeckStreamEndpoints => {
      const filePath = z.string().trim().min(1).max(1000).parse(rawFilePath);
      const reg = services.proxy.registerLocalFile(filePath);
      const videoId = `local_${path.basename(filePath).slice(0, 16)}`;
      return {
        videoId,
        mode: 'muxed',
        muxedUrl: reg.mediaKind === 'video' ? reg.url : undefined,
        audioUrl: reg.mediaKind === 'audio' ? reg.url : undefined,
        sourceType: 'local',
        mediaKind: reg.mediaKind,
        expiresAtMs: Number.MAX_SAFE_INTEGER
      };
    })
  );
}

/** `<base>/<YYYY-MM-DD HHmm> <title>` with characters Windows rejects removed. */
export function sessionDownloadFolder(base: string, title: string, startedAtMs: number): string {
  const d = new Date(startedAtMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const clean = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  const name = clean && !clean.startsWith('Sesión') ? `${stamp} ${clean}` : stamp;
  return path.join(base, name);
}
