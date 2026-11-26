/**
 * Wires the song-request hub to its two transports and keeps exactly one active:
 * "cloud" talks to the Lantify Música relay (any network, with or without Lantify POS),
 * "local" serves the page on the venue WiFi, "off" closes both. Snapshots for the
 * renderer are coalesced so a burst of changes sends one IPC message.
 */
import type { SongRequestMode, SongRequestsSnapshot, YouTubeTrack } from '../../shared/types';
import { CloudMusicConnector, type HostSocket, type MusicHttp } from './CloudMusicConnector';
import { GuestGateway } from './GuestGateway';
import { LocalRequestServer } from './LocalRequestServer';
import { SongRequestsService, type SettingsStore } from './SongRequestsService';
import type { TasteSnapshot } from './TasteFeedbackService';

export interface SongRequestsModuleDeps {
  settings: SettingsStore;
  http: MusicHttp;
  openSocket: (url: string) => HostSocket;
  appVersion?: string;
  search: (query: string) => Promise<YouTubeTrack[]>;
  getTasteSnapshot: () => Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>;
  onSnapshot: (snapshot: SongRequestsSnapshot) => void;
}

export interface SongRequestsModule {
  hub: SongRequestsService;
  cloud: CloudMusicConnector;
  local: LocalRequestServer;
  snapshot: () => SongRequestsSnapshot;
  setMode: (mode: SongRequestMode) => Promise<SongRequestsSnapshot>;
  /** Printable QR sheet for the active mode. */
  buildTableSheet: (tables: number) => Promise<string>;
  start: () => void;
  stop: () => Promise<void>;
}

export function createSongRequestsModule(deps: SongRequestsModuleDeps): SongRequestsModule {
  let scheduled = false;
  const emit = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      deps.onSnapshot(snapshot());
    }, 0);
  };

  const hub = new SongRequestsService({
    settings: deps.settings,
    search: deps.search,
    getTasteSnapshot: deps.getTasteSnapshot,
    onChange: emit
  });
  const gateway = new GuestGateway({ hub, search: deps.search, getTasteSnapshot: deps.getTasteSnapshot });
  const cloud = new CloudMusicConnector({
    hub,
    gateway,
    settings: deps.settings,
    http: deps.http,
    openSocket: deps.openSocket,
    appVersion: deps.appVersion,
    onChange: emit
  });
  const local = new LocalRequestServer({ hub, gateway, settings: deps.settings, onChange: emit });

  const snapshot = (): SongRequestsSnapshot => ({
    mode: hub.getMode(),
    prefs: hub.getPrefs(),
    page: hub.getPageSettings(),
    cloud: cloud.getStatus(),
    local: local.getStatus(),
    requests: hub.getRequests(),
    chat: cloud.getChat(),
    desk: { ...hub.getDesk(), posLinked: cloud.posLinked() }
  });

  let applying: Promise<void> = Promise.resolve();
  const applyMode = (mode: SongRequestMode): Promise<void> => {
    applying = applying.then(async () => {
      cloud.setActive(mode === 'cloud');
      if (mode === 'local') await local.start();
      else await local.stop();
    });
    return applying;
  };
  hub.onModeChange((mode) => void applyMode(mode));

  return {
    hub,
    cloud,
    local,
    snapshot,
    setMode: async (mode) => {
      hub.setMode(mode);
      await applyMode(mode);
      return snapshot();
    },
    buildTableSheet: (tables) =>
      hub.getMode() === 'local' ? local.buildTableSheet(tables) : cloud.buildTableSheet(tables),
    start: () => {
      void applyMode(hub.getMode());
    },
    stop: async () => {
      cloud.dispose();
      hub.dispose();
      await local.stop();
    }
  };
}
