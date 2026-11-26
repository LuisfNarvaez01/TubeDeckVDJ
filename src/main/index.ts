import { app, BrowserWindow, net, session } from 'electron';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { AutoUpdaterService } from './services/AutoUpdaterService';
import { BatchDownloadService } from './services/BatchDownloadService';
import { MediaCache } from './services/MediaCache';
import { DjSuggestionService } from './services/DjSuggestionService';
import { createFetchProbe, NetworkMonitor } from './services/NetworkMonitor';
import { DatabaseService } from './services/DatabaseService';
import { DisplayWindowManager } from './services/DisplayWindowManager';
import { HistoryAndCratesService } from './services/HistoryAndCratesService';
import { LocalLibraryService } from './services/LocalLibraryService';
import { createSongRequestsModule, type SongRequestsModule } from './services/songRequestsModule';
import { LantifyAccountService } from './services/LantifyAccountService';
import type { HostSocket } from './services/CloudMusicConnector';
import { MixRecordingService } from './services/MixRecordingService';
import { RecommendationEngine } from './services/RecommendationEngine';
import { TasteFeedbackService } from './services/TasteFeedbackService';
import { RamStreamProxy } from './services/RamStreamProxy';
import { SessionExporter } from './services/SessionExporter';
import {
  createDefaultYtDlpRunner,
  StreamResolverService
} from './services/StreamResolverService';
import { YouTubeAccessMonitor } from './services/YouTubeAccessMonitor';
import { YouTubeAuthService } from './services/YouTubeAuthService';
import { YouTubeSearchService } from './services/YouTubeSearchService';
import { YtDlpBinaryManager } from './services/YtDlpBinaryManager';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const LEGACY_DATA_FOLDER = 'TubeDeck VDJ';
/** Isolated cookie jar for the optional YouTube sign-in window. */
const YOUTUBE_SIGNIN_PARTITION = 'persist:youtube-signin';

/** Lets the DJ sign in to YouTube in an isolated window; resolves when it is closed. */
function openYouTubeSignIn(parent: BrowserWindow | null): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      modal: false,
      title: 'Conectar YouTube — Proyecta',
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      webPreferences: {
        partition: YOUTUBE_SIGNIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      void win.loadURL(url);
      return { action: 'deny' };
    });
    // Once signed in and back on YouTube, close by itself.
    win.webContents.on('did-navigate', (_e, url) => {
      void session
        .fromPartition(YOUTUBE_SIGNIN_PARTITION)
        .cookies.get({ domain: 'youtube.com', name: 'LOGIN_INFO' })
        .then((c) => {
          if (c.length > 0 && /^https:\/\/(www|m)\.youtube\.com\//.test(url) && !win.isDestroyed()) {
            setTimeout(() => !win.isDestroyed() && win.close(), 1200);
          }
        });
    });
    win.on('closed', () => resolve());
    void win.loadURL(
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'
    );
  });
}

let mainWindow: BrowserWindow | null = null;
let dbService: DatabaseService | null = null;
let ramProxy: RamStreamProxy | null = null;
let displayManager: DisplayWindowManager | null = null;
let updaterService: AutoUpdaterService | null = null;
let batchDownloaderService: BatchDownloadService | null = null;
let recordingService: MixRecordingService | null = null;
let songRequestsModule: SongRequestsModule | null = null;
let accountService: LantifyAccountService | null = null;

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
    // Dark custom title bar: the app header is the drag area and Windows draws its own
    // minimize/maximize/close buttons (with Snap Layouts) in the app's colors.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#c9c9cf', height: 48 },
    webPreferences: {
      preload: path.join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Keep the mix engine (crossfades, Automix) running at full pace when minimized.
      backgroundThrottling: false
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
  const ytAuth = new YouTubeAuthService(
    path.join(userDataDir, 'youtube-cookies.txt'),
    () => session.fromPartition(YOUTUBE_SIGNIN_PARTITION).cookies
  );
  const ytRunner = createDefaultYtDlpRunner(ytDlp, {
    getCookieFile: () => ytAuth.getCookieFilePath(),
    nodeRuntimePath: process.execPath
  });
  const ytAccess = new YouTubeAccessMonitor(ytRunner, () => ytAuth.isConnected(), (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.YT_ACCESS_EVENT, status);
    }
  });
  const network = new NetworkMonitor(
    createFetchProbe((url, init) => net.fetch(url, init)),
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.NET_EVENT, status);
      }
    }
  );
  const resolver = new StreamResolverService(ytRunner);
  const cacheSettings = db.getSetting<{ maxGb: number; saveVideo: boolean }>('mediaCache', {
    maxGb: 5,
    saveVideo: true
  });
  const mediaCache = new MediaCache(path.join(userDataDir, 'media-cache'), {
    maxBytes: cacheSettings.maxGb * 1024 ** 3,
    // Node's fetch, like the stream proxy: Electron's net.fetch rejected these media downloads.
    saveVideo: cacheSettings.saveVideo
  });
  mediaCache.onChange(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.MEDIA_CACHE_EVENT);
    }
  });
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
  const songRequests = createSongRequestsModule({
    // Node's fetch from the main process: the renderer's CSP stays closed to the internet.
    http: async (url, init) => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, json: () => res.json() };
    },
    // Outgoing WebSocket to the Lantify Música relay (Node's built-in client): no open ports.
    openSocket: (url) => new WebSocket(url) as unknown as HostSocket,
    appVersion: app.getVersion(),
    settings: db,
    search: async (query) => (await search.search(query)).items,
    getTasteSnapshot: () => taste.getSnapshot(),
    onSnapshot: (snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.REQUESTS_EVENT, snapshot);
      }
    }
  });
  songRequestsModule = songRequests;
  // Lantify account: Proyecta opens with it (or by itself when Lantify POS runs on this computer).
  const account = new LantifyAccountService({
    settings: db,
    deviceName: os.hostname(),
    http: async (url, init) => {
      const res = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: AbortSignal.timeout(init.timeoutMs ?? 15_000)
      });
      return { status: res.status, json: () => res.json() };
    },
    onChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ACCOUNT_EVENT, status);
      }
    }
  });
  accountService = account;
  const exporter = new SessionExporter();
  const localLibrary = new LocalLibraryService(db);
  const recordings = new MixRecordingService(path.join(app.getPath('music'), 'Proyecta Grabaciones'));
  recordingService = recordings;
  const batchDownloader = new BatchDownloadService({
    binaryManager: ytDlp,
    runnerOptions: {
      getCookieFile: () => ytAuth.getCookieFilePath(),
      nodeRuntimePath: process.execPath
    },
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
    songRequests,
    account,
    recordings,
    network,
    mediaCache,
    djSuggestions: new DjSuggestionService(db, () => taste.getSnapshot()),
    sessionDownloadsDir: path.join(app.getPath('music'), 'Proyecta', 'Sesiones descargadas'),
    youtubeAccess: {
      monitor: ytAccess,
      connect: async () => {
        await openYouTubeSignIn(mainWindow);
        const connected = await ytAuth.syncCookies();
        resolver.clearCache();
        if (connected) await ytAccess.check();
        return ytAccess.getStatus();
      },
      disconnect: async () => {
        await session.fromPartition(YOUTUBE_SIGNIN_PARTITION).clearStorageData();
        ytAuth.disconnectFile();
        resolver.clearCache();
        return ytAccess.getStatus();
      }
    }
  });

  mainWindow = createMainWindow();
  updater.scheduleStartupCheck(8000);
  network.start();
  songRequests.start();
  void account.start();
  // Re-export cookies (Google rotates them) and find out early if YouTube is blocking us.
  setTimeout(() => {
    void ytAuth
      .syncCookies()
      .catch(() => false)
      .then(() => ytAccess.check());
  }, 4000);
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
  void songRequestsModule?.stop();
  accountService?.dispose();
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