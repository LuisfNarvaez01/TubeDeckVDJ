import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DisplayInfo, RtcSignalPayload } from '../../shared/types';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface ScreenDisplayLike {
  id: number;
  label?: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ScreenLike {
  getPrimaryDisplay(): ScreenDisplayLike;
  getAllDisplays(): ScreenDisplayLike[];
  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: (...args: unknown[]) => void): void;
  removeListener(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: (...args: unknown[]) => void): void;
}

export interface WebContentsSenderLike {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface MainBrowserWindowLike {
  isDestroyed(): boolean;
  webContents: WebContentsSenderLike;
}

export interface OutputBrowserWindowLike {
  isDestroyed(): boolean;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setFullScreen(flag: boolean): void;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string, options?: { query?: Record<string, string> }): Promise<void>;
  close(): void;
  destroy(): void;
  webContents: WebContentsSenderLike;
  on(event: 'closed', listener: () => void): void;
}

export type OutputWindowFactory = (options: {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
}) => OutputBrowserWindowLike;

function defaultOutputWindowFactory(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
}): OutputBrowserWindowLike {
  return new BrowserWindow({
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    fullscreen: options.fullscreen,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Proyecta — Salida Master',
    webPreferences: {
      preload: path.join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });
}

export const DISPLAY_SIGNAL_CHANNEL_TO_OUTPUT = 'display:signal-to-output';
export const DISPLAY_SIGNAL_CHANNEL_TO_MAIN = 'display:signal-to-main';

export class DisplayWindowManager {
  private readonly screenApi: ScreenLike;
  private readonly outputFactory: OutputWindowFactory;
  private mainWindow: MainBrowserWindowLike | null = null;
  private outputWindow: OutputBrowserWindowLike | null = null;
  private activeDisplayId: number | null = null;
  private onDisplaysChanged: ((displays: DisplayInfo[]) => void) | null = null;
  private onOutputClosed: (() => void) | null = null;

  private readonly handleDisplayAddedOrMetrics = (): void => {
    this.emitDisplaysChanged();
  };

  private readonly handleDisplayRemoved = (_event: unknown, removedDisplay?: unknown): void => {
    const removed = removedDisplay as ScreenDisplayLike | undefined;
    if (removed && this.activeDisplayId === removed.id && this.isOutputOpen()) {
      this.closeOutputWindow();
    } else if (this.activeDisplayId !== null) {
      const stillExists = this.screenApi.getAllDisplays().some((d) => d.id === this.activeDisplayId);
      if (!stillExists && this.isOutputOpen()) {
        this.closeOutputWindow();
      }
    }
    this.emitDisplaysChanged();
  };

  constructor(
    screenApi: ScreenLike = screen as unknown as ScreenLike,
    outputFactory: OutputWindowFactory = defaultOutputWindowFactory
  ) {
    this.screenApi = screenApi;
    this.outputFactory = outputFactory;
  }

  listDisplays(): DisplayInfo[] {
    const primaryId = this.screenApi.getPrimaryDisplay().id;
    return this.screenApi.getAllDisplays().map((d, idx) => ({
      id: d.id,
      label: d.label || `Pantalla ${idx + 1}`,
      bounds: { ...d.bounds },
      isPrimary: d.id === primaryId
    }));
  }

  getPreferredExternalDisplayId(): number | null {
    const external = this.listDisplays().find((d) => !d.isPrimary);
    return external ? external.id : null;
  }

  attachMainWindow(
    mainWindow: MainBrowserWindowLike,
    onDisplaysChanged: (displays: DisplayInfo[]) => void,
    onOutputClosed: () => void
  ): void {
    this.detachListeners();
    this.mainWindow = mainWindow;
    this.onDisplaysChanged = onDisplaysChanged;
    this.onOutputClosed = onOutputClosed;

    this.screenApi.on('display-added', this.handleDisplayAddedOrMetrics);
    this.screenApi.on('display-metrics-changed', this.handleDisplayAddedOrMetrics);
    this.screenApi.on('display-removed', this.handleDisplayRemoved);
  }

  isOutputOpen(): boolean {
    return Boolean(this.outputWindow && !this.outputWindow.isDestroyed());
  }

  openOutputWindow(displayId?: number | null, fullscreen = true): boolean {
    const displays = this.listDisplays();
    const target =
      displays.find((d) => d.id === displayId) ??
      displays.find((d) => !d.isPrimary) ??
      displays[0];

    if (!target) return false;

    const useFullscreen = fullscreen && (!target.isPrimary || displays.length > 1);

    if (this.isOutputOpen()) {
      return this.moveOutputToDisplay(target.id, useFullscreen);
    }

    const bounds = useFullscreen
      ? target.bounds
      : {
          x: target.bounds.x + 80,
          y: target.bounds.y + 80,
          width: Math.min(960, Math.max(640, target.bounds.width - 160)),
          height: Math.min(540, Math.max(360, target.bounds.height - 160))
        };

    const win = this.outputFactory({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fullscreen: useFullscreen
    });

    this.outputWindow = win;
    this.activeDisplayId = target.id;

    win.on('closed', () => {
      if (this.outputWindow === win) {
        this.outputWindow = null;
        this.activeDisplayId = null;
        this.onOutputClosed?.();
      }
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      const separator = devUrl.includes('?') ? '&' : '?';
      void win.loadURL(`${devUrl}${separator}role=output`);
    } else {
      void win.loadFile(path.join(moduleDir, '../renderer/index.html'), {
        query: { role: 'output' }
      });
    }

    return true;
  }

  moveOutputToDisplay(displayId: number, fullscreen: boolean): boolean {
    const target = this.listDisplays().find((d) => d.id === displayId);
    if (!target) return false;

    if (!this.isOutputOpen()) {
      return this.openOutputWindow(displayId, fullscreen);
    }

    const win = this.outputWindow!;
    win.setFullScreen(false);
    win.setBounds(target.bounds);
    win.setFullScreen(fullscreen);
    this.activeDisplayId = target.id;
    return true;
  }

  closeOutputWindow(): void {
    if (!this.outputWindow) {
      this.activeDisplayId = null;
      return;
    }
    const win = this.outputWindow;
    this.outputWindow = null;
    this.activeDisplayId = null;
    try {
      if (!win.isDestroyed()) {
        win.close();
      }
    } catch {
      try {
        win.destroy();
      } catch {
        // ignore double destroy
      }
    }
    this.onOutputClosed?.();
  }

  relaySignalToOutput(payload: RtcSignalPayload): boolean {
    if (!this.outputWindow || this.outputWindow.isDestroyed() || this.outputWindow.webContents.isDestroyed()) {
      return false;
    }
    this.outputWindow.webContents.send(DISPLAY_SIGNAL_CHANNEL_TO_OUTPUT, payload);
    return true;
  }

  relaySignalToMain(payload: RtcSignalPayload): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) {
      return false;
    }
    this.mainWindow.webContents.send(DISPLAY_SIGNAL_CHANNEL_TO_MAIN, payload);
    return true;
  }

  private emitDisplaysChanged(): void {
    this.onDisplaysChanged?.(this.listDisplays());
  }

  detachListeners(): void {
    this.screenApi.removeListener('display-added', this.handleDisplayAddedOrMetrics);
    this.screenApi.removeListener('display-metrics-changed', this.handleDisplayAddedOrMetrics);
    this.screenApi.removeListener('display-removed', this.handleDisplayRemoved);
  }

  dispose(): void {
    this.detachListeners();
    this.closeOutputWindow();
    this.mainWindow = null;
  }
}

