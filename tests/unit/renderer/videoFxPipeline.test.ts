import { describe, it, expect, vi } from 'vitest';
import {
  VideoFxPipeline,
  createDefaultDeckFxState
} from '../../../src/renderer/video/VideoFxPipeline';

describe('VideoFxPipeline', () => {
  it('computes BPM-synced strobe pulses and extracts normalized audio bands', () => {
    const pipeline = new VideoFxPipeline();

    // 120 BPM = 2 beats/sec -> period 0.5s
    const beatOn = pipeline.computeStrobeAlpha(0.0, 120, 1.0);
    const beatOff = pipeline.computeStrobeAlpha(0.25, 120, 1.0);
    expect(beatOn).toBeGreaterThan(0.5);
    expect(beatOff).toBe(0);

    expect(pipeline.extractAudioBands(null)).toEqual({ low: 0, mid: 0, high: 0 });

    const fakeAnalyser = {
      frequencyBinCount: 64,
      context: { sampleRate: 48000 },
      getByteFrequencyData: vi.fn((arr: Uint8Array) => {
        arr.fill(128);
      })
    } as unknown as AnalyserNode;

    const bands = pipeline.extractAudioBands(fakeAnalyser);
    expect(bands.low).toBeGreaterThan(0.4);
    expect(bands.low).toBeLessThanOrEqual(1);
    expect(bands.mid).toBeGreaterThan(0.4);
    expect(bands.high).toBeGreaterThan(0.4);
  });

  it('produces uniform values for all 7 video FX', () => {
    const pipeline = new VideoFxPipeline();
    const fx = createDefaultDeckFxState();
    fx.enabled.blur = true;
    fx.intensity.blur = 0.7;
    fx.enabled.mirror = true;
    fx.mirrorMode = 'quad';
    fx.enabled['audio-shader'] = true;
    fx.intensity['audio-shader'] = 0.9;

    const uniforms = pipeline.getFxUniforms(
      fx,
      { low: 0.8, mid: 0.4, high: 0.2 },
      1.0,
      120
    );

    expect(uniforms.u_fxBlur).toBeCloseTo(0.7, 3);
    expect(uniforms.u_fxMirrorMode).toBe(3);
    expect(uniforms.u_fxAudioShader).toBeCloseTo(0.9, 3);
    expect(uniforms.u_fxHue).toBe(0);
    expect(uniforms.u_fxBw).toBe(0);
    expect(uniforms.u_fxPixelate).toBe(0);
    expect(uniforms.u_fxStrobe).toBe(0);
  });
});
