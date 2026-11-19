import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DeckStreamEndpoints, Result, RtcSignalPayload } from '../../shared/types';
import type { DatabaseService } from '../services/DatabaseService';
import type { DisplayWindowManager } from '../services/DisplayWindowManager';
import type { RamStreamProxy } from '../services/RamStreamProxy';
import type { StreamResolverService } from '../services/StreamResolverService';
import type { YouTubeSearchService } from '../services/YouTubeSearchService';
import type { YtDlpBinaryManager } from '../services/YtDlpBinaryManager';

const VideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'ID de video inválido');
const NonEmptyStringSchema = z.string().trim().min(1).max(500);
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
}

function buildEndpoints(
  proxy: RamStreamProxy,
  resolved: Awaited<ReturnType<StreamResolverService['resolve']>>
): DeckStreamEndpoints {
  if (resolved.mode === 'dash-split') {
    return {
      videoId: resolved.videoId,
      mode: 'dash-split',
      videoUrl: proxy.buildLocalUrl(resolved.videoId, 'video'),
      audioUrl: proxy.buildLocalUrl(resolved.videoId, 'audio'),
      expiresAtMs: resolved.expiresAtMs
    };
  }

  return {
    videoId: resolved.videoId,
    mode: 'muxed',
    muxedUrl: proxy.buildLocalUrl(resolved.videoId, 'muxed'),
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
}
