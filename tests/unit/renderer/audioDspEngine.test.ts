import { describe, it, expect, vi } from 'vitest';
import { AudioDspEngine } from '../../../src/renderer/audio/AudioDspEngine';

function createMockAudioContext(): AudioContext {
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    setTargetAtTime: vi.fn((v: number) => {
      param.value = v;
    })
  });
  let param: ReturnType<typeof makeParam>;

  const makeGain = () => ({
    gain: (param = makeParam(1)),
    connect: vi.fn()
  });

  const makeBiquad = () => ({
    type: 'lowshelf' as BiquadFilterType,
    frequency: makeParam(350),
    Q: makeParam(1),
    gain: makeParam(0),
    connect: vi.fn()
  });

  const makeAnalyser = () => ({
    fftSize: 2048,
    frequencyBinCount: 1024,
    connect: vi.fn(),
    getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(0))
  });

  const ctx = {
    state: 'running',
    currentTime: 0,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(makeGain),
    createBiquadFilter: vi.fn(makeBiquad),
    createAnalyser: vi.fn(makeAnalyser),
    createDynamicsCompressor: vi.fn(() => ({
      threshold: makeParam(-1),
      ratio: makeParam(20),
      attack: makeParam(0.001),
      release: makeParam(0.1),
      knee: makeParam(0),
      connect: vi.fn()
    })),
    createChannelSplitter: vi.fn(() => ({ connect: vi.fn() })),
    createChannelMerger: vi.fn(() => ({ connect: vi.fn() })),
    createMediaStreamDestination: vi.fn(() => ({
      stream: {} as MediaStream,
      connect: vi.fn()
    }))
  };
  return ctx as unknown as AudioContext;
}

describe('AudioDspEngine', () => {
  it('attaches each media element once, applies EQ/Kill/Filter and crossfader curves', async () => {
    const mockCtx = createMockAudioContext();
    const dsp = new AudioDspEngine(() => mockCtx);
    await dsp.init();

    const fakeElA = { id: 'el-a' } as unknown as HTMLMediaElement;
    const fakeElB = { id: 'el-b' } as unknown as HTMLMediaElement;

    dsp.attachDeckElement('A', fakeElA);
    dsp.attachDeckElement('A', fakeElA); // idempotent
    dsp.attachDeckElement('B', fakeElB);
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);

    // EQ + Kill restore
    dsp.setEq('A', 'low', -12);
    expect(dsp.getEqGainDb('A', 'low')).toBe(-12);
    dsp.setEqKill('A', 'low', true);
    expect(dsp.getEqGainDb('A', 'low')).toBe(-60);
    dsp.setEqKill('A', 'low', false);
    expect(dsp.getEqGainDb('A', 'low')).toBe(-12);

    // Color filter bipolar
    dsp.setColorFilter('A', -0.5);
    expect(dsp.getColorFilterMode('A')).toBe('lowpass');
    dsp.setColorFilter('A', 0.5);
    expect(dsp.getColorFilterMode('A')).toBe('highpass');
    dsp.setColorFilter('A', 0);
    expect(dsp.getColorFilterMode('A')).toBe('allpass');

    // Crossfader curves
    dsp.setCrossfader(0.5, 'equal-power');
    expect(dsp.getCrossfaderGains().a).toBeCloseTo(Math.SQRT1_2, 2);
    expect(dsp.getCrossfaderGains().b).toBeCloseTo(Math.SQRT1_2, 2);

    dsp.setCrossfader(0.5, 'scratch');
    expect(dsp.getCrossfaderGains().a).toBe(1);
    expect(dsp.getCrossfaderGains().b).toBe(1);
    dsp.setCrossfader(0.95, 'scratch');
    expect(dsp.getCrossfaderGains().a).toBeCloseTo(0.5, 1);
    expect(dsp.getCrossfaderGains().b).toBe(1);

    // Auto-Gain clamping
    dsp.setDeckAutoGain('A', 4.5);
    expect(dsp.getDeckAutoGain('A')).toBe(2.8);
    dsp.setDeckAutoGain('A', 0.1);
    expect(dsp.getDeckAutoGain('A')).toBe(0.35);

    // Audio FX rack state + sample trigger safe even on mock contexts
    dsp.setDeckFx('A', 'echo', true, 0.6, 125);
    expect(dsp.getDeckFx('A', 'echo')).toEqual({ enabled: true, wet: 0.6 });
    expect(() => dsp.triggerSample('airhorn', 0.8)).not.toThrow();
    expect(dsp.readDeckFrequencyBands('A')).toEqual({ low: 0, mid: 0, high: 0 });

    await dsp.dispose();
  });
});

