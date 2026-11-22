import type { DeckId } from '../../shared/types';

export type CrossfaderCurve = 'equal-power' | 'linear' | 'scratch';
export type EqBand = 'low' | 'mid' | 'high';
export type AudioFxId = 'echo' | 'reverb' | 'flanger';
export type FxBeatDivision = '1/4' | '1/2' | '3/4' | '1/1';
export type SamplerPadId =
  | 'airhorn'
  | 'riser'
  | 'sub-drop'
  | 'clap'
  | 'laser'
  | 'siren'
  | 'kick'
  | 'hihat';

const FX_BEAT_DIV_MULT: Record<FxBeatDivision, number> = {
  '1/4': 0.25,
  '1/2': 0.5,
  '3/4': 0.75,
  '1/1': 1
};

/** Reverb tail length for each time setting: room, plate, hall, cathedral. */
const REVERB_SIZE_SEC: Record<FxBeatDivision, number> = {
  '1/4': 0.9,
  '1/2': 1.7,
  '3/4': 2.6,
  '1/1': 4
};

/**
 * Hall impulse response: noise with an exponential decay that also gets darker over time
 * (high frequencies die first, like a real room), different on each side for a wide image.
 */
export function buildReverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const decay = Math.exp(-6.2 * t);
      // One-pole low-pass whose cutoff falls along the tail.
      const coeff = 0.18 + 0.75 * t;
      const noise = Math.random() * 2 - 1;
      lp += (noise - lp) * (1 - coeff);
      const early = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      data[i] = (lp * 1.6 + early) * decay;
    }
  }
  return ir;
}

interface DeckChannelNodes {
  trimGain: GainNode;
  autoGain: GainNode;
  autoGainValue: number;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  colorFilter: BiquadFilterNode;
  keyShiftFilter: BiquadFilterNode;
  keyShiftSemitones: number;
  analyser: AnalyserNode;
  analyserL: AnalyserNode | null;
  analyserR: AnalyserNode | null;
  /** High-resolution, pre-EQ analyser used for musical key detection. */
  keyAnalyser: AnalyserNode | null;
  channelFader: GainNode;
  crossfaderGain: GainNode;
  cueToggleGain: GainNode;
  echoSendGain: GainNode | null;
  echoDelay: DelayNode | null;
  /** Right side of the ping-pong echo (left and right repeat in turn). */
  echoDelayR: DelayNode | null;
  reverbSendGain: GainNode | null;
  reverbConv: ConvolverNode | null;
  reverbSizeSec: number;
  flangerSendGain: GainNode | null;
  flangerLfo: OscillatorNode | null;
  /** Dry level: dips a little while the flanger is on so the sweep is heard, not just added. */
  fxDry: GainNode | null;
  /** Last known tempo, so beat-synced FX follow BPM changes. */
  fxBpm: number;
  fxState: Record<AudioFxId, { enabled: boolean; wet: number }>;
  fxBeatDiv: Record<AudioFxId, FxBeatDivision>;
  eqValuesDb: Record<EqBand, number>;
  eqKilled: Record<EqBand, boolean>;
  colorFilterMode: 'allpass' | 'lowpass' | 'highpass';
  timeDomainBuf: Uint8Array<ArrayBuffer>;
  timeDomainBufL: Uint8Array<ArrayBuffer>;
  timeDomainBufR: Uint8Array<ArrayBuffer>;
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
  private masterAnalyserL: AnalyserNode | null = null;
  private masterAnalyserR: AnalyserNode | null = null;
  private masterTimeDomainBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(2048));
  private masterBufL: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private masterBufR: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private masterSpectrumBuf: Uint8Array<ArrayBuffer> | null = null;
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
      this.masterSpectrumBuf = new Uint8Array(
        new ArrayBuffer(this.masterAnalyser.frequencyBinCount || 1024)
      );

      if (typeof ctx.createChannelSplitter === 'function') {
        const masterSplitter = ctx.createChannelSplitter(2);
        const mL = ctx.createAnalyser();
        mL.fftSize = 1024;
        const mR = ctx.createAnalyser();
        mR.fftSize = 1024;
        this.masterAnalyser.connect(masterSplitter);
        masterSplitter.connect(mL, 0);
        masterSplitter.connect(mR, 1);
        this.masterAnalyserL = mL;
        this.masterAnalyserR = mR;
        this.masterBufL = new Uint8Array(new ArrayBuffer(mL.fftSize));
        this.masterBufR = new Uint8Array(new ArrayBuffer(mR.fftSize));
      }

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

    const keyShiftFilter = ctx.createBiquadFilter();
    keyShiftFilter.type = 'allpass';
    keyShiftFilter.frequency.value = 1200;
    keyShiftFilter.Q.value = 0.7;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    let analyserL: AnalyserNode | null = null;
    let analyserR: AnalyserNode | null = null;
    if (typeof ctx.createChannelSplitter === 'function') {
      const chSplitter = ctx.createChannelSplitter(2);
      analyserL = ctx.createAnalyser();
      analyserL.fftSize = 1024;
      analyserR = ctx.createAnalyser();
      analyserR.fftSize = 1024;
      analyser.connect(chSplitter);
      chSplitter.connect(analyserL, 0);
      chSplitter.connect(analyserR, 1);
    }

    const channelFader = ctx.createGain();
    channelFader.gain.value = 1;

    const crossfaderGain = ctx.createGain();
    crossfaderGain.gain.value = 1;

    const cueToggleGain = ctx.createGain();
    cueToggleGain.gain.value = 0;

    let keyAnalyser: AnalyserNode | null = null;
    if (typeof ctx.createAnalyser === 'function') {
      keyAnalyser = ctx.createAnalyser();
      keyAnalyser.fftSize = 16384;
      keyAnalyser.smoothingTimeConstant = 0;
      trimGain.connect(keyAnalyser);
    }

    trimGain.connect(autoGain);
    autoGain.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(colorFilter);
    colorFilter.connect(keyShiftFilter);
    const fxDry = ctx.createGain();
    fxDry.gain.value = 1;
    keyShiftFilter.connect(fxDry);
    fxDry.connect(analyser);

    // ECHO: stereo ping-pong. The send is high-passed so repeats never muddy the bass, and
    // each repeat is darker than the last (tape-style damping).
    let echoSendGain: GainNode | null = null;
    let echoDelay: DelayNode | null = null;
    let echoDelayR: DelayNode | null = null;
    if (typeof ctx.createDelay === 'function') {
      echoSendGain = ctx.createGain();
      echoSendGain.gain.value = 0;
      const echoHp = ctx.createBiquadFilter();
      echoHp.type = 'highpass';
      echoHp.frequency.value = 140;
      echoDelay = ctx.createDelay(4.0);
      echoDelay.delayTime.value = 0.375;
      echoDelayR = ctx.createDelay(4.0);
      echoDelayR.delayTime.value = 0.375;
      const dampL = ctx.createBiquadFilter();
      dampL.type = 'lowpass';
      dampL.frequency.value = 4200;
      const dampR = ctx.createBiquadFilter();
      dampR.type = 'lowpass';
      dampR.frequency.value = 4200;
      const fbL = ctx.createGain();
      fbL.gain.value = 0.5;
      const fbR = ctx.createGain();
      fbR.gain.value = 0.5;

      colorFilter.connect(echoSendGain);
      echoSendGain.connect(echoHp);
      echoHp.connect(echoDelay);
      echoDelay.connect(dampL);
      dampL.connect(fbL);
      fbL.connect(echoDelayR);
      echoDelayR.connect(dampR);
      dampR.connect(fbR);
      fbR.connect(echoDelay);
      if (typeof ctx.createChannelMerger === 'function') {
        const echoOut = ctx.createChannelMerger(2);
        echoDelay.connect(echoOut, 0, 0);
        echoDelayR.connect(echoOut, 0, 1);
        echoOut.connect(analyser);
      } else {
        echoDelay.connect(analyser);
        echoDelayR.connect(analyser);
      }
    }

    // REVERB: pre-delayed hall with a decorrelated stereo tail; size follows the time setting.
    let reverbSendGain: GainNode | null = null;
    let reverbConv: ConvolverNode | null = null;
    if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function') {
      reverbSendGain = ctx.createGain();
      reverbSendGain.gain.value = 0;
      const revHp = ctx.createBiquadFilter();
      revHp.type = 'highpass';
      revHp.frequency.value = 240;
      reverbConv = ctx.createConvolver();
      reverbConv.buffer = buildReverbImpulse(ctx, REVERB_SIZE_SEC['3/4']);
      colorFilter.connect(reverbSendGain);
      reverbSendGain.connect(revHp);
      if (typeof ctx.createDelay === 'function') {
        const preDelay = ctx.createDelay(0.2);
        preDelay.delayTime.value = 0.025;
        revHp.connect(preDelay);
        preDelay.connect(reverbConv);
      } else {
        revHp.connect(reverbConv);
      }
      reverbConv.connect(analyser);
    }

    // FLANGER: short modulated delay with feedback (the jet sweep), LFO locked to the beat.
    let flangerSendGain: GainNode | null = null;
    let flangerLfo: OscillatorNode | null = null;
    if (typeof ctx.createDelay === 'function' && typeof ctx.createOscillator === 'function') {
      flangerSendGain = ctx.createGain();
      flangerSendGain.gain.value = 0;
      const flangerDelay = ctx.createDelay(0.05);
      flangerDelay.delayTime.value = 0.004;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.0028;
      const flangerFb = ctx.createGain();
      flangerFb.gain.value = 0.62;
      flangerLfo = ctx.createOscillator();
      flangerLfo.type = 'triangle';
      flangerLfo.frequency.value = 0.25;
      flangerLfo.connect(lfoDepth);
      lfoDepth.connect(flangerDelay.delayTime);
      flangerLfo.start();

      colorFilter.connect(flangerSendGain);
      flangerSendGain.connect(flangerDelay);
      flangerDelay.connect(flangerFb);
      flangerFb.connect(flangerDelay);
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
      keyShiftFilter,
      keyShiftSemitones: 0,
      analyser,
      analyserL,
      keyAnalyser,
      analyserR,
      channelFader,
      crossfaderGain,
      cueToggleGain,
      echoSendGain,
      echoDelay,
      echoDelayR,
      reverbSendGain,
      reverbConv,
      reverbSizeSec: REVERB_SIZE_SEC['3/4'],
      flangerSendGain,
      flangerLfo,
      fxDry,
      fxBpm: 120,
      fxState: {
        echo: { enabled: false, wet: 0.45 },
        reverb: { enabled: false, wet: 0.45 },
        flanger: { enabled: false, wet: 0.45 }
      },
      fxBeatDiv: {
        echo: '3/4',
        reverb: '3/4',
        flanger: '3/4'
      },
      eqValuesDb: { low: 0, mid: 0, high: 0 },
      eqKilled: { low: false, mid: false, high: false },
      colorFilterMode: 'allpass',
      timeDomainBuf: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      timeDomainBufL: new Uint8Array(new ArrayBuffer(analyserL?.fftSize ?? 1024)),
      timeDomainBufR: new Uint8Array(new ArrayBuffer(analyserR?.fftSize ?? 1024)),
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

  attachCuePreviewElement(el: HTMLMediaElement): void {
    if (!this.ctx || !this.cuePflSum) {
      throw new Error('AudioDspEngine must be initialized before attaching cue preview');
    }
    if (this.attachedSources.has(el)) {
      return;
    }
    const source = this.ctx.createMediaElementSource(el);
    source.connect(this.cuePflSum);
    this.attachedSources.set(el, source);
  }

  setKeyShift(deck: DeckId, semitones: number): void {
    const d = this.getDeckOrThrow(deck);
    const clamped = Math.max(-6, Math.min(6, Math.round(semitones)));
    d.keyShiftSemitones = clamped;
    if (clamped === 0) {
      d.keyShiftFilter.type = 'allpass';
      d.keyShiftFilter.gain.value = 0;
      return;
    }
    d.keyShiftFilter.type = 'peaking';
    d.keyShiftFilter.frequency.value = clamped > 0 ? 2200 + clamped * 220 : 420 + clamped * 30;
    d.keyShiftFilter.Q.value = 0.85;
    d.keyShiftFilter.gain.value = clamp(clamped * 0.65, -4, 4);
  }

  getKeyShift(deck: DeckId): number {
    return this.getDeckOrThrow(deck).keyShiftSemitones;
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
    bpm?: number | null,
    beatDiv?: FxBeatDivision
  ): void {
    const d = this.getDeckOrThrow(deck);
    const clampedWet = clamp(wet01, 0, 1);
    d.fxState[fx] = { enabled, wet: clampedWet };
    if (beatDiv) {
      d.fxBeatDiv[fx] = beatDiv;
    }
    if (bpm && bpm > 40) d.fxBpm = bpm;
    this.applyDeckFx(d, fx);
  }

  /** Beat-synced FX follow the deck tempo (BPM detected, tapped or halved/doubled). */
  setDeckFxTempo(deck: DeckId, bpm: number | null): void {
    if (!this.decks || !bpm || bpm <= 40) return;
    const d = this.decks[deck];
    if (Math.abs(d.fxBpm - bpm) < 0.05) return;
    d.fxBpm = bpm;
    this.applyDeckFx(d, 'echo');
    this.applyDeckFx(d, 'flanger');
  }

  private applyDeckFx(d: DeckChannelNodes, fx: AudioFxId): void {
    const { enabled, wet } = d.fxState[fx];
    const div = d.fxBeatDiv[fx];
    const divMult = FX_BEAT_DIV_MULT[div];
    const level = enabled ? wet : 0;
    const beatSec = 60 / (d.fxBpm > 40 ? d.fxBpm : 120);

    if (fx === 'echo') {
      const t = clamp(beatSec * divMult, 0.05, 3.5);
      this.rampParam(d.echoDelay?.delayTime, t, 0.05);
      this.rampParam(d.echoDelayR?.delayTime, t, 0.05);
      // Equal-ish loudness: the send rises faster at the start of the knob travel.
      this.rampParam(d.echoSendGain?.gain, Math.sqrt(level) * 0.8);
      return;
    }

    if (fx === 'reverb') {
      const size = REVERB_SIZE_SEC[div];
      if (d.reverbConv && this.ctx && size !== d.reverbSizeSec) {
        d.reverbConv.buffer = buildReverbImpulse(this.ctx, size);
        d.reverbSizeSec = size;
      }
      this.rampParam(d.reverbSendGain?.gain, Math.sqrt(level) * 0.9);
      return;
    }

    // Flanger: one full sweep every 2 (1/4) to 8 (1/1) beats.
    const cycleSec = beatSec * divMult * 8;
    this.rampParam(d.flangerLfo?.frequency, clamp(1 / cycleSec, 0.05, 4), 0.05);
    this.rampParam(d.flangerSendGain?.gain, level * 0.85);
    this.rampParam(d.fxDry?.gain, 1 - level * 0.35);
  }

  /** Smooth parameter moves (no zipper noise or clicks while turning a control). */
  private rampParam(param: AudioParam | undefined, value: number, timeConstant = 0.025): void {
    if (!param) return;
    if (this.ctx && typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
    } else {
      param.value = value;
    }
  }

  getDeckFx(deck: DeckId, fx: AudioFxId): { enabled: boolean; wet: number } {
    return { ...this.getDeckOrThrow(deck).fxState[fx] };
  }

  getDeckFxBeatDiv(deck: DeckId, fx: AudioFxId): FxBeatDivision {
    return this.getDeckOrThrow(deck).fxBeatDiv[fx];
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

  private readAnalyserRms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const normalized = (buf[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
    return clamp(rms * 2.4, 0, 1);
  }

  readVuLevel(target: DeckId | 'MASTER'): number {
    if (!this.decks || !this.masterAnalyser) return 0;
    const analyser = target === 'MASTER' ? this.masterAnalyser : this.decks[target].analyser;
    const buf =
      target === 'MASTER' ? this.masterTimeDomainBuf : this.decks[target].timeDomainBuf;
    return this.readAnalyserRms(analyser, buf);
  }

  readStereoVuLevels(target: DeckId | 'MASTER'): [number, number] {
    if (!this.decks || !this.masterAnalyser) return [0, 0];
    if (target === 'MASTER') {
      if (this.masterAnalyserL && this.masterAnalyserR) {
        return [
          this.readAnalyserRms(this.masterAnalyserL, this.masterBufL),
          this.readAnalyserRms(this.masterAnalyserR, this.masterBufR)
        ];
      }
      const mono = this.readVuLevel('MASTER');
      return [mono, mono];
    }
    const d = this.decks[target];
    if (d.analyserL && d.analyserR) {
      return [
        this.readAnalyserRms(d.analyserL, d.timeDomainBufL),
        this.readAnalyserRms(d.analyserR, d.timeDomainBufR)
      ];
    }
    const mono = this.readVuLevel(target);
    return [mono, mono];
  }

  readMasterSpectrum(): Uint8Array | null {
    if (!this.masterAnalyser || !this.masterSpectrumBuf) return null;
    this.masterAnalyser.getByteFrequencyData(this.masterSpectrumBuf);
    return this.masterSpectrumBuf;
  }

  getDeckAnalyser(deck: DeckId): AnalyserNode | null {
    return this.decks ? this.decks[deck].analyser : null;
  }

  getMasterAnalyser(): AnalyserNode | null {
    return this.masterAnalyser;
  }

  getDeckKeyAnalyser(deck: DeckId): AnalyserNode | null {
    return this.decks ? this.decks[deck].keyAnalyser : null;
  }

  getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  private recordDest: MediaStreamAudioDestinationNode | null = null;

  /** Post-limiter master mix (never the headphone split) for mix recording. */
  getRecordingStream(): MediaStream | null {
    if (!this.ctx || !this.masterAnalyser) return null;
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.masterAnalyser.connect(this.recordDest);
    }
    return this.recordDest.stream;
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

