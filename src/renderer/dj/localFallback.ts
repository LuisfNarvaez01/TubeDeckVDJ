import type { YouTubeTrack } from '../../shared/types';

/** Words that say nothing about the music itself (upload decorations, filler). */
const NOISE = new Set([
  'official', 'oficial', 'video', 'videoclip', 'clip', 'audio', 'lyrics', 'lyric', 'letra', 'hd', 'hq',
  '4k', 'remastered', 'remaster', 'version', 'en', 'vivo', 'live', 'ft', 'feat', 'featuring', 'the',
  'el', 'la', 'los', 'las', 'de', 'del', 'y', 'and', 'a', 'mi', 'tu', 'me', 'te', 'un', 'una', 'con',
  'por', 'para', 'que', 'mp3', 'mp4', 'topic', 'vevo', 'music', 'musica', 'records', 'channel'
]);

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function musicTokens(text: string): string[] {
  return fold(text)
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
}

/** Best guess of the artist: "Artist - Song" titles first, then the uploader minus "- Topic"/"VEVO". */
export function artistKey(track: Pick<YouTubeTrack, 'title' | 'channel'>): string {
  const dash = track.title.split(/\s[-–—]\s/);
  const fromTitle = dash.length > 1 ? dash[0] : '';
  const raw = fromTitle || track.channel || '';
  return musicTokens(raw.replace(/\b(vevo|- topic)\b/gi, '')).join(' ');
}

/** How alike two songs look from their text: same artist counts most, then shared words. */
export function similarityScore(
  seed: Pick<YouTubeTrack, 'title' | 'channel'>,
  candidate: Pick<YouTubeTrack, 'title' | 'channel'>
): number {
  let score = 0;
  const a = artistKey(seed);
  const b = artistKey(candidate);
  if (a && b && (a === b || a.includes(b) || b.includes(a))) score += 3;
  const seedWords = new Set(musicTokens(`${seed.title} ${seed.channel ?? ''}`));
  for (const w of new Set(musicTokens(`${candidate.title} ${candidate.channel ?? ''}`))) {
    if (seedWords.has(w)) score += 1;
  }
  return score;
}

/**
 * Picks the backup song: the most similar candidate that is not excluded, chosen at random
 * among the top few for variety; with no similar song at all, any eligible one.
 */
export function pickSimilarTrack(
  seed: Pick<YouTubeTrack, 'title' | 'channel'> | null,
  candidates: YouTubeTrack[],
  isExcluded: (t: YouTubeTrack) => boolean,
  random: () => number = Math.random
): YouTubeTrack | null {
  const eligible = candidates.filter((t) => !isExcluded(t));
  if (eligible.length === 0) return null;
  if (!seed) return eligible[Math.floor(random() * eligible.length)] ?? null;
  const scored = eligible
    .map((t) => ({ t, s: similarityScore(seed, t) }))
    .sort((x, y) => y.s - x.s);
  const best = scored[0].s;
  const pool = best > 0 ? scored.filter((x) => x.s >= Math.max(1, best - 1)).slice(0, 3) : scored;
  return pool[Math.floor(random() * pool.length)]?.t ?? null;
}
