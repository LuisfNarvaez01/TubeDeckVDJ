/**
 * Musical key detection (chroma + Krumhansl–Schmuckler profiles) and Camelot-wheel
 * harmonic mixing helpers. Runs live from a deck's FFT while the track plays, so it
 * needs no file access: after ~20 s of audio the estimate is stable enough to show.
 */

export type KeyMode = 'major' | 'minor';

export interface MusicalKey {
  /** Pitch class of the tonic, 0 = C … 11 = B. */
  tonic: number;
  mode: KeyMode;
}

export interface KeyEstimate extends MusicalKey {
  camelot: string;
  name: string;
  /** Correlation margin between the best and second-best key, 0..1. */
  confidence: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Krumhansl–Kessler probe-tone profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot number for each tonic. Major = "B", minor = "A".
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function mod12(n: number): number {
  return ((Math.round(n) % 12) + 12) % 12;
}

export function keyName(key: MusicalKey): string {
  return `${NOTE_NAMES[mod12(key.tonic)]}${key.mode === 'minor' ? 'm' : ''}`;
}

export function toCamelot(key: MusicalKey): string {
  const t = mod12(key.tonic);
  return key.mode === 'major' ? `${CAMELOT_MAJOR[t]}B` : `${CAMELOT_MINOR[t]}A`;
}

export function fromCamelot(code: string): MusicalKey | null {
  const m = /^(\d{1,2})([AB])$/i.exec(code.trim());
  if (!m) return null;
  const num = Number(m[1]);
  if (num < 1 || num > 12) return null;
  const major = m[2].toUpperCase() === 'B';
  const table = major ? CAMELOT_MAJOR : CAMELOT_MINOR;
  return { tonic: table.indexOf(num), mode: major ? 'major' : 'minor' };
}

/** Key after the deck's key-shift (semitones) is applied. */
export function shiftCamelot(code: string, semitones: number): string {
  const key = fromCamelot(code);
  if (!key || !semitones) return code;
  return toCamelot({ tonic: key.tonic + semitones, mode: key.mode });
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function estimateKeyFromChroma(chroma: number[]): KeyEstimate | null {
  if (chroma.length !== 12 || chroma.every((v) => v <= 0)) return null;
  const scores: { key: MusicalKey; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    scores.push({ key: { tonic, mode: 'major' }, r: pearson(rotated, MAJOR_PROFILE) });
    scores.push({ key: { tonic, mode: 'minor' }, r: pearson(rotated, MINOR_PROFILE) });
  }
  scores.sort((x, y) => y.r - x.r);
  const best = scores[0];
  return {
    ...best.key,
    camelot: toCamelot(best.key),
    name: keyName(best.key),
    confidence: Math.max(0, Math.min(1, (best.r - scores[1].r) * 4))
  };
}

/** Accumulates a chromagram from successive FFT magnitude frames (dB, as AnalyserNode gives). */
export class ChromaAccumulator {
  private readonly chroma = new Array<number>(12).fill(0);
  private binToPitch: Int8Array | null = null;
  private binCount = 0;
  frames = 0;

  private prepare(binCount: number, sampleRate: number): void {
    if (this.binToPitch && this.binCount === binCount) return;
    this.binCount = binCount;
    this.binToPitch = new Int8Array(binCount).fill(-1);
    const hzPerBin = sampleRate / (binCount * 2);
    for (let i = 1; i < binCount; i += 1) {
      const hz = i * hzPerBin;
      if (hz < 80 || hz > 5000) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      this.binToPitch[i] = mod12(midi);
    }
  }

  addFrame(magnitudesDb: Float32Array, sampleRate: number): void {
    this.prepare(magnitudesDb.length, sampleRate);
    const map = this.binToPitch as Int8Array;
    let energy = 0;
    const frame = new Array<number>(12).fill(0);
    for (let i = 0; i < magnitudesDb.length; i += 1) {
      const pc = map[i];
      if (pc < 0) continue;
      const db = magnitudesDb[i];
      if (!Number.isFinite(db) || db < -90) continue;
      const amp = 10 ** (db / 20);
      frame[pc] += amp;
      energy += amp;
    }
    if (energy <= 0) return; // silence
    for (let pc = 0; pc < 12; pc += 1) this.chroma[pc] += frame[pc] / energy;
    this.frames += 1;
  }

  estimate(): KeyEstimate | null {
    return this.frames > 0 ? estimateKeyFromChroma(this.chroma) : null;
  }

  reset(): void {
    this.chroma.fill(0);
    this.frames = 0;
  }
}

export { harmonicMatch, HARMONIC_LABEL, type HarmonicMatch } from '../../shared/camelot';
