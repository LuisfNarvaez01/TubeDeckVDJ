import { ipcMain, screen } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DeckStreamEndpoints, DisplayInfo, Result } from '../../shared/types';
import type { DatabaseService } from '../services/DatabaseService';
import type { RamStreamProxy } from '../services/RamStreamProxy';
import type { StreamResolverService } from '../services/StreamResolverService';
import type { YouTubeSearchService } from '../services/YouTubeSearchService';
import type { YtDlpBinaryManager } from '../services/YtDlpBinaryManager';

const VideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'ID de video inválido');
const NonEmptyStringSchema = z.string().trim().min(1).max(500);

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
    wrapResult((): DisplayInfo[] => {
      const primaryId = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d, idx) => ({
        id: d.id,
        label: d.label || `Pantalla ${idx + 1}`,
        bounds: d.bounds,
        isPrimary: d.id === primaryId
      }));
    })
  );
}
