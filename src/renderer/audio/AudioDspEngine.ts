import type { DeckId } from '../../shared/types';

export type CrossfaderCurve = 'equal-power' | 'linear' | 'scratch';
export type EqBand = 'low' | 'mid' | 'high';
export type AudioFxId = 'echo' | 'reverb' | 'flanger';
export type SamplerPadId =
  | 'airhorn'
  | 'riser'
  | 'sub-drop'
  | 'clap'
  | 'laser'
  | 'siren'
  | 'kick'
  | 'hihat';

interface DeckChannelNodes {
  trimGain: GainNode;
  autoGain: GainNode;
  autoGainValue: number;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  analyser: AnalyserNode;
  channelFader: GainNode;
  crossfaderGain: GainNode;
  cueToggleGain: GainNode;
  echoSendGain: GainNode | null;
  echoDelay: DelayNode | null;
  reverbSendGain: GainNode | null;
  flangerSendGain: GainNode | null;
  flangerLfo: OscillatorNode | null;
  fxState: Record<AudioFxId, { enabled: boolean; wet: number }>;
  eqValuesDb: Record<EqBand, number>;
  eqKilled: Record<EqBand, boolean>;
  colorFilterMode: 'allpass' | 'lowpass' | 'highpass';
  timeDomainBuf: Uint8Array<ArrayBuffer>;
  freqBuf: Uint8Array<ArrayBuffer>;
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

    const autoGain = ctx.createGain();
    autoGain.gain.value = 1;

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

    trimGain.connect(autoGain);
    autoGain.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(colorFilter);
    colorFilter.connect(analyser);

    let echoSendGain: GainNode | null = null;
    let echoDelay: DelayNode | null = null;
    if (typeof ctx.createDelay === 'function') {
      echoSendGain = ctx.createGain();
      echoSendGain.gain.value = 0;
      echoDelay = ctx.createDelay(2.0);
      echoDelay.delayTime.value = 0.375;
      const echoFb = ctx.createGain();
      echoFb.gain.value = 0.42;
      const echoDamp = ctx.createBiquadFilter();
      echoDamp.type = 'lowpass';
      echoDamp.frequency.value = 3400;

      colorFilter.connect(echoSendGain);
      echoSendGain.connect(echoDelay);
      echoDelay.connect(echoDamp);
      echoDamp.connect(echoFb);
      echoFb.connect(echoDelay);
      echoDelay.connect(analyser);
    }

    let reverbSendGain: GainNode | null = null;
    if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function') {
      reverbSendGain = ctx.createGain();
      reverbSendGain.gain.value = 0;
      const conv = ctx.createConvolver();
      const sampleRate = ctx.sampleRate || 44100;
      const len = Math.floor(sampleRate * 1.4);
      const ir = ctx.createBuffer(2, len, sampleRate);
      for (let ch = 0; ch < 2; ch += 1) {
        const data = ir.getChannelData(ch);
        for (let i = 0; i < len; i += 1) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
        }
      }
      conv.buffer = ir;
      colorFilter.connect(reverbSendGain);
      reverbSendGain.connect(conv);
      conv.connect(analyser);
    }

    let flangerSendGain: GainNode | null = null;
    let flangerLfo: OscillatorNode | null = null;
    if (typeof ctx.createDelay === 'function' && typeof ctx.createOscillator === 'function') {
      flangerSendGain = ctx.createGain();
      flangerSendGain.gain.value = 0;
      const flangerDelay = ctx.createDelay(0.1);
      flangerDelay.delayTime.value = 0.006;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.003;
      flangerLfo = ctx.createOscillator();
      flangerLfo.frequency.value = 0.45;
      flangerLfo.connect(lfoDepth);
      lfoDepth.connect(flangerDelay.delayTime);
      flangerLfo.start();

      colorFilter.connect(flangerSendGain);
      flangerSendGain.connect(flangerDelay);
      flangerDelay.connect(analyser);
    }

    analyser.connect(channelFader);
    channelFader.connect(crossfaderGain);
    crossfaderGain.connect(this.masterBusSum!);

    analyser.connect(cueToggleGain);
    cueToggleGain.connect(this.cuePflSum!);

    return {
      trimGain,
      autoGain,
      autoGainValue: 1,
      eqLow,
      eqMid,
      eqHigh,
      colorFilter,
      analyser,
      channelFader,
      crossfaderGain,
      cueToggleGain,
      echoSendGain,
      echoDelay,
      reverbSendGain,
      flangerSendGain,
      flangerLfo,
      fxState: {
        echo: { enabled: false, wet: 0.45 },
        reverb: { enabled: false, wet: 0.45 },
        flanger: { enabled: false, wet: 0.45 }
      },
      eqValuesDb: { low: 0, mid: 0, high: 0 },
      eqKilled: { low: false, mid: false, high: false },
      colorFilterMode: 'allpass',
      timeDomainBuf: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      freqBuf: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount || 1024))
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

  setDeckAutoGain(deck: DeckId, gainLinear: number): void {
    const d = this.getDeckOrThrow(deck);
    const clamped = clamp(gainLinear, 0.35, 2.8);
    d.autoGainValue = clamped;
    if (this.ctx && typeof d.autoGain.gain.setTargetAtTime === 'function') {
      d.autoGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.08);
    } else {
      d.autoGain.gain.value = clamped;
    }
  }

  getDeckAutoGain(deck: DeckId): number {
    return this.getDeckOrThrow(deck).autoGainValue;
  }

  setDeckFx(
    deck: DeckId,
    fx: AudioFxId,
    enabled: boolean,
    wet01: number,
    bpm?: number | null
  ): void {
    const d = this.getDeckOrThrow(deck);
    const clampedWet = clamp(wet01, 0, 1);
    d.fxState[fx] = { enabled, wet: clampedWet };
    const activeLevel = enabled ? clampedWet : 0;

    if (fx === 'echo') {
      if (d.echoDelay && bpm && bpm > 40) {
        d.echoDelay.delayTime.value = clamp((60 / bpm) * 0.75, 0.12, 0.9);
      }
      if (d.echoSendGain) {
        d.echoSendGain.gain.value = activeLevel * 0.65;
      }
      return;
    }

    if (fx === 'reverb') {
      if (d.reverbSendGain) {
        d.reverbSendGain.gain.value = activeLevel * 0.7;
      }
      return;
    }

    if (d.flangerSendGain) {
      d.flangerSendGain.gain.value = activeLevel * 0.6;
    }
  }

  getDeckFx(deck: DeckId, fx: AudioFxId): { enabled: boolean; wet: number } {
    return { ...this.getDeckOrThrow(deck).fxState[fx] };
  }

  readDeckFrequencyBands(deck: DeckId): { low: number; mid: number; high: number } {
    if (!this.decks) return { low: 0, mid: 0, high: 0 };
    const d = this.decks[deck];
    d.analyser.getByteFrequencyData(d.freqBuf);
    const avgRange = (start: number, end: number) => {
      const safeEnd = Math.min(d.freqBuf.length, end);
      if (safeEnd <= start) return 0;
      let sum = 0;
      for (let i = start; i < safeEnd; i += 1) sum += d.freqBuf[i];
      return clamp(sum / ((safeEnd - start) * 255), 0, 1);
    };
    return {
      low: avgRange(0, 8),
      mid: avgRange(8, 48),
      high: avgRange(48, 160)
    };
  }

  triggerSample(pad: SamplerPadId, volume01 = 0.75): void {
    if (!this.ctx || !this.masterBusSum || typeof this.ctx.createOscillator !== 'function') {
      return;
    }
    const ctx = this.ctx;
    const vol = clamp(volume01, 0.05, 1.5) * 0.45;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(this.masterBusSum);

    const playTone = (
      type: OscillatorType,
      fStart: number,
      fEnd: number,
      dur: number,
      startOffset = 0
    ) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(fStart, t + startOffset);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t + startOffset + dur);
      g.gain.setValueAtTime(vol, t + startOffset);
      g.gain.exponentialRampToValueAtTime(0.001, t + startOffset + dur);
      osc.connect(g);
      g.connect(gain);
      osc.start(t + startOffset);
      osc.stop(t + startOffset + dur + 0.02);
    };

    const playNoise = (dur: number, filterType: BiquadFilterType, freq: number) => {
      if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') {
        return;
      }
      const sr = ctx.sampleRate || 44100;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i += 1) ch[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const flt = ctx.createBiquadFilter();
      flt.type = filterType;
      flt.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(flt);
      flt.connect(g);
      g.connect(gain);
      src.start(t);
    };

    if (pad === 'airhorn') {
      playTone('sawtooth', 485, 470, 0.22, 0);
      playTone('sawtooth', 485, 465, 0.45, 0.24);
      playTone('sawtooth', 595, 580, 0.45, 0.24);
    } else if (pad === 'riser') {
      playTone('sawtooth', 160, 1450, 1.1);
    } else if (pad === 'sub-drop') {
      playTone('sine', 120, 28, 0.85);
    } else if (pad === 'clap') {
      playNoise(0.22, 'bandpass', 1800);
    } else if (pad === 'laser') {
      playTone('square', 1400, 110, 0.28);
    } else if (pad === 'siren') {
      playTone('triangle', 640, 1080, 0.28, 0);
      playTone('triangle', 1080, 620, 0.32, 0.28);
    } else if (pad === 'kick') {
      playTone('sine', 155, 38, 0.22);
    } else {
      playNoise(0.08, 'highpass', 7200);
    }
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
    if (this.decks) {
      for (const deck of ['A', 'B'] as DeckId[]) {
        try {
          this.decks[deck].flangerLfo?.stop();
        } catch {
          // ignore already stopped LFO
        }
      }
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.decks = null;
    this.masterDest = null;
    this.cueDest = null;
  }
}

