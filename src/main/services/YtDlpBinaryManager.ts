import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { YtDlpStatus } from '../../shared/types';

const execFileAsync = promisify(execFile);

const DOWNLOAD_URLS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
};

export class YtDlpBinaryManager {
  private readonly binDir: string;
  private readonly resourcesPath: string;
  private ensurePromise: Promise<string> | null = null;
  private lastError: string | null = null;
  private resolvedPath: string | null = null;

  constructor(binDir: string, resourcesPath = '') {
    this.binDir = binDir;
    this.resourcesPath = resourcesPath;
  }

  getManagedBinaryPath(): string {
    const fileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    return path.join(this.binDir, fileName);
  }

  getBinaryPath(): string {
    return this.resolvedPath ?? this.getManagedBinaryPath();
  }

  private findExistingBinary(): string | null {
    const fileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const candidates = [
      this.resourcesPath ? path.join(this.resourcesPath, 'bin', fileName) : '',
      this.getManagedBinaryPath()
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 100_000) {
        return candidate;
      }
    }
    return null;
  }

  async checkSystemPath(): Promise<string | null> {
    const cmd = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    try {
      await execFileAsync(cmd, ['--version'], { timeout: 4000 });
      return cmd;
    } catch {
      return null;
    }
  }

  async getStatus(): Promise<YtDlpStatus> {
    const local = this.findExistingBinary();
    if (local) {
      this.resolvedPath = local;
      return {
        available: true,
        binaryPath: local,
        downloading: Boolean(this.ensurePromise),
        error: null
      };
    }

    const sys = await this.checkSystemPath();
    if (sys) {
      this.resolvedPath = sys;
      return {
        available: true,
        binaryPath: sys,
        downloading: Boolean(this.ensurePromise),
        error: null
      };
    }

    return {
      available: false,
      binaryPath: null,
      downloading: Boolean(this.ensurePromise),
      error: this.lastError
    };
  }

  async ensureInstalled(): Promise<string> {
    const local = this.findExistingBinary();
    if (local) {
      this.resolvedPath = local;
      this.lastError = null;
      return local;
    }

    const sys = await this.checkSystemPath();
    if (sys) {
      this.resolvedPath = sys;
      this.lastError = null;
      return sys;
    }

    if (this.ensurePromise) {
      return this.ensurePromise;
    }

    this.ensurePromise = this.downloadBinary()
      .then((downloadedPath) => {
        this.resolvedPath = downloadedPath;
        this.lastError = null;
        return downloadedPath;
      })
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        this.ensurePromise = null;
      });

    return this.ensurePromise;
  }

  private async downloadBinary(): Promise<string> {
    const url = DOWNLOAD_URLS[process.platform] ?? DOWNLOAD_URLS.linux!;
    const targetPath = this.getManagedBinaryPath();
    const tmpPath = `${targetPath}.tmp`;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Failed to download yt-dlp (${response.status})`);
    }

    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength < 100_000) {
      throw new Error('Downloaded yt-dlp binary is unexpectedly small or corrupted');
    }

    fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));
    if (process.platform !== 'win32') {
      fs.chmodSync(tmpPath, 0o755);
    }
    fs.renameSync(tmpPath, targetPath);
    return targetPath;
  }
}

