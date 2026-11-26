/** Shared fakes for the song-request tests (no Electron, no network). */
import type { YouTubeTrack } from '../../../src/shared/types';
import { SongRequestsService } from '../../../src/main/services/SongRequestsService';
import { GuestGateway } from '../../../src/main/services/GuestGateway';
import type { HostSocket, MusicHttp } from '../../../src/main/services/CloudMusicConnector';

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

/** Fake Lantify Cloud HTTP: records calls and answers from a handler. */
export function fakeCloud(handler: (call: CloudCall) => { status: number; body?: unknown } | Error) {
  const calls: CloudCall[] = [];
  const http: MusicHttp = async (url, init) => {
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

/** In-memory WebSocket standing in for the relay's Durable Object side. */
export class FakeSocket implements HostSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  /** Relay side helpers */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  last(t: string): Record<string, unknown> | undefined {
    return [...this.sent].reverse().find((f) => f.t === t);
  }
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
  const search = opts.search ?? (async () => [track('aaa', 'KAROL G - BICHOTA (Official Video)')]);
  const hub = new SongRequestsService({
    settings,
    search,
    getTasteSnapshot: () => opts.taste ?? emptyTaste,
    now: opts.now,
    setTimer: () => 0,
    clearTimer: () => undefined
  });
  const gateway = new GuestGateway({ hub, search, getTasteSnapshot: () => opts.taste ?? emptyTaste, now: opts.now });
  return { hub, gateway, settings };
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
