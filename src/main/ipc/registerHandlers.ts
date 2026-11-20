import { dialog, ipcMain } from 'electron';
import path from 'path';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type {
  DeckStreamEndpoints,
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
import type { LocalLibraryService } from '../services/LocalLibraryService';
import type { RecommendationEngine } from '../services/RecommendationEngine';
import type { TasteFeedbackService } from '../services/TasteFeedbackService';
import type { RamStreamProxy } from '../services/RamStreamProxy';
import type { ExportFormat, SessionExporter } from '../services/SessionExporter';
import type { StreamResolverService } from '../services/StreamResolverService';
import type { YouTubeSearchService } from '../services/YouTubeSearchService';
import type { YtDlpBinaryManager } from '../services/YtDlpBinaryManager';

const VideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'ID de video inválido');
const NonEmptyStringSchema = z.string().trim().min(1).max(500);
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
  batchDownloader?: BatchDownloadService;
  taste?: TasteFeedbackService;
  recommender?: RecommendationEngine;
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
        const excludeIds = Array.isArray(rawExcludeIds)
          ? z.array(VideoIdSchema).max(200).parse(rawExcludeIds)
          : [];
        return services.search.getRelatedTracks(videoId, excludeIds);
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.YOUTUBE_RECOMMENDED,
    (_event, rawVideoId: unknown, rawExcludeIds: unknown, rawSeedTitle: unknown) =>
      wrapResult(async () => {
        const videoId = VideoIdSchema.parse(rawVideoId);
        const excludeIds = Array.isArray(rawExcludeIds)
          ? z.array(VideoIdSchema).max(200).parse(rawExcludeIds)
          : [];
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

  ipcMain.handle(IPC_CHANNELS.STREAM_RESOLVE, (_event, rawVideoId: unknown) =>
    wrapResult(async () => {
      const videoId = VideoIdSchema.parse(rawVideoId);
      const resolved = await services.resolver.resolve(videoId);
      return buildEndpoints(services.proxy, resolved);
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

  ipcMain.handle(IPC_CHANNELS.DB_GET_SETTING, (_event, rawKey: unknown, fallback: unknown) =>
    wrapResult(() => {
      const key = NonEmptyStringSchema.parse(rawKey);
      return services.db.getSetting(key, fallback);
    })
  );

  ipcMain.handle(IPC_CHANNELS.DB_SET_SETTING, (_event, rawKey: unknown, value: unknown) =>
    wrapResult(() => {
      const key = NonEmptyStringSchema.parse(rawKey);
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
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: 'Elegir carpeta para descargar videos de la sesión',
          properties: ['openDirectory', 'createDirectory']
        });
        if (canceled || !filePaths[0]) {
          return null;
        }
        const targetDir = filePaths[0];
        void services.batchDownloader.startBatch(tracks, targetDir, format).catch(() => {});
        return services.batchDownloader.getProgress();
      })
  );

  ipcMain.handle(IPC_CHANNELS.HISTORY_BATCH_DOWNLOAD_CANCEL, () =>
    wrapResult(() => services.batchDownloader?.cancel() ?? false)
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
