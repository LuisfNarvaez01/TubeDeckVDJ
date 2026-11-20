import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { BatchDownloadProgress, YouTubeTrack } from '../../shared/types';
import type { LocalLibraryService } from './LocalLibraryService';
import type { YtDlpBinaryManager } from './YtDlpBinaryManager';

export type BatchDownloadFormat = 'video' | 'audio';
export type BatchDownloadRunner = (args: string[], signal: AbortSignal) => Promise<void>;

function createDefaultRunner(binaryManager: YtDlpBinaryManager): BatchDownloadRunner {
  return async (args: string[], signal: AbortSignal): Promise<void> => {
    const binPath = await binaryManager.ensureInstalled();
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Descarga cancelada'));
        return;
      }
      const child = spawn(binPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += String(d);
      });
      const onAbort = () => {
        try {
          child.kill();
        } catch {
          // ignore kill race
        }
        reject(new Error('Descarga cancelada'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `yt-dlp salió con código ${code}`));
      });
    });
  };
}

export class BatchDownloadService {
  private readonly runner: BatchDownloadRunner;
  private readonly localLibrary?: LocalLibraryService;
  private readonly onProgress?: (progress: BatchDownloadProgress) => void;
  private activeAbort: AbortController | null = null;
  private progress: BatchDownloadProgress = {
    jobId: '',
    status: 'idle',
    total: 0,
    completed: 0,
    failed: 0,
    currentTitle: '',
    outputDir: null,
    errors: []
  };

  constructor(options: {
    binaryManager?: YtDlpBinaryManager;
    runner?: BatchDownloadRunner;
    localLibrary?: LocalLibraryService;
    onProgress?: (progress: BatchDownloadProgress) => void;
  }) {
    if (options.runner) {
      this.runner = options.runner;
    } else if (options.binaryManager) {
      this.runner = createDefaultRunner(options.binaryManager);
    } else {
      throw new Error('BatchDownloadService requires binaryManager or runner');
    }
    this.localLibrary = options.localLibrary;
    this.onProgress = options.onProgress;
  }

  getProgress(): BatchDownloadProgress {
    return { ...this.progress, errors: [...this.progress.errors] };
  }

  private emit(patch: Partial<BatchDownloadProgress>): void {
    this.progress = { ...this.progress, ...patch };
    this.onProgress?.(this.getProgress());
  }

  cancel(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  async startBatch(
    tracks: YouTubeTrack[],
    outputDir: string,
    format: BatchDownloadFormat = 'video'
  ): Promise<BatchDownloadProgress> {
    if (this.activeAbort) {
      throw new Error('Ya hay una descarga por lotes en curso');
    }

    const unique: YouTubeTrack[] = [];
    const seen = new Set<string>();
    for (const t of tracks) {
      if (t.source === 'local' || !/^[A-Za-z0-9_-]{11}$/.test(t.videoId)) continue;
      if (!seen.has(t.videoId)) {
        seen.add(t.videoId);
        unique.push(t);
      }
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const jobId = `dl-${crypto.randomUUID().slice(0, 8)}`;
    const abort = new AbortController();
    this.activeAbort = abort;

    this.emit({
      jobId,
      status: 'running',
      total: unique.length,
      completed: 0,
      failed: 0,
      currentTitle: unique[0]?.title ?? '',
      outputDir,
      errors: []
    });

    const formatSelector =
      format === 'audio'
        ? 'bestaudio[ext=m4a]/bestaudio'
        : 'best[ext=mp4][height<=720]/best[ext=mp4]/18/best';

    const outTemplate = path.join(outputDir, '%(title).90s [%(id)s].%(ext)s');

    try {
      for (const track of unique) {
        if (abort.signal.aborted) {
          this.emit({ status: 'cancelled', currentTitle: '' });
          return this.getProgress();
        }

        this.emit({ currentTitle: track.title });
        const args = [
          '-f',
          formatSelector,
          '--no-playlist',
          '--no-warnings',
          '--windows-filenames',
          '--no-overwrites',
          '-o',
          outTemplate,
          `https://www.youtube.com/watch?v=${track.videoId}`
        ];

        try {
          await this.runner(args, abort.signal);
          this.emit({ completed: this.progress.completed + 1 });
        } catch (err) {
          if (abort.signal.aborted) {
            this.emit({ status: 'cancelled', currentTitle: '' });
            return this.getProgress();
          }
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({
            failed: this.progress.failed + 1,
            errors: [...this.progress.errors, `${track.title}: ${msg}`]
          });
        }
      }

      if (this.progress.completed > 0) {
        this.localLibrary?.addFolder(outputDir);
      }

      this.emit({
        status: 'done',
        currentTitle: ''
      });
      return this.getProgress();
    } finally {
      this.activeAbort = null;
    }
  }
}

