import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { DatabaseService } from './services/DatabaseService';
import { RamStreamProxy } from './services/RamStreamProxy';
import {
  createDefaultYtDlpRunner,
  StreamResolverService
} from './services/StreamResolverService';
import { YouTubeSearchService } from './services/YouTubeSearchService';
import { YtDlpBinaryManager } from './services/YtDlpBinaryManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let dbService: DatabaseService | null = null;
let ramProxy: RamStreamProxy | null = null;

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
    title: 'TubeDeck VDJ',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
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
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(async () => {
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

  const search = new YouTubeSearchService();
  registerIpcHandlers({ db, search, ytDlp, resolver, proxy });

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  void ramProxy?.stop();
  dbService?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
