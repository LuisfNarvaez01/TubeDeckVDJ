export type VideoFxId =
  | 'blur'
  | 'strobe'
  | 'mirror'
  | 'hue-tint'
  | 'bw-contrast'
  | 'pixelate'
  | 'audio-shader';

export interface DeckFxState {
  enabled: Record<VideoFxId, boolean>;
  intensity: Record<VideoFxId, number>;
  mirrorMode: 'h' | 'v' | 'quad';
}

export function createDefaultDeckFxState(): DeckFxState {
  return {
    enabled: {
      blur: false,
      strobe: false,
      mirror: false,
      'hue-tint': false,
      'bw-contrast': false,
      pixelate: false,
      'audio-shader': false
    },
    intensity: {
      blur: 0.5,
      strobe: 0.7,
      mirror: 1,
      'hue-tint': 0.5,
      'bw-contrast': 0.85,
      pixelate: 0.5,
      'audio-shader': 0.65
    },
    mirrorMode: 'h'
  };
}

export class VideoFxPipeline {
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;

  computeStrobeAlpha(timeSec: number, bpm: number, intensity: number): number {
    if (intensity <= 0.01) return 0;
    const safeBpm = Math.max(40, Math.min(220, bpm || 120));
    const beatPeriod = 60 / safeBpm;
    const phase = (timeSec % beatPeriod) / beatPeriod;
    return phase < 0.18 ? Math.min(1, Math.max(0, intensity)) : 0;
  }

  extractAudioBands(analyser: AnalyserNode | null): { low: number; mid: number; high: number } {
    if (!analyser || analyser.frequencyBinCount === 0) {
      return { low: 0, mid: 0, high: 0 };
    }

    if (!this.freqBuf || this.freqBuf.length !== analyser.frequencyBinCount) {
      this.freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }

    analyser.getByteFrequencyData(this.freqBuf);
    const sampleRate = analyser.context?.sampleRate ?? 48000;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / this.freqBuf.length;

    const avgBand = (minHz: number, maxHz: number): number => {
      const start = Math.max(0, Math.floor(minHz / binHz));
      const end = Math.min(this.freqBuf!.length - 1, Math.ceil(maxHz / binHz));
      if (end < start) return 0;
      let sum = 0;
      for (let i = start; i <= end; i += 1) {
        sum += this.freqBuf![i];
      }
      return sum / ((end - start + 1) * 255);
    };

    return {
      low: avgBand(20, 250),
      mid: avgBand(250, 4000),
      high: avgBand(4000, 16000)
    };
  }

  getFxUniforms(
    state: DeckFxState,
    _bands: { low: number; mid: number; high: number },
    timeSec: number,
    bpm: number
  ): Record<string, number> {
    const val = (id: VideoFxId): number => (state.enabled[id] ? state.intensity[id] : 0);
    const mirrorCode = !state.enabled.mirror
      ? 0
      : state.mirrorMode === 'h'
        ? 1
        : state.mirrorMode === 'v'
          ? 2
          : 3;

    return {
      u_fxBlur: val('blur'),
      u_fxStrobe: state.enabled.strobe
        ? this.computeStrobeAlpha(timeSec, bpm, state.intensity.strobe)
        : 0,
      u_fxMirrorMode: mirrorCode,
      u_fxHue: val('hue-tint'),
      u_fxBw: val('bw-contrast'),
      u_fxPixelate: val('pixelate'),
      u_fxAudioShader: val('audio-shader')
    };
  }
}

