import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BatchDownloadService } from '../../../src/main/services/BatchDownloadService';
import { DatabaseService } from '../../../src/main/services/DatabaseService';
import { LocalLibraryService } from '../../../src/main/services/LocalLibraryService';
import type { BatchDownloadProgress, YouTubeTrack } from '../../../src/shared/types';

function makeTrack(videoId: string, title: string): YouTubeTrack {
  return {
    videoId,
    title,
    channel: 'Test Channel',
    durationSec: 200,
    thumbnailUrl: '',
    isLive: false
  };
}

describe('BatchDownloadService', () => {
  let db: DatabaseService;
  let localLib: LocalLibraryService;
  let tmpDir: string;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.init();
    localLib = new LocalLibraryService(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-batch-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads unique YouTube tracks sequentially with ffmpeg-free format and registers folder', async () => {
    const events: BatchDownloadProgress[] = [];
    const runner = vi.fn(async (args: string[]) => {
      if (args.some((a) => a.includes('fail0000002'))) {
        throw new Error('Geo-blocked');
      }
    });

    const service = new BatchDownloadService({
      runner,
      localLibrary: localLib,
      onProgress: (p) => events.push(p)
    });

    const res = await service.startBatch(
      [
        makeTrack('good0000001', 'Track One'),
        makeTrack('good0000001', 'Track One Duplicate'),
        makeTrack('fail0000002', 'Track Broken'),
        { ...makeTrack('local_123456', 'Local Ignored'), source: 'local' }
      ],
      tmpDir,
      'video'
    );

    expect(res.status).toBe('done');
    expect(res.total).toBe(2);
    expect(res.completed).toBe(1);
    expect(res.failed).toBe(1);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0][0]).toContain('best[ext=mp4][height<=720]/best[ext=mp4]/18/best');
    expect(localLib.listLibrary().folders).toEqual([tmpDir]);
    expect(events.some((e) => e.status === 'running')).toBe(true);
  });

  it('supports cancelling an in-progress batch download cleanly', async () => {
    let cancelFn: (() => boolean) | null = null;
    const runner = vi.fn(async (_args: string[], signal: AbortSignal) => {
      cancelFn?.();
      if (signal.aborted) {
        throw new Error('Descarga cancelada');
      }
    });

    const service = new BatchDownloadService({ runner, localLibrary: localLib });
    cancelFn = () => service.cancel();

    const res = await service.startBatch(
      [makeTrack('good0000001', 'First'), makeTrack('good0000002', 'Second')],
      tmpDir,
      'audio'
    );

    expect(res.status).toBe('cancelled');
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

