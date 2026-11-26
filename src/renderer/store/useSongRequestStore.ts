import { create } from 'zustand';
import type { SongRequest, SongRequestsSnapshot } from '../../shared/types';

interface SongRequestStore {
  snapshot: SongRequestsSnapshot;
  /** Short line shown on the Pedidos tab after an action ("Mesa 7: ya sonó hace poco"). */
  note: string | null;
  setSnapshot: (snapshot: SongRequestsSnapshot) => void;
  setNote: (note: string | null) => void;
}

/** Shown until the main process sends the real state (same defaults as the main process). */
const INITIAL: SongRequestsSnapshot = {
  mode: 'off',
  prefs: { autoApprove: false, maxPerHour: 12, maxPerTable: 3, overlayEnabled: true, autoPlay: true },
  page: { venueName: '', wifiName: '', qrOnScreen: true, logoDataUrl: '' },
  cloud: {
    registered: false,
    venueId: null,
    business: null,
    connection: 'unregistered',
    url: null,
    qrSvgDataUrl: null,
    qrPngDataUrl: null,
    error: null
  },
  local: {
    running: false,
    url: null,
    addresses: [],
    port: null,
    qrSvgDataUrl: null,
    qrPngDataUrl: null,
    error: null,
    settings: { address: '' }
  },
  requests: [],
  chat: [],
  desk: {
    djPresent: true,
    autopilot: { enabled: false, maxPerHour: 12, maxPerTable: 3, skipOnLoadError: true },
    posLinked: false
  }
};

export const useSongRequestStore = create<SongRequestStore>((set) => ({
  snapshot: INITIAL,
  note: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setNote: (note) => set({ note })
}));

/** Requests that still wait for the DJ (the tab counter). */
export function pendingRequestCount(requests: SongRequest[]): number {
  return requests.filter((r) => r.state === 'pending' || r.state === 'searching').length;
}

/** "Mesa 7", a free label as given ("Terraza 2"), or "Sin mesa". */
/** QR and page address of the active mode (null when off or not ready). */
export function activeQr(s: SongRequestsSnapshot): { url: string; svg: string | null; png: string | null } | null {
  if (s.mode === 'cloud' && s.cloud.url) return { url: s.cloud.url, svg: s.cloud.qrSvgDataUrl, png: s.cloud.qrPngDataUrl };
  if (s.mode === 'local' && s.local.url) return { url: s.local.url, svg: s.local.qrSvgDataUrl, png: s.local.qrPngDataUrl };
  return null;
}

export function tableLabel(table: string): string {
  if (!table) return 'Sin mesa';
  return /^\d+$/.test(table) ? `Mesa ${table}` : table;
}
