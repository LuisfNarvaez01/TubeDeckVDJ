import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { AutoUpdaterService } from './services/AutoUpdaterService';
import { BatchDownloadService } from './services/BatchDownloadService';
import { DatabaseService } from './services/DatabaseService';
import { DisplayWindowManager } from './services/DisplayWindowManager';
import { HistoryAndCratesService } from './services/HistoryAndCratesService';
import { LocalLibraryService } from './services/LocalLibraryService';
import { MixRecordingService } from './services/MixRecordingService';
import { RecommendationEngine } from './services/RecommendationEngine';
import { TasteFeedbackService } from './services/TasteFeedbackService';
import { RamStreamProxy } from './services/RamStreamProxy';
import { SessionExporter } from './services/SessionExporter';
import {
  createDefaultYtDlpRunner,
  StreamResolverService
} from './services/StreamResolverService';
import { YouTubeSearchService } from './services/YouTubeSearchService';
import { YtDlpBinaryManager } from './services/YtDlpBinaryManager';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const LEGACY_DATA_FOLDER = 'TubeDeck VDJ';

let mainWindow: BrowserWindow | null = null;
let dbService: DatabaseService | null = null;
let ramProxy: RamStreamProxy | null = null;
let displayManager: DisplayWindowManager | null = null;
let updaterService: AutoUpdaterService | null = null;
let batchDownloaderService: BatchDownloadService | null = null;
let recordingService: MixRecordingService | null = null;

function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = isDev
    ? "'self' http://127.0.0.1:* http://localhost:* ws://localhost:*"
    : "'self' http://127.0.0.1:*";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' http://127.0.0.1:* blob:",
    "img-src 'self' https://i.ytimg.com https://*.ggpht.com data: blob:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');
}

function configureSecurityHeaders(): void {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const csp = buildContentSecurityPolicy(isDev);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      responseHeaders['Content-Security-Policy'] = [csp];
    }
    callback({ responseHeaders });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = permission === 'media' || permission === 'midi' || permission === 'midiSysex';
    callback(allowed);
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 740,
    backgroundColor: '#0B0E14',
    title: 'Proyecta',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(moduleDir, '../renderer/index.html'));
  }

  return win;
}

// Renamed to Proyecta in v3.1: keep reading the data folder created as "TubeDeck VDJ"
// (history, crates, likes, settings) instead of starting empty under the new name.
app.setPath('userData', path.join(app.getPath('appData'), LEGACY_DATA_FOLDER));

app.whenReady().then(async () => {
  if (process.env.TUBEDECK_USER_DATA_DIR) {
    app.setPath('userData', process.env.TUBEDECK_USER_DATA_DIR);
  }
  configureSecurityHeaders();

  const userDataDir = app.getPath('userData');
  const db = new DatabaseService(path.join(userDataDir, 'tubedeck.db'));
  await db.init();
  dbService = db;

  const ytDlp = new YtDlpBinaryManager(
    path.join(userDataDir, 'bin'),
    app.isPackaged ? process.resourcesPath : ''
  );
  const resolver = new StreamResolverService(createDefaultYtDlpRunner(ytDlp));
  const proxy = new RamStreamProxy(resolver);
  await proxy.start();
  ramProxy = proxy;

  const displays = new DisplayWindowManager();
  displayManager = displays;

  const search = new YouTubeSearchService();
  const history = new HistoryAndCratesService(db);
  const taste = new TasteFeedbackService(db);
  const recommender = new RecommendationEngine(search, {
    getSnapshot: () => taste.getSnapshot(),
    buildTasteProfile: (limit) => history.buildTasteProfile(limit)
  });
  const exporter = new SessionExporter();
  const localLibrary = new LocalLibraryService(db);
  const recordings = new MixRecordingService(path.join(app.getPath('music'), 'Proyecta Grabaciones'));
  recordingService = recordings;
  const batchDownloader = new BatchDownloadService({
    binaryManager: ytDlp,
    localLibrary,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.HISTORY_BATCH_DOWNLOAD_PROGRESS, progress);
      }
    }
  });
  batchDownloaderService = batchDownloader;
  const updater = new AutoUpdaterService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.UPDATER_STATUS_EVENT, status);
      }
    }
  });
  updaterService = updater;
  registerIpcHandlers({
    db,
    search,
    ytDlp,
    resolver,
    proxy,
    displays,
    history,
    exporter,
    updater,
    localLibrary,
    batchDownloader,
    taste,
    recommender,
    recordings
  });

  mainWindow = createMainWindow();
  updater.scheduleStartupCheck(8000);
  displays.attachMainWindow(
    mainWindow,
    (list) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.DISPLAY_CHANGED_EVENT, list);
      }
    },
    () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.DISPLAY_OUTPUT_CLOSED_EVENT);
      }
    }
  );
  mainWindow.on('closed', () => {
    displays.dispose();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  void recordingService?.stopAll();
  batchDownloaderService?.cancel();
  updaterService?.cancelStartupCheck();
  displayManager?.dispose();
  void ramProxy?.stop();
  dbService?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };