import { describe, it, expect } from 'vitest';
import { BpmAndWaveformEngine } from '../../../src/renderer/dj/BpmAndWaveformEngine';

describe('BpmAndWaveformEngine', () => {
  it('detects BPM via Tap BPM, energy autocorrelation, Sync rate, and Waveform peaks', () => {
    const engine = new BpmAndWaveformEngine();

    // 4 taps at 500ms intervals -> 120 BPM
    expect(engine.recordTap(0)).toBeNull();
    expect(engine.recordTap(500)).toBe(120);
    expect(engine.recordTap(1000)).toBe(120);
    expect(engine.recordTap(1500)).toBe(120);

    expect(engine.adjustHalfDouble(120, 0.5)).toBe(60);
    expect(engine.adjustHalfDouble(60, 2)).toBe(120);

    // Autocorrelation on 50Hz energy samples (0.02s/sample) with peak every 25 samples (0.5s = 120 BPM)
    const energy: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      energy.push(i % 25 === 0 ? 1.0 : 0.1);
    }
    const detected = engine.detectBpmFromEnergyHistory(energy, 0.02);
    expect(detected).not.toBeNull();
    expect(detected!).toBeGreaterThanOrEqual(118);
    expect(detected!).toBeLessThanOrEqual(122);

    // Sync rate clamping
    expect(engine.computeSyncPlaybackRate(100, 125)).toBeCloseTo(1.25, 3);
    expect(engine.computeSyncPlaybackRate(50, 200)).toBe(1.5);

    // Waveform peaks
    const pcm = new Float32Array(1000);
    pcm[10] = 0.8;
    pcm[900] = -0.5;
    const peaks = engine.computeWaveformPeaks(pcm, 200);
    expect(peaks).toHaveLength(200);
    expect(Math.max(...peaks)).toBe(1);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
  });
});

