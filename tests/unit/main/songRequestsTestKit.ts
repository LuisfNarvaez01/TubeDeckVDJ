/** Shared fakes for the song-request tests (no Electron, no network). */
import type { YouTubeTrack } from '../../../src/shared/types';
import { SongRequestsService } from '../../../src/main/services/SongRequestsService';
import type { LantifyHttp } from '../../../src/main/services/LantifyRequestsService';

export function track(id: string, title: string, durationSec = 210, extra: Partial<YouTubeTrack> = {}): YouTubeTrack {
  return {
    videoId: id.padEnd(11, 'x').slice(0, 11),
    title,
    channel: 'Karol G',
    durationSec,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isLive: false,
    ...extra
  };
}

export const emptyTaste = { dislikedVideoIds: new Set<string>(), blockedNames: new Set<string>() };

export class MemorySettings {
  data = new Map<string, unknown>();
  getSetting<T>(key: string, fallback: T): T {
    return this.data.has(key) ? (this.data.get(key) as T) : fallback;
  }
  setSetting<T>(key: string, value: T): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

export interface CloudCall {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake Lantify Cloud: records calls and answers from a handler. */
export function fakeCloud(handler: (call: CloudCall) => { status: number; body?: unknown } | Error) {
  const calls: CloudCall[] = [];
  const http: LantifyHttp = async (url, init) => {
    const call: CloudCall = {
      url,
      path: url.replace('https://api.lantifypos.com', ''),
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const out = handler(call);
    if (out instanceof Error) throw out;
    return { status: out.status, json: async () => out.body ?? {} };
  };
  return { http, calls };
}

export function makeHub(
  opts: {
    settings?: MemorySettings;
    search?: (q: string) => Promise<YouTubeTrack[]>;
    taste?: typeof emptyTaste;
    now?: () => number;
  } = {}
) {
  const settings = opts.settings ?? new MemorySettings();
  const hub = new SongRequestsService({
    settings,
    search: opts.search ?? (async () => [track('aaa', 'KAROL G - BICHOTA (Official Video)')]),
    getTasteSnapshot: () => opts.taste ?? emptyTaste,
    now: opts.now,
    setTimer: () => 0,
    clearTimer: () => undefined
  });
  return { hub, settings };
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
