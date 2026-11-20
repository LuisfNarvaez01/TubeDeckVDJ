import type { UpdateStatus } from '../../shared/types';

export interface UpdaterDriverLike {
  autoDownload: boolean;
  autoInstallOnAppQuit?: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface AutoUpdaterOptions {
  currentVersion: string;
  isPackaged: boolean;
  driverFactory?: () => Promise<UpdaterDriverLike>;
  onStatusChange?: (status: UpdateStatus) => void;
}

async function defaultDriverFactory(): Promise<UpdaterDriverLike> {
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: UpdaterDriverLike;
    default?: { autoUpdater?: UpdaterDriverLike };
  };
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!updater) {
    throw new Error('electron-updater autoUpdater export not found');
  }
  return updater;
}

function normalizeReleaseNotes(rawNotes: unknown): string | null {
  if (typeof rawNotes === 'string') return rawNotes.slice(0, 2000);
  if (Array.isArray(rawNotes)) {
    return rawNotes
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'note' in item) {
          return String((item as { note?: unknown }).note ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
  }
  return null;
}

export class AutoUpdaterService {
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly driverFactory: () => Promise<UpdaterDriverLike>;
  private readonly onStatusChange?: (status: UpdateStatus) => void;

  private driver: UpdaterDriverLike | null = null;
  private status: UpdateStatus;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AutoUpdaterOptions) {
    this.currentVersion = options.currentVersion;
    this.isPackaged = options.isPackaged;
    this.driverFactory = options.driverFactory ?? defaultDriverFactory;
    this.onStatusChange = options.onStatusChange;
    this.status = {
      state: options.isPackaged ? 'idle' : 'dev-mode',
      currentVersion: options.currentVersion,
      availableVersion: null,
      progressPercent: 0,
      releaseNotes: null,
      error: null
    };
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  private emit(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: this.currentVersion
    };
    this.onStatusChange?.(this.getStatus());
    return this.getStatus();
  }

  private async ensureDriver(): Promise<UpdaterDriverLike | null> {
    if (!this.isPackaged) {
      return null;
    }
    if (this.driver) {
      return this.driver;
    }

    const driver = await this.driverFactory();
    driver.autoDownload = false;
    driver.autoInstallOnAppQuit = true;

    driver.on('checking-for-update', () => {
      this.emit({ state: 'checking', error: null });
    });

    driver.on('update-available', (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string; releaseNotes?: unknown };
      this.emit({
        state: 'available',
        availableVersion: info.version ?? null,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        progressPercent: 0,
        error: null
      });
    });

    driver.on('update-not-available', () => {
      this.emit({
        state: 'not-available',
        availableVersion: null,
        progressPercent: 0,
        error: null
      });
    });

    driver.on('download-progress', (rawProg: unknown) => {
      const prog = (rawProg ?? {}) as { percent?: number };
      const pct = Math.min(100, Math.max(0, Number((prog.percent ?? 0).toFixed(1))));
      this.emit({ state: 'downloading', progressPercent: pct, error: null });
    });

    driver.on('update-downloaded', (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string };
      this.emit({
        state: 'downloaded',
        availableVersion: info.version ?? this.status.availableVersion,
        progressPercent: 100,
        error: null
      });
    });

    driver.on('error', (rawErr: unknown) => {
      const msg = rawErr instanceof Error ? rawErr.message : String(rawErr ?? 'Updater error');
      this.emit({ state: 'error', error: msg });
    });

    this.driver = driver;
    return driver;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!this.isPackaged) {
      return this.emit({
        state: 'dev-mode',
        availableVersion: null,
        progressPercent: 0,
        error: null
      });
    }

    try {
      const driver = await this.ensureDriver();
      if (!driver) return this.getStatus();
      this.emit({ state: 'checking', error: null });
      await driver.checkForUpdates();
      return this.getStatus();
    } catch (err) {
      return this.emit({
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    if (!this.isPackaged) {
      return this.getStatus();
    }

    try {
      const driver = await this.ensureDriver();
      if (!driver) return this.getStatus();
      this.emit({ state: 'downloading', progressPercent: 0, error: null });
      await driver.downloadUpdate();
      return this.getStatus();
    } catch (err) {
      return this.emit({
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  quitAndInstall(): boolean {
    if (!this.isPackaged || !this.driver || this.status.state !== 'downloaded') {
      return false;
    }
    this.driver.quitAndInstall(false, true);
    return true;
  }

  scheduleStartupCheck(delayMs = 8000): void {
    if (!this.isPackaged) return;
    this.cancelStartupCheck();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkForUpdates();
    }, delayMs);
  }

  cancelStartupCheck(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }
}

