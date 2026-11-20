import { useState, type MutableRefObject, type ReactElement } from 'react';
import { Play, Pause, RotateCcw, Headphones, Sparkles } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { AudioFxId, SamplerPadId } from '../audio/AudioDspEngine';
import { useDeckStore } from '../store/useDeckStore';
import { JogWheel } from './ui/JogWheel';
import { RgbWaveformStrip, type RgbWaveSample } from './ui/RgbWaveformStrip';

type PadMode = 'hot-cue' | 'loop-roll' | 'beat-jump' | 'sampler' | 'audio-fx';

const PAD_MODES: Array<{ id: PadMode; label: string }> = [
  { id: 'hot-cue', label: 'HOT CUE' },
  { id: 'loop-roll', label: 'ROLL' },
  { id: 'beat-jump', label: 'JUMP' },
  { id: 'sampler', label: 'SAMPLER' },
  { id: 'audio-fx', label: 'FX' }
];

const SAMPLER_PADS: Array<{ id: SamplerPadId; label: string; color: string }> = [
  { id: 'airhorn', label: 'Airhorn', color: '#F97316' },
  { id: 'riser', label: 'Riser', color: '#00D4FF' },
  { id: 'sub-drop', label: 'Sub Drop', color: '#8B5CF6' },
  { id: 'clap', label: 'Clap', color: '#10B981' },
  { id: 'laser', label: 'Laser', color: '#EC4899' },
  { id: 'siren', label: 'Siren', color: '#EAB308' },
  { id: 'kick', label: 'Kick', color: '#EF4444' },
  { id: 'hihat', label: 'HiHat', color: '#38BDF8' }
];

const BEAT_JUMPS = [-16, -8, -4, -1, 1, 4, 8, 16] as const;
const ROLL_BEATS: Array<0.25 | 0.5 | 1 | 2 | 4> = [0.25, 0.5, 1, 2, 4];

interface DeckPanelProps {
  deckId: DeckId;
  onTogglePlay: (deck: DeckId) => void;
  onSeek: (deck: DeckId, timeSec: number) => void;
  onToggleCueMonitor: (deck: DeckId) => void;
  onPitchChange: (deck: DeckId, pitchPercent: number, keyLock: boolean) => void;
  onHotCueTrigger: (deck: DeckId, slot: number) => void;
  onHotCueClear: (deck: DeckId, slot: number) => void;
  onAutoLoop: (deck: DeckId, beats: 0.5 | 1 | 2 | 4 | 8 | 16) => void;
  onToggleLoopExit: (deck: DeckId) => void;
  onLoopIn: (deck: DeckId) => void;
  onLoopOut: (deck: DeckId) => void;
  onTapBpm: (deck: DeckId) => void;
  onAdjustBpmHalfDouble: (deck: DeckId, factor: 0.5 | 2) => void;
  onSync: (deck: DeckId) => void;
  onCueDown?: (deck: DeckId) => void;
  onCueUp?: (deck: DeckId) => void;
  onJogNudge?: (deck: DeckId, multiplier: number) => void;
  onJogScrub?: (deck: DeckId, deltaSec: number) => void;
  onBrake?: (deck: DeckId) => void;
  onBeatJump?: (deck: DeckId, beats: number) => void;
  onLoopRollStart?: (deck: DeckId, beats: 0.25 | 0.5 | 1 | 2 | 4) => void;
  onLoopRollEnd?: (deck: DeckId) => void;
  onTriggerSample?: (pad: SamplerPadId) => void;
  onDeckFxChange?: (deck: DeckId, fx: AudioFxId, enabled: boolean, wet: number) => void;
  liveRgbRef?: MutableRefObject<Record<DeckId, RgbWaveSample[]>>;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function DeckPanel({
  deckId,
  onTogglePlay,
  onSeek,
  onToggleCueMonitor,
  onPitchChange,
  onHotCueTrigger,
  onHotCueClear,
  onAutoLoop,
  onToggleLoopExit,
  onLoopIn,
  onLoopOut,
  onTapBpm,
  onAdjustBpmHalfDouble,
  onSync,
  onCueDown,
  onCueUp,
  onJogNudge = () => {},
  onJogScrub = () => {},
  onBrake = () => {},
  onBeatJump = () => {},
  onLoopRollStart = () => {},
  onLoopRollEnd = () => {},
  onTriggerSample = () => {},
  onDeckFxChange = () => {},
  liveRgbRef
}: DeckPanelProps): ReactElement {
  const deck = useDeckStore((s) => s.decks[deckId]);
  const setDeckPatch = useDeckStore((s) => s.setDeckPatch);
  const [padMode, setPadMode] = useState<PadMode>('hot-cue');

  const accent = deckId === 'A' ? '#00D4FF' : '#FF8A00';
  const remaining = Math.max(0, deck.durationSec - deck.currentTimeSec);
  const isNearEnd = deck.playing && deck.durationSec > 20 && remaining <= 15;
  const effectiveBpm = deck.bpm ? Number((deck.bpm * (1 + deck.pitchPercent / 100)).toFixed(1)) : null;

  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-[#1F2937] bg-[#0F141D] p-2.5 shadow-lg"
      aria-label={`Deck ${deckId}`}
    >
      {/* Header: Track info + BPM + Clocks */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-extrabold text-[#07090E]"
            style={{ backgroundColor: accent }}
          >
            {deckId}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#F8FAFC]">
              {deck.track ? deck.track.title : 'Sin pista cargada'}
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[#94A3B8]">
              <span className="truncate">
                {deck.track ? deck.track.channel : 'Carga un video del buscador o cola'}
              </span>
              {deck.autoGainDb !== 0 ? (
                <span className="shrink-0 rounded bg-[#161E2B] px-1 py-0.2 font-mono-tabular text-[10px] text-[#10B981]">
                  {deck.autoGainDb > 0 ? `+${deck.autoGainDb.toFixed(1)}` : deck.autoGainDb.toFixed(1)} dB
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[#1F2937] bg-[#07090E] px-2 py-1 text-xs">
            <span className="font-mono-tabular font-semibold text-[#F8FAFC]">
              {effectiveBpm ? effectiveBpm.toFixed(1) : '--.-'}
            </span>
            <span className="text-[10px] text-[#64748B]">BPM</span>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 0.5)}
              className="rounded px-1 text-[10px] text-[#94A3B8] hover:text-white cursor-pointer"
              title="Mitad BPM"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 2)}
              className="rounded px-1 text-[10px] text-[#94A3B8] hover:text-white cursor-pointer"
              title="Doble BPM"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={() => onTapBpm(deckId)}
              className="rounded border border-[#1F2937] bg-[#161E2B] px-1.5 py-0.5 text-[10px] font-semibold text-[#F8FAFC] cursor-pointer"
            >
              TAP
            </button>
            <button
              type="button"
              onClick={() => onSync(deckId)}
              className="rounded border border-[#10B981]/50 bg-[#10B981]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#6EE7B7] cursor-pointer"
            >
              SYNC
            </button>
          </div>

          <div className="text-right font-mono-tabular">
            <div className="text-xs font-semibold text-[#F8FAFC]">{formatTime(deck.currentTimeSec)}</div>
            <div className={`text-[10px] ${isNearEnd ? 'font-bold text-[#FCA5A5]' : 'text-[#94A3B8]'}`}>
              -{formatTime(remaining)}
            </div>
          </div>
        </div>
      </header>

      {/* Dual RGB Live + Overview Waveform */}
      <div className="relative">
        <RgbWaveformStrip
          deckId={deckId}
          accentColor={accent}
          playing={deck.playing}
          currentTimeSec={deck.currentTimeSec}
          durationSec={deck.durationSec}
          waveformPeaks={deck.waveformPeaks}
          hotCues={deck.hotCues}
          loop={deck.loop}
          liveRgbRef={liveRgbRef}
          onSeek={(t) => onSeek(deckId, t)}
        />
        {deck.loading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/75 text-xs font-medium text-[#00D4FF]">
            Cargando stream en RAM...
          </div>
        ) : null}
        {deck.error ? (
          <div className="mt-1 rounded bg-[#EF4444]/90 px-2 py-1 text-xs text-white">
            {deck.error}
          </div>
        ) : null}
      </div>

      {/* Platter + Transport + Pitch / Loops */}
      <div className="flex items-center justify-between gap-2.5">
        <JogWheel
          deckId={deckId}
          playing={deck.playing}
          currentTimeSec={deck.currentTimeSec}
          durationSec={deck.durationSec}
          thumbnailUrl={deck.track?.thumbnailUrl}
          accentColor={accent}
          onNudge={(m) => onJogNudge(deckId, m)}
          onScrubDelta={(d) => onJogScrub(deckId, d)}
          onBrake={() => onBrake(deckId)}
        />

        <div className="flex flex-1 flex-col gap-2">
          {/* Transport + Pitch row */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!deck.track || deck.loading}
                onClick={() => onTogglePlay(deckId)}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-bold text-[#07090E] disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: deck.playing ? '#10B981' : accent }}
              >
                {deck.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {deck.playing ? 'Pausa' : 'Play'}
              </button>

              <button
                type="button"
                disabled={!deck.track}
                onPointerDown={() => (onCueDown ? onCueDown(deckId) : onSeek(deckId, 0))}
                onPointerUp={() => onCueUp?.(deckId)}
                onPointerLeave={() => onCueUp?.(deckId)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 text-xs font-semibold text-[#FCD34D] hover:bg-[#F59E0B]/20 disabled:opacity-40 cursor-pointer"
                title="Clic en pausa para fijar Cue, mantener en Cue para preescucha o en Play para regresar al Cue"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Cue
              </button>

              <button
                type="button"
                onClick={() => onToggleCueMonitor(deckId)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                  deck.cueEnabled
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#DDD6FE]'
                    : 'border-[#1F2937] bg-[#090C12] text-[#94A3B8] hover:text-white'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" />
                PFL
              </button>
            </div>

            <div className="flex items-center gap-1.5 rounded-md border border-[#1F2937] bg-[#090C12] px-2 py-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  const nextRange = deck.pitchRange === 8 ? 16 : deck.pitchRange === 16 ? 50 : 8;
                  setDeckPatch(deckId, { pitchRange: nextRange });
                }}
                className="rounded border border-[#1F2937] bg-[#161E2B] px-1.5 py-0.5 text-[10px] text-[#94A3B8] cursor-pointer"
              >
                ±{deck.pitchRange}%
              </button>
              <span className="w-11 text-right font-mono-tabular text-[11px] text-[#F8FAFC]">
                {deck.pitchPercent >= 0 ? '+' : ''}
                {deck.pitchPercent.toFixed(1)}%
              </span>
              <input
                type="range"
                min={-deck.pitchRange}
                max={deck.pitchRange}
                step={0.1}
                value={deck.pitchPercent}
                onChange={(e) => onPitchChange(deckId, Number(e.target.value), deck.keyLock)}
                onDoubleClick={() => onPitchChange(deckId, 0, deck.keyLock)}
                className="w-16 accent-[#00D4FF] cursor-pointer"
                aria-label={`Pitch Deck ${deckId}`}
              />
              <button
                type="button"
                onClick={() => onPitchChange(deckId, deck.pitchPercent, !deck.keyLock)}
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${
                  deck.keyLock
                    ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                    : 'border-[#1F2937] bg-[#161E2B] text-[#94A3B8]'
                }`}
              >
                Key
              </button>
            </div>
          </div>

          {/* Loop quick strip */}
          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onLoopIn(deckId)}
                className="rounded border border-[#1F2937] bg-[#090C12] px-2 py-0.5 text-[#94A3B8] hover:text-white cursor-pointer"
              >
                IN
              </button>
              <button
                type="button"
                onClick={() => onLoopOut(deckId)}
                className="rounded border border-[#1F2937] bg-[#090C12] px-2 py-0.5 text-[#94A3B8] hover:text-white cursor-pointer"
              >
                OUT
              </button>
              <button
                type="button"
                onClick={() => onToggleLoopExit(deckId)}
                className={`rounded border px-2 py-0.5 font-semibold cursor-pointer ${
                  deck.loop?.active
                    ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                    : 'border-[#1F2937] bg-[#090C12] text-[#94A3B8]'
                }`}
              >
                LOOP
              </button>
            </div>

            <div className="flex items-center gap-1">
              {([1, 2, 4, 8] as const).map((beats) => (
                <button
                  key={beats}
                  type="button"
                  aria-label={`Loop ${beats}`}
                  onClick={() => onAutoLoop(deckId, beats)}
                  className={`rounded border px-2 py-0.5 font-mono-tabular cursor-pointer ${
                    deck.loop?.active && deck.loop.beats === beats
                      ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                      : 'border-[#1F2937] bg-[#090C12] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {beats}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Mode Performance Pads */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[#1F2937] bg-[#090C12] p-1.5">
        <div className="flex items-center justify-between gap-1">
          {PAD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPadMode(m.id)}
              className={`flex-1 rounded py-0.5 text-[10px] font-bold tracking-wide cursor-pointer ${
                padMode === m.id
                  ? 'bg-[#161E2B] text-[#F8FAFC] border border-[#334155]'
                  : 'text-[#64748B] hover:text-[#CBD5E1]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {padMode === 'hot-cue' ? (
          <div className="grid grid-cols-8 gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => {
              const cue = deck.hotCues.find((c) => c.slot === slot);
              return (
                <button
                  key={slot}
                  type="button"
                  aria-label={`Hot Cue ${slot}`}
                  onClick={(e) => {
                    if (e.shiftKey && cue) {
                      onHotCueClear(deckId, slot);
                    } else {
                      onHotCueTrigger(deckId, slot);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onHotCueClear(deckId, slot);
                  }}
                  title={
                    cue
                      ? `Cue ${slot}: ${formatTime(cue.timeSec)} (Shift+Clic o Clic derecho para borrar)`
                      : `Guardar Hot Cue ${slot}`
                  }
                  className="rounded border py-1 text-[11px] font-mono-tabular font-semibold cursor-pointer"
                  style={{
                    borderColor: cue ? cue.color : '#1F2937',
                    backgroundColor: cue ? `${cue.color}28` : '#0F141D',
                    color: cue ? '#F8FAFC' : '#64748B'
                  }}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        ) : null}

        {padMode === 'loop-roll' ? (
          <div className="grid grid-cols-5 gap-1">
            {ROLL_BEATS.map((beats) => (
              <button
                key={beats}
                type="button"
                disabled={!deck.track}
                onPointerDown={() => onLoopRollStart(deckId, beats)}
                onPointerUp={() => onLoopRollEnd(deckId)}
                onPointerLeave={() => onLoopRollEnd(deckId)}
                className="rounded border border-[#8B5CF6]/40 bg-[#0F141D] py-1 text-[11px] font-mono-tabular font-semibold text-[#DDD6FE] hover:bg-[#8B5CF6]/25 disabled:opacity-40 cursor-pointer"
              >
                {beats}b Roll
              </button>
            ))}
          </div>
        ) : null}

        {padMode === 'beat-jump' ? (
          <div className="grid grid-cols-8 gap-1">
            {BEAT_JUMPS.map((beats) => (
              <button
                key={beats}
                type="button"
                disabled={!deck.track}
                onClick={() => onBeatJump(deckId, beats)}
                className="rounded border border-[#00D4FF]/30 bg-[#0F141D] py-1 text-[10px] font-mono-tabular font-semibold text-[#CBD5E1] hover:border-[#00D4FF] hover:text-white disabled:opacity-40 cursor-pointer"
              >
                {beats > 0 ? `+${beats}` : beats}
              </button>
            ))}
          </div>
        ) : null}

        {padMode === 'sampler' ? (
          <div className="grid grid-cols-4 gap-1">
            {SAMPLER_PADS.map((pad) => (
              <button
                key={pad.id}
                type="button"
                onClick={() => onTriggerSample(pad.id)}
                className="rounded border py-1 text-[10px] font-semibold cursor-pointer"
                style={{
                  borderColor: `${pad.color}66`,
                  backgroundColor: `${pad.color}18`,
                  color: '#F8FAFC'
                }}
              >
                {pad.label}
              </button>
            ))}
          </div>
        ) : null}

        {padMode === 'audio-fx' ? (
          <div className="grid grid-cols-3 gap-1.5">
            {(['echo', 'reverb', 'flanger'] as AudioFxId[]).map((fx) => {
              const st = deck.audioFx[fx];
              return (
                <div
                  key={fx}
                  className="flex flex-col gap-1 rounded border border-[#1F2937] bg-[#0F141D] px-2 py-1"
                >
                  <button
                    type="button"
                    onClick={() => onDeckFxChange(deckId, fx, !st.enabled, st.wet)}
                    className={`inline-flex items-center justify-center gap-1 rounded border py-0.5 text-[10px] font-bold uppercase cursor-pointer ${
                      st.enabled
                        ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                        : 'border-[#1F2937] text-[#94A3B8]'
                    }`}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {fx}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={st.wet}
                    onChange={(e) => onDeckFxChange(deckId, fx, st.enabled, Number(e.target.value))}
                    aria-label={`${fx} Mix Deck ${deckId}`}
                    className="w-full accent-[#10B981] cursor-pointer"
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
