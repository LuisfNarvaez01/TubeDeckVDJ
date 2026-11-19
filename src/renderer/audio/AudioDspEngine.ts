import type { DeckId } from '../../shared/types';

export type CrossfaderCurve = 'equal-power' | 'linear' | 'scratch';
export type EqBand = 'low' | 'mid' | 'high';

interface DeckChannelNodes {
  trimGain: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  analyser: AnalyserNode;
  channelFader: GainNode;
  crossfaderGain: GainNode;
  cueToggleGain: GainNode;
  eqValuesDb: Record<EqBand, number>;
  eqKilled: Record<EqBand, boolean>;
  colorFilterMode: 'allpass' | 'lowpass' | 'highpass';
  timeDomainBuf: Uint8Array<ArrayBuffer>;
}

const KILL_DB = -60;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function defaultContextFactory(): AudioContext {
  return new AudioContext({ latencyHint: 'interactive' });
}

export function computeCrossfaderCurveGains(
  pos01: number,
  curve: CrossfaderCurve
): { a: number; b: number } {
  const x = clamp(pos01, 0, 1);
  if (curve === 'linear') {
    return { a: 1 - x, b: x };
  }
  if (curve === 'scratch') {
    // Sharp cut near ends (0..0.1 / 0.9..1.0), full volume across middle
    const a = x <= 0.9 ? 1 : (1 - x) / 0.1;
    const b = x >= 0.1 ? 1 : x / 0.1;
    return { a: clamp(a, 0, 1), b: clamp(b, 0, 1) };
  }
  // equal-power
  return {
    a: Math.cos(x * Math.PI * 0.5),
    b: Math.sin(x * Math.PI * 0.5)
  };
}

export class AudioDspEngine {
  private readonly contextFactory: () => AudioContext;
  private ctx: AudioContext | null = null;
  private decks: Record<DeckId, DeckChannelNodes> | null = null;
  private attachedSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  private masterBusSum: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterTimeDomainBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(2048));
  private masterDest: MediaStreamAudioDestinationNode | null = null;

  private cuePflSum: GainNode | null = null;
  private cuePflBlendGain: GainNode | null = null;
  private cueMasterBlendGain: GainNode | null = null;
  private cueOutGain: GainNode | null = null;
  private cueDest: MediaStreamAudioDestinationNode | null = null;

  private monoSplitActive = false;
  private monoSplitterMaster: ChannelSplitterNode | null = null;
  private monoSplitterCue: ChannelSplitterNode | null = null;
  private monoMerger: ChannelMergerNode | null = null;
  private monoMasterGain: GainNode | null = null;
  private monoCueGain: GainNode | null = null;
  private normalMasterRouteGain: GainNode | null = null;

  private crossfaderPos = 0.5;
  private crossfaderCurve: CrossfaderCurve = 'equal-power';
  private crossfaderGains = { a: Math.SQRT1_2, b: Math.SQRT1_2 };

  constructor(contextFactory: () => AudioContext = defaultContextFactory) {
    this.contextFactory = contextFactory;
  }

  async init(): Promise<void> {
    if (!this.ctx) {
      const ctx = this.contextFactory();
      this.ctx = ctx;

      this.masterBusSum = ctx.createGain();
      this.masterGainNode = ctx.createGain();
      this.masterLimiter = ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.release.value = 0.1;
      this.masterLimiter.knee.value = 0;

      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 2048;
      this.masterTimeDomainBuf = new Uint8Array(new ArrayBuffer(this.masterAnalyser.fftSize));
      this.masterDest = ctx.createMediaStreamDestination();

      this.normalMasterRouteGain = ctx.createGain();
      this.normalMasterRouteGain.gain.value = 1;

      this.masterBusSum.connect(this.masterGainNode);
      this.masterGainNode.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.normalMasterRouteGain);
      this.normalMasterRouteGain.connect(this.masterDest);

      // Cue bus (PFL + Master blend)
      this.cuePflSum = ctx.createGain();
      this.cuePflBlendGain = ctx.createGain();
      this.cuePflBlendGain.gain.value = 1;
      this.cueMasterBlendGain = ctx.createGain();
      this.cueMasterBlendGain.gain.value = 0;
      this.cueOutGain = ctx.createGain();
      this.cueOutGain.gain.value = 1;
      this.cueDest = ctx.createMediaStreamDestination();

      this.cuePflSum.connect(this.cuePflBlendGain);
      this.cuePflBlendGain.connect(this.cueOutGain);
      this.masterAnalyser.connect(this.cueMasterBlendGain);
      this.cueMasterBlendGain.connect(this.cueOutGain);
      this.cueOutGain.connect(this.cueDest);

      // Mono split network (L = Master mono, R = Cue mono)
      this.monoSplitterMaster = ctx.createChannelSplitter(2);
      this.monoSplitterCue = ctx.createChannelSplitter(2);
      this.monoMerger = ctx.createChannelMerger(2);
      this.monoMasterGain = ctx.createGain();
      this.monoMasterGain.gain.value = 0;
      this.monoCueGain = ctx.createGain();
      this.monoCueGain.gain.value = 0;

      this.masterAnalyser.connect(this.monoSplitterMaster);
      this.monoSplitterMaster.connect(this.monoMasterGain, 0);
      this.monoSplitterMaster.connect(this.monoMasterGain, 1);
      this.monoMasterGain.connect(this.monoMerger, 0, 0);

      this.cueOutGain.connect(this.monoSplitterCue);
      this.monoSplitterCue.connect(this.monoCueGain, 0);
      this.monoSplitterCue.connect(this.monoCueGain, 1);
      this.monoCueGain.connect(this.monoMerger, 0, 1);

      this.monoMerger.connect(this.masterDest);

      this.decks = {
        A: this.createDeckNodes(ctx),
        B: this.createDeckNodes(ctx)
      };

      this.setCrossfader(this.crossfaderPos, this.crossfaderCurve);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  private createDeckNodes(ctx: AudioContext): DeckChannelNodes {
    const trimGain = ctx.createGain();
    trimGain.gain.value = 1;

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 250;
    eqLow.gain.value = 0;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;
    eqMid.gain.value = 0;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4000;
    eqHigh.gain.value = 0;

    const colorFilter = ctx.createBiquadFilter();
    colorFilter.type = 'allpass';
    colorFilter.frequency.value = 1000;
    colorFilter.Q.value = 1.5;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    const channelFader = ctx.createGain();
    channelFader.gain.value = 1;

    const crossfaderGain = ctx.createGain();
    crossfaderGain.gain.value = 1;

    const cueToggleGain = ctx.createGain();
    cueToggleGain.gain.value = 0;

    trimGain.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(colorFilter);
    colorFilter.connect(analyser);

    analyser.connect(channelFader);
    channelFader.connect(crossfaderGain);
    crossfaderGain.connect(this.masterBusSum!);

    analyser.connect(cueToggleGain);
    cueToggleGain.connect(this.cuePflSum!);

    return {
      trimGain,
      eqLow,
      eqMid,
      eqHigh,
      colorFilter,
      analyser,
      channelFader,
      crossfaderGain,
      cueToggleGain,
      eqValuesDb: { low: 0, mid: 0, high: 0 },
      eqKilled: { low: false, mid: false, high: false },
      colorFilterMode: 'allpass',
      timeDomainBuf: new Uint8Array(new ArrayBuffer(analyser.fftSize))
    };
  }

  private getDeckOrThrow(deck: DeckId): DeckChannelNodes {
    if (!this.decks) {
      throw new Error('AudioDspEngine not initialized');
    }
    return this.decks[deck];
  }

  attachDeckElement(deck: DeckId, el: HTMLMediaElement): void {
    if (!this.ctx || !this.decks) {
      throw new Error('AudioDspEngine must be initialized before attaching elements');
    }
    if (this.attachedSources.has(el)) {
      return;
    }
    const source = this.ctx.createMediaElementSource(el);
    source.connect(this.decks[deck].trimGain);
    this.attachedSources.set(el, source);
  }

  setTrim(deck: DeckId, value: number): void {
    const d = this.getDeckOrThrow(deck);
    d.trimGain.gain.value = clamp(value, 0, 2);
  }

  setEq(deck: DeckId, band: EqBand, db: number): void {
    const d = this.getDeckOrThrow(deck);
    const clampedDb = clamp(db, -26, 12);
    d.eqValuesDb[band] = clampedDb;
    if (!d.eqKilled[band]) {
      this.getEqFilter(d, band).gain.value = clampedDb;
    }
  }

  setEqKill(deck: DeckId, band: EqBand, kill: boolean): void {
    const d = this.getDeckOrThrow(deck);
    d.eqKilled[band] = kill;
    this.getEqFilter(d, band).gain.value = kill ? KILL_DB : d.eqValuesDb[band];
  }

  getEqGainDb(deck: DeckId, band: EqBand): number {
    const d = this.getDeckOrThrow(deck);
    return this.getEqFilter(d, band).gain.value;
  }

  private getEqFilter(d: DeckChannelNodes, band: EqBand): BiquadFilterNode {
    if (band === 'low') return d.eqLow;
    if (band === 'mid') return d.eqMid;
    return d.eqHigh;
  }

  setColorFilter(deck: DeckId, amount: number): void {
    const d = this.getDeckOrThrow(deck);
    const a = clamp(amount, -1, 1);

    if (Math.abs(a) < 0.02) {
      d.colorFilter.type = 'allpass';
      d.colorFilter.frequency.value = 1000;
      d.colorFilterMode = 'allpass';
      return;
    }

    if (a < 0) {
      d.colorFilter.type = 'lowpass';
      d.colorFilterMode = 'lowpass';
      const norm = 1 + a; // 0 at -1, 1 at 0
      d.colorFilter.frequency.value = 220 * Math.pow(18000 / 220, norm);
      d.colorFilter.Q.value = 1.5;
      return;
    }

    d.colorFilter.type = 'highpass';
    d.colorFilterMode = 'highpass';
    d.colorFilter.frequency.value = 30 * Math.pow(6000 / 30, a);
    d.colorFilter.Q.value = 1.5;
  }

  getColorFilterMode(deck: DeckId): 'allpass' | 'lowpass' | 'highpass' {
    return this.getDeckOrThrow(deck).colorFilterMode;
  }

  setChannelFader(deck: DeckId, level: number): void {
    const d = this.getDeckOrThrow(deck);
    const x = clamp(level, 0, 1);
    d.channelFader.gain.value = x === 0 ? 0 : Math.pow(x, 1.8);
  }

  setCrossfader(pos: number, curve: CrossfaderCurve = this.crossfaderCurve): void {
    this.crossfaderPos = clamp(pos, 0, 1);
    this.crossfaderCurve = curve;
    const gains = computeCrossfaderCurveGains(this.crossfaderPos, curve);
    this.crossfaderGains = gains;
    if (this.decks) {
      this.decks.A.crossfaderGain.gain.value = gains.a;
      this.decks.B.crossfaderGain.gain.value = gains.b;
    }
  }

  getCrossfaderGains(): { a: number; b: number } {
    return this.crossfaderGains;
  }

  setCueEnabled(deck: DeckId, enabled: boolean): void {
    const d = this.getDeckOrThrow(deck);
    d.cueToggleGain.gain.value = enabled ? 1 : 0;
  }

  setCueMix(blend: number): void {
    if (!this.cuePflBlendGain || !this.cueMasterBlendGain) return;
    const b = clamp(blend, 0, 1);
    this.cuePflBlendGain.gain.value = Math.cos(b * Math.PI * 0.5);
    this.cueMasterBlendGain.gain.value = Math.sin(b * Math.PI * 0.5);
  }

  setCueGain(level: number): void {
    if (!this.cueOutGain) return;
    this.cueOutGain.gain.value = clamp(level, 0, 2);
  }

  setMasterGain(level: number): void {
    if (!this.masterGainNode) return;
    this.masterGainNode.gain.value = clamp(level, 0, 2);
  }

  setMonoSplitMode(enabled: boolean): void {
    this.monoSplitActive = enabled;
    if (
      !this.normalMasterRouteGain ||
      !this.monoMasterGain ||
      !this.monoCueGain ||
      !this.cueOutGain
    ) {
      return;
    }
    this.normalMasterRouteGain.gain.value = enabled ? 0 : 1;
    this.monoMasterGain.gain.value = enabled ? 0.5 : 0;
    this.monoCueGain.gain.value = enabled ? 0.5 : 0;
  }

  isMonoSplitMode(): boolean {
    return this.monoSplitActive;
  }

  readVuLevel(target: DeckId | 'MASTER'): number {
    if (!this.decks || !this.masterAnalyser) return 0;
    const analyser = target === 'MASTER' ? this.masterAnalyser : this.decks[target].analyser;
    const buf =
      target === 'MASTER' ? this.masterTimeDomainBuf : this.decks[target].timeDomainBuf;

    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const normalized = (buf[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    return clamp(rms * 2.4, 0, 1);
  }

  getDeckAnalyser(deck: DeckId): AnalyserNode | null {
    return this.decks ? this.decks[deck].analyser : null;
  }

  getMasterAnalyser(): AnalyserNode | null {
    return this.masterAnalyser;
  }

  getOutputDestinations(): {
    masterDest: MediaStreamAudioDestinationNode;
    cueDest: MediaStreamAudioDestinationNode;
    context: AudioContext;
  } {
    if (!this.ctx || !this.masterDest || !this.cueDest) {
      throw new Error('AudioDspEngine not initialized');
    }
    return {
      masterDest: this.masterDest,
      cueDest: this.cueDest,
      context: this.ctx
    };
  }

  async dispose(): Promise<void> {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.decks = null;
    this.masterDest = null;
    this.cueDest = null;
  }
}
