import { describe, expect, it } from 'vitest';
import {
  ChromaAccumulator,
  estimateKeyFromChroma,
  fromCamelot,
  harmonicMatch,
  shiftCamelot,
  toCamelot
} from '../../../src/renderer/dj/HarmonicKey';
import {
  beatPhase,
  estimateBeatAnchor,
  phaseCorrectionSec,
  phaseOffsetBeats,
  type OnsetSample
} from '../../../src/renderer/dj/BeatPhase';

function triadChroma(notes: number[]): number[] {
  const c = new Array<number>(12).fill(0.05);
  notes.forEach((n, i) => (c[n % 12] += i === 0 ? 1.2 : 0.8));
  return c;
}

describe('key detection', () => {
  it('maps keys to the Camelot wheel', () => {
    expect(toCamelot({ tonic: 0, mode: 'major' })).toBe('8B');
    expect(toCamelot({ tonic: 9, mode: 'minor' })).toBe('8A');
    expect(toCamelot({ tonic: 7, mode: 'major' })).toBe('9B');
    expect(fromCamelot('11A')).toEqual({ tonic: 6, mode: 'minor' });
  });

  it('recognises C major and A minor from their chords', () => {
    expect(estimateKeyFromChroma(triadChroma([0, 4, 7, 5, 9, 2]))?.camelot).toBe('8B');
    expect(estimateKeyFromChroma(triadChroma([9, 0, 4, 2, 5]))?.name).toBe('Am');
  });

  it('accumulates FFT frames into a key', () => {
    const sampleRate = 48000;
    const bins = 8192;
    const hzPerBin = sampleRate / (bins * 2);
    const frame = new Float32Array(bins).fill(-120);
    // G major chord: G3 B3 D4 + G4
    for (const hz of [196, 246.94, 293.66, 392]) frame[Math.round(hz / hzPerBin)] = -10;
    const acc = new ChromaAccumulator();
    for (let i = 0; i < 5; i += 1) acc.addFrame(frame, sampleRate);
    expect(acc.estimate()?.camelot).toBe('9B');
  });

  it('applies key shift and Camelot mixing rules', () => {
    expect(shiftCamelot('8B', 2)).toBe('10B');
    expect(harmonicMatch('8A', '8A')).toBe('same');
    expect(harmonicMatch('8A', '9A')).toBe('compatible');
    expect(harmonicMatch('12A', '1A')).toBe('compatible');
    expect(harmonicMatch('8A', '8B')).toBe('compatible');
    expect(harmonicMatch('8A', '10A')).toBe('energy');
    expect(harmonicMatch('8A', '3B')).toBe('clash');
  });
});

describe('beat phase', () => {
  it('finds where the kicks land', () => {
    const bpm = 120; // 0.5 s period, kicks at 0.1 s into each beat
    const samples: OnsetSample[] = [];
    for (let t = 0; t < 12; t += 0.04) {
      const inBeat = t % 0.5;
      samples.push({ trackTimeSec: t, lowEnergy: Math.abs(inBeat - 0.1) < 0.03 ? 1 : 0.1 });
    }
    const anchor = estimateBeatAnchor(samples, bpm) as number;
    expect(anchor).toBeGreaterThan(0.06);
    expect(anchor).toBeLessThan(0.14);
    expect(beatPhase(10.1, bpm, anchor)).toBeLessThan(0.1);
  });

  it('measures and corrects phase offsets', () => {
    expect(phaseOffsetBeats(0.1, 0.35)).toBeCloseTo(0.25);
    expect(phaseOffsetBeats(0.9, 0.05)).toBeCloseTo(0.15);
    expect(phaseCorrectionSec(0.25, 120)).toBeCloseTo(-0.125);
  });
});
