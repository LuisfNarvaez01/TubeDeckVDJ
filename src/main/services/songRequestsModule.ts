/**
 * Wires the song-request hub to its two sources and keeps exactly one active:
 * "lantify" polls Lantify Cloud (table QR of Lantify POS), "local" opens Proyecta's own
 * QR server on the venue network, "off" closes both. Snapshots for the renderer are
 * coalesced so a burst of changes sends one IPC message.
 */
import type { SongRequestMode, SongRequestsSnapshot, YouTubeTrack } from '../../shared/types';
import { LantifyRequestsService, type LantifyHttp } from './LantifyRequestsService';
import { LocalRequestServer } from './LocalRequestServer';
import { SongRequestsService, type SettingsStore } from './SongRequestsService';
import type { TasteSnapshot } from './TasteFeedbackService';

export interface SongRequestsModuleDeps {
  settings: SettingsStore;
  http: LantifyHttp;
  search: (query: string) => Promise<YouTubeTrack[]>;
  getTasteSnapshot: () => Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>;
  onSnapshot: (snapshot: SongRequestsSnapshot) => void;
}

export interface SongRequestsModule {
  hub: SongRequestsService;
  lantify: LantifyRequestsService;
  local: LocalRequestServer;
  snapshot: () => SongRequestsSnapshot;
  setMode: (mode: SongRequestMode) => Promise<SongRequestsSnapshot>;
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
  const lantify = new LantifyRequestsService({ http: deps.http, settings: deps.settings, hub, onChange: emit });
  const local = new LocalRequestServer({ hub, settings: deps.settings, onChange: emit });

  const snapshot = (): SongRequestsSnapshot => ({
    mode: hub.getMode(),
    prefs: hub.getPrefs(),
    lantify: lantify.getStatus(),
    local: local.getStatus(),
    requests: hub.getRequests()
  });

  let applying: Promise<void> = Promise.resolve();
  const applyMode = (mode: SongRequestMode): Promise<void> => {
    applying = applying.then(async () => {
      lantify.handleModeChange();
      if (mode === 'local') await local.start();
      else await local.stop();
    });
    return applying;
  };
  hub.onModeChange((mode) => void applyMode(mode));

  return {
    hub,
    lantify,
    local,
    snapshot,
    setMode: async (mode) => {
      hub.setMode(mode);
      await applyMode(mode);
      return snapshot();
    },
    start: () => {
      lantify.start();
      void applyMode(hub.getMode());
    },
    stop: async () => {
      lantify.stop();
      hub.dispose();
      await local.stop();
    }
  };
}
