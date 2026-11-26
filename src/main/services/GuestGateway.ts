/**
 * What a guest's phone can do, independent of how it reaches Proyecta (the Lantify Música
 * relay or the local WiFi server): search YouTube (done here, on the DJ's PC), ask for a
 * song (a picked video or free text), and follow its own requests. Answers are
 * `{ status, body }` pairs so both transports return the same HTTP status and JSON.
 */
import crypto from 'crypto';
import { z } from 'zod';
import type { GuestTrack, SongRequestOrigin, YouTubeTrack } from '../../shared/types';
import { passesSongFilter } from './RecommendationEngine';
import type { SongRequestsService } from './SongRequestsService';
import type { TasteSnapshot } from './TasteFeedbackService';

/** One request per phone every 30 s, at most 3 open at once, at most 60 open overall. */
export const CLIENT_COOLDOWN_MS = 30_000;
export const MAX_OPEN_PER_CLIENT = 3;
const MAX_OPEN_TOTAL = 60;
const MAX_RESULTS = 12;
/** A picked video must come from a search Proyecta answered this recently. */
const SERVED_TTL_MS = 15 * 60 * 1000;
const MAX_SERVED = 600;

export interface GuestReply {
  status: number;
  body: Record<string, unknown>;
}

const RequestBodySchema = z
  .object({
    client: z.string().trim().min(8).max(64).optional(),
    table: z.string().trim().max(40).optional().default(''),
    guest: z.string().trim().max(60).optional().default(''),
    videoId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .optional(),
    query: z.string().trim().max(120).optional().default('')
  })
  .refine((b) => Boolean(b.videoId) || b.query.length >= 2, { message: 'Escribe el nombre de la canción' });

export interface GuestGatewayDeps {
  hub: SongRequestsService;
  search: (query: string) => Promise<YouTubeTrack[]>;
  getTasteSnapshot: () => Pick<TasteSnapshot, 'dislikedVideoIds' | 'blockedNames'>;
  now?: () => number;
}

export function toGuestTrack(t: YouTubeTrack): GuestTrack {
  return {
    videoId: t.videoId,
    title: t.title,
    channel: t.channel,
    durationSec: t.durationSec,
    thumbnailUrl: t.thumbnailUrl
  };
}

export class GuestGateway {
  private readonly now: () => number;
  private readonly served = new Map<string, { track: YouTubeTrack; at: number }>();
  private readonly clients = new Map<string, { lastAtMs: number; ids: string[] }>();

  constructor(private readonly deps: GuestGatewayDeps) {
    this.now = deps.now ?? Date.now;
  }

  info(): Record<string, unknown> {
    const np = this.deps.hub.getNowPlaying();
    const page = this.deps.hub.getPageSettings();
    return {
      venueName: page.venueName,
      accepting: this.deps.hub.getMode() !== 'off',
      nowPlaying: np ? { title: np.title, artist: np.artist } : null
    };
  }

  /** YouTube search for the phone page: only songs that pass the radio's filters. */
  async search(rawQuery: unknown): Promise<GuestReply> {
    const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 120) : '';
    if (q.length < 2) return { status: 200, body: { items: [] } };
    if (this.deps.hub.getMode() === 'off') return { status: 503, body: { error: 'Los pedidos están cerrados en este momento.' } };
    let results: YouTubeTrack[];
    try {
      results = await this.deps.search(q);
    } catch {
      return { status: 503, body: { error: 'No pudimos buscar en este momento. Intenta de nuevo.' } };
    }
    const taste = this.deps.getTasteSnapshot();
    const items: GuestTrack[] = [];
    const seen = new Set<string>();
    for (const t of results) {
      if (seen.has(t.videoId) || t.source === 'local' || !passesSongFilter(t, taste)) continue;
      seen.add(t.videoId);
      items.push(toGuestTrack(t));
      this.remember(t);
      if (items.length >= MAX_RESULTS) break;
    }
    return { status: 200, body: { items } };
  }

  /** A guest asks for a song. `clientKey` identifies the phone (hash of IP + page id). */
  async request(origin: SongRequestOrigin, rawBody: unknown, clientKey: string): Promise<GuestReply> {
    const hub = this.deps.hub;
    if (hub.getMode() !== origin) return { status: 503, body: { error: 'Los pedidos están cerrados en este momento.' } };
    const parsed = RequestBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return { status: 400, body: { error: parsed.error.issues[0]?.message ?? 'Datos no válidos' } };
    }
    const body = parsed.data;
    const now = this.now();
    const client = this.clients.get(clientKey) ?? { lastAtMs: -Infinity, ids: [] };
    client.ids = client.ids.filter((id) => {
      const r = hub.find(origin, id);
      return r !== null && r.state !== 'played' && r.state !== 'rejected';
    });
    if (now - client.lastAtMs < CLIENT_COOLDOWN_MS) {
      const wait = Math.ceil((CLIENT_COOLDOWN_MS - (now - client.lastAtMs)) / 1000);
      return { status: 429, body: { error: `Espera ${wait} s antes de pedir otra canción.` } };
    }
    if (client.ids.length >= MAX_OPEN_PER_CLIENT) {
      return { status: 429, body: { error: 'Ya tienes 3 canciones pedidas. Espera a que suenen.' } };
    }
    if (hub.openCount(origin) >= MAX_OPEN_TOTAL) {
      return { status: 429, body: { error: 'Hay muchos pedidos en espera. Intenta en unos minutos.' } };
    }

    const picked = body.videoId ? this.pickedTrack(body.videoId) : null;
    const query = body.query || picked?.title || '';
    if (!picked && query.length < 2) {
      return { status: 400, body: { error: 'Esa canción ya no está disponible. Búscala otra vez.' } };
    }
    const externalId = crypto.randomBytes(16).toString('hex');
    client.lastAtMs = now;
    client.ids.push(externalId);
    this.clients.set(clientKey, client);
    // ingest() adds the request synchronously; a free-text search keeps going in the background
    void hub.ingest(origin, [
      {
        externalId,
        table: body.table,
        guest: body.guest,
        query,
        createdAt: new Date(now).toISOString(),
        track: picked ?? undefined
      }
    ]);
    return { status: 201, body: { ...(hub.view(origin, externalId) ?? { id: externalId, state: 'searching', query }) } };
  }

  status(origin: SongRequestOrigin, externalId: string): GuestReply {
    const view = this.deps.hub.view(origin, externalId);
    return view ? { status: 200, body: { ...view } } : { status: 404, body: { error: 'Pedido no encontrado' } };
  }

  private remember(t: YouTubeTrack): void {
    this.served.set(t.videoId, { track: t, at: this.now() });
    if (this.served.size > MAX_SERVED) {
      const oldest = this.served.keys().next().value;
      if (oldest) this.served.delete(oldest);
    }
  }

  /** Only videos this PC returned in a recent search can be picked (no forged ids). */
  private pickedTrack(videoId: string): YouTubeTrack | null {
    const hit = this.served.get(videoId);
    if (!hit || this.now() - hit.at > SERVED_TTL_MS) return null;
    return hit.track;
  }
}

/** Stable, non-reversible key for a phone: its address plus the id its page keeps. */
export function clientKeyOf(address: string, client: unknown): string {
  const id = typeof client === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(client) ? client : '';
  return crypto.createHash('sha256').update(`${address}|${id}`).digest('hex');
}
