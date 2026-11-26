import { create } from 'zustand';
import type { LantifySnapshot, LantifySongRequest, LantifyStatus } from '../../shared/types';
import { DEFAULT_LANTIFY_PREFS_RENDERER } from './lantifyDefaults';

interface LantifyStore {
  status: LantifyStatus;
  requests: LantifySongRequest[];
  /** Short line shown on the Pedidos tab after an action ("Mesa 7: ya sonó hace poco"). */
  note: string | null;
  setSnapshot: (snapshot: LantifySnapshot) => void;
  setStatus: (status: LantifyStatus) => void;
  setNote: (note: string | null) => void;
}

export const useLantifyStore = create<LantifyStore>((set) => ({
  status: {
    paired: false,
    business: null,
    connection: 'unpaired',
    lastError: null,
    pollDelayMs: 5000,
    prefs: { ...DEFAULT_LANTIFY_PREFS_RENDERER }
  },
  requests: [],
  note: null,
  setSnapshot: (snapshot) => set({ status: snapshot.status, requests: snapshot.requests }),
  setStatus: (status) => set({ status }),
  setNote: (note) => set({ note })
}));

/** Requests that still wait for the DJ (the tab counter). */
export function pendingRequestCount(requests: LantifySongRequest[]): number {
  return requests.filter((r) => r.state === 'pending' || r.state === 'searching').length;
}
