import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { BatchDownloadProgress, YouTubeTrack } from '../../shared/types';
import type { LocalLibraryService } from './LocalLibraryService';
import type { YtDlpBinaryManager } from './YtDlpBinaryManager';

export type BatchDownloadFormat = 'video' | 'audio';
export type BatchDownloadRunner = (
  args: string[],
  signal: AbortSignal,
  onPercent?: (percent: number) => void
) => Promise<void>;

export interface BatchRunnerOptions {
  /** Same sign-in cookies the player uses, so a bot check does not block downloads. */
  getCookieFile?: () => string | null;
  /** Electron's own Node, used by yt-dlp to solve YouTube's JS challenges. */
  nodeRuntimePath?: string;
  /** Kill a download that prints nothing for this long (stuck connection). */
  idleTimeoutMs?: number;
}

const PERCENT_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

/** Extra yt-dlp flags shared by every batch item: JS runtime, cookies, line-based progress. */
export function buildBatchRuntimeArgs(opts: BatchRunnerOptions): string[] {
  const args = ['--newline', '--progress', '--socket-timeout', '20', '--retries', '3'];
  if (opts.nodeRuntimePath) args.push('--js-runtimes', `node:${opts.nodeRuntimePath}`);
  const cookies = opts.getCookieFile?.();
  if (cookies) args.push('--cookies', cookies);
  return args;
}

export function parseDownloadPercent(line: string): number | null {
  const m = PERCENT_RE.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

function createDefaultRunner(binaryManager: YtDlpBinaryManager, opts: BatchRunnerOptions): BatchDownloadRunner {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 90_000;
  return async (args, signal, onPercent): Promise<void> => {
    const binPath = await binaryManager.ensureInstalled();
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Descarga cancelada'));
        return;
      }
      const child = spawn(binPath, [...buildBatchRuntimeArgs(opts), ...args], {
        windowsHide: true,
        // stdin closed; stdout MUST be drained or yt-dlp blocks once the pipe fills up.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.nodeRuntimePath ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
      });
      let stderr = '';
      let settled = false;
      let idleTimer: NodeJS.Timeout | null = null;
      const kill = (): void => {
        try {
          child.kill();
        } catch {
          // ignore kill race
        }
      };
      const onAbort = (): void => {
        kill();
        finish(new Error('Descarga cancelada'));
      };
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };
      const bumpIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          kill();
          finish(new Error('la descarga dejó de avanzar (sin conexión o YouTube no responde)'));
        }, idleTimeoutMs);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      bumpIdle();
      let buf = '';
      child.stdout?.on('data', (d) => {
        bumpIdle();
        buf += String(d);
        const lines = buf.split(/\r?\n|\r/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const pct = parseDownloadPercent(line);
          if (pct !== null) onPercent?.(pct);
        }
      });
      child.stderr?.on('data', (d) => {
        bumpIdle();
        stderr = (stderr + String(d)).slice(-4000);
      });
      child.on('error', (err) => finish(err));
      child.on('close', (code) => {
        if (code === 0) {
          finish();
          return;
        }
        const lastError = stderr
          .split(/\r?\n/)
          .filter((l) => /ERROR/i.test(l))
          .pop();
        finish(new Error((lastError ?? stderr.trim()) || `yt-dlp salió con código ${code}`));
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
    runnerOptions?: BatchRunnerOptions;
    localLibrary?: LocalLibraryService;
    onProgress?: (progress: BatchDownloadProgress) => void;
  }) {
    if (options.runner) {
      this.runner = options.runner;
    } else if (options.binaryManager) {
      this.runner = createDefaultRunner(options.binaryManager, options.runnerOptions ?? {});
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
      errors: [],
      currentPercent: 0
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

        this.emit({ currentTitle: track.title, currentPercent: 0 });
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
          let lastEmitPct = -10;
          await this.runner(args, abort.signal, (pct) => {
            if (pct - lastEmitPct >= 2 || pct >= 100) {
              lastEmitPct = pct;
              this.emit({ currentPercent: pct });
            }
          });
          this.emit({ completed: this.progress.completed + 1, currentPercent: 100 });
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

