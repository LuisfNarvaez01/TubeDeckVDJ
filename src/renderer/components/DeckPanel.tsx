import { useEffect, useState, type MutableRefObject, type ReactElement } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Headphones,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Pencil
} from 'lucide-react';
import type { DeckId, VideoQualityTier } from '../../shared/types';
import type { AudioFxId, FxBeatDivision, SamplerPadId } from '../audio/AudioDspEngine';
import { useDeckStore } from '../store/useDeckStore';
import { cleanTrackTitleForOsd } from '../video/OverlayCompositor';
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

const SAMPLER_PADS: Array<{ id: SamplerPadId; label: string }> = [
  { id: 'airhorn', label: 'Airhorn' },
  { id: 'riser', label: 'Riser' },
  { id: 'sub-drop', label: 'Sub Drop' },
  { id: 'clap', label: 'Clap' },
  { id: 'laser', label: 'Laser' },
  { id: 'siren', label: 'Siren' },
  { id: 'kick', label: 'Kick' },
  { id: 'hihat', label: 'HiHat' }
];

const BEAT_JUMPS = [-16, -8, -4, -1, 1, 4, 8, 16] as const;
const ROLL_BEATS: Array<0.25 | 0.5 | 1 | 2 | 4> = [0.25, 0.5, 1, 2, 4];

interface DeckPanelProps {
  deckId: DeckId;
  activeQuality?: VideoQualityTier | null;
  showHotkeys?: boolean;
  onTogglePlay: (deck: DeckId) => void;
  onSeek: (deck: DeckId, timeSec: number) => void;
  onToggleCueMonitor: (deck: DeckId) => void;
  onPitchChange: (deck: DeckId, pitchPercent: number, keyLock: boolean) => void;
  onKeyShiftChange?: (deck: DeckId, semitones: number) => void;
  onCustomOsdTitleChange?: (deck: DeckId, customTitle: string | null) => void;
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
  onDeckFxChange?: (
    deck: DeckId,
    fx: AudioFxId,
    enabled: boolean,
    wet: number,
    beatDiv?: FxBeatDivision
  ) => void;
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
  activeQuality = null,
  showHotkeys = false,
  onTogglePlay,
  onSeek,
  onToggleCueMonitor,
  onPitchChange,
  onKeyShiftChange = () => {},
  onCustomOsdTitleChange = () => {},
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
  const [flashingPad, setFlashingPad] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    setEditingTitle(false);
  }, [deck.track?.videoId]);

  const accent = deckId === 'A' ? '#0EA5E9' : '#F59E0B';
  const remaining = Math.max(0, deck.durationSec - deck.currentTimeSec);
  const isNearEnd = deck.playing && deck.durationSec > 20 && remaining <= 15;
  const effectiveBpm = deck.bpm ? Number((deck.bpm * (1 + deck.pitchPercent / 100)).toFixed(1)) : null;
  const padModeIndex = Math.max(
    0,
    PAD_MODES.findIndex((m) => m.id === padMode)
  );

  const displayTitle = deck.track
    ? deck.customOsdTitle ?? cleanTrackTitleForOsd(deck.track.title)
    : 'Sin pista cargada';

  const healthLabel = !deck.track
    ? null
    : deck.track.source === 'local'
      ? deck.track.mediaKind === 'audio'
        ? 'AUDIO LOCAL'
        : 'LOCAL'
      : activeQuality ?? 'HD';

  const triggerPadFlash = (key: string) => {
    setFlashingPad(key);
    window.setTimeout(() => {
      setFlashingPad((cur) => (cur === key ? null : cur));
    }, 180);
  };

  const commitTitleEdit = () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    const cleanedOrig = deck.track ? cleanTrackTitleForOsd(deck.track.title) : '';
    const nextCustom = !trimmed || trimmed === cleanedOrig ? null : trimmed;
    setDeckPatch(deckId, { customOsdTitle: nextCustom });
    onCustomOsdTitleChange(deckId, nextCustom);
  };

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/[0.06] bg-[#0F1117] p-2.5"
      aria-label={`Deck ${deckId}`}
    >
      {/* Header: Identity + OSD Editable Title + Stream Health + BPM + Clocks */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-extrabold text-[#08090C]"
            style={{ backgroundColor: accent }}
          >
            {deckId}
          </span>
          <div className="min-w-0 flex-1">
            {editingTitle && deck.track ? (
              <input
                type="text"
                autoFocus
                aria-label={`Editar título OSD Deck ${deckId}`}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitleEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitleEdit();
                  else if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="w-full rounded border border-white/[0.16] bg-[#08090C] px-1.5 py-0.5 text-xs font-semibold text-[#F8FAFC] focus:outline-none"
              />
            ) : (
              <p
                onDoubleClick={() => {
                  if (!deck.track) return;
                  setDraftTitle(displayTitle);
                  setEditingTitle(true);
                }}
                title={
                  deck.track
                    ? `${deck.track.title} (Doble clic para editar título OSD en Pantalla 2)`
                    : 'Sin pista cargada'
                }
                className="group/title flex cursor-text items-center gap-1 truncate text-sm font-semibold text-[#F8FAFC]"
              >
                <span className="truncate">{displayTitle}</span>
                {deck.track ? (
                  <Pencil className="h-2.5 w-2.5 shrink-0 text-[#64748B] opacity-0 group-hover/title:opacity-100" />
                ) : null}
              </p>
            )}

            <div className="flex items-center gap-2 text-[10px] text-[#94A3B8]">
              <span className="truncate">
                {deck.track ? deck.track.channel : 'Carga un video del buscador o cola'}
              </span>

              {healthLabel ? (
                <div
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/[0.06] bg-[#08090C] px-1.5 py-0.5"
                  title={`Resolución: ${healthLabel} • Buffer RAM: ${Math.round(deck.bufferRatio * 100)}%`}
                >
                  <span className="font-mono-tabular text-[9px] font-semibold text-[#CBD5E1]">
                    {healthLabel}
                  </span>
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-[#151821]">
                    <span
                      className="block h-full rounded-full transition-all duration-150"
                      style={{
                        width: `${Math.round(deck.bufferRatio * 100)}%`,
                        backgroundColor: accent
                      }}
                    />
                  </span>
                </div>
              ) : null}

              {deck.autoGainDb !== 0 ? (
                <span className="shrink-0 rounded border border-white/[0.06] bg-[#151821] px-1 font-mono-tabular text-[9px] text-[#CBD5E1]">
                  {deck.autoGainDb > 0
                    ? `+${deck.autoGainDb.toFixed(1)}`
                    : deck.autoGainDb.toFixed(1)}{' '}
                  dB
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#08090C] px-2 py-1 text-xs">
            <span className="font-mono-tabular font-semibold text-[#F8FAFC]">
              {effectiveBpm ? effectiveBpm.toFixed(1) : '--.-'}
            </span>
            <span className="text-[10px] text-[#64748B]">BPM</span>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 0.5)}
              className="rounded px-1 text-[10px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              title="Mitad BPM"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 2)}
              className="rounded px-1 text-[10px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              title="Doble BPM"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={() => onTapBpm(deckId)}
              className="rounded border border-white/[0.06] bg-[#151821] px-1.5 py-0.5 text-[10px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] cursor-pointer"
            >
              TAP
            </button>
            <button
              type="button"
              onClick={() => onSync(deckId)}
              className={`relative rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${
                deck.synced
                  ? 'border-[#10B981]/60 bg-[#10B981]/20 text-[#10B981]'
                  : 'border-white/[0.08] bg-[#151821] text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC]'
              }`}
            >
              SYNC
              {showHotkeys ? (
                <span className="hardware-keycap pointer-events-none absolute -top-2.5 -right-1 rounded px-1 text-[8px]">
                  {deckId === 'A' ? 'S' : '⇧S'}
                </span>
              ) : null}
            </button>
          </div>

          <div className="text-right font-mono-tabular">
            <div className="text-xs font-semibold text-[#F8FAFC]">
              {formatTime(deck.currentTimeSec)}
            </div>
            <div
              className={`text-[10px] ${
                isNearEnd ? 'font-bold text-[#EF4444]' : 'text-[#94A3B8]'
              }`}
            >
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
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/80 text-xs font-medium text-[#CBD5E1]">
            Cargando stream en RAM...
          </div>
        ) : null}
        {deck.error ? (
          <div className="mt-1 rounded border border-[#EF4444]/40 bg-[#EF4444]/15 px-2 py-1 text-xs text-[#FCA5A5]">
            {deck.error}
          </div>
        ) : null}
      </div>

      {/* Platter + Transport + Pitch / Key Shift / Loops */}
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

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Transport + Tempo/Key Strip */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!deck.track || deck.loading}
                onClick={() => onTogglePlay(deckId)}
                className="relative inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-bold text-[#08090C] disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: deck.playing ? '#10B981' : accent }}
              >
                {deck.playing ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {deck.playing ? 'Pausa' : 'Play'}
                {showHotkeys ? (
                  <span className="hardware-keycap pointer-events-none absolute -top-2 right-0 rounded px-1 text-[8px]">
                    {deckId === 'A' ? 'SPC' : '⇧SPC'}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                disabled={!deck.track}
                onPointerDown={() => (onCueDown ? onCueDown(deckId) : onSeek(deckId, 0))}
                onPointerUp={() => onCueUp?.(deckId)}
                onPointerLeave={() => onCueUp?.(deckId)}
                className="relative inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.1] bg-[#151821] px-2.5 text-xs font-semibold text-[#F8FAFC] hover:bg-[#1C202B] disabled:opacity-40 cursor-pointer"
                title="Clic en pausa para fijar Cue, mantener en Cue para preescucha o en Play para regresar al Cue"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#CBD5E1]" />
                Cue
                {showHotkeys ? (
                  <span className="hardware-keycap pointer-events-none absolute -top-2 right-0 rounded px-1 text-[8px]">
                    {deckId === 'A' ? 'Q' : 'W'}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => onToggleCueMonitor(deckId)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                  deck.cueEnabled
                    ? 'border-white/35 bg-[#1C202B] text-[#F8FAFC] ring-1 ring-white/20'
                    : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" />
                PFL
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#08090C] px-1.5 py-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  const nextRange =
                    deck.pitchRange === 8 ? 16 : deck.pitchRange === 16 ? 50 : 8;
                  setDeckPatch(deckId, { pitchRange: nextRange });
                }}
                className="rounded border border-white/[0.06] bg-[#151821] px-1 py-0.5 font-mono-tabular text-[10px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              >
                ±{deck.pitchRange}%
              </button>
              <button
                type="button"
                aria-label={`Nudge - Deck ${deckId}`}
                onPointerDown={() => onJogNudge(deckId, 0.96)}
                onPointerUp={() => onJogNudge(deckId, 1)}
                onPointerLeave={() => onJogNudge(deckId, 1)}
                className="rounded border border-white/[0.06] bg-[#151821] px-1 py-0.5 text-[9px] font-bold text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                title="Nudge - (Atrasar fase)"
              >
                N-
              </button>
              <input
                type="range"
                min={-deck.pitchRange}
                max={deck.pitchRange}
                step={0.1}
                value={deck.pitchPercent}
                onChange={(e) => onPitchChange(deckId, Number(e.target.value), deck.keyLock)}
                onDoubleClick={() => onPitchChange(deckId, 0, deck.keyLock)}
                className="w-16 accent-[#E2E8F0] cursor-pointer"
                aria-label={`Pitch Deck ${deckId}`}
              />
              <button
                type="button"
                aria-label={`Nudge + Deck ${deckId}`}
                onPointerDown={() => onJogNudge(deckId, 1.04)}
                onPointerUp={() => onJogNudge(deckId, 1)}
                onPointerLeave={() => onJogNudge(deckId, 1)}
                className="rounded border border-white/[0.06] bg-[#151821] px-1 py-0.5 text-[9px] font-bold text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                title="Nudge + (Adelantar fase)"
              >
                N+
              </button>
              <span className="w-11 text-right font-mono-tabular text-[10px] text-[#F8FAFC]">
                {deck.pitchPercent >= 0 ? '+' : ''}
                {deck.pitchPercent.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Loop strip + Key (Master Tempo) & Key Shift (-6..+6 st) */}
          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onLoopIn(deckId)}
                className="rounded border border-white/[0.06] bg-[#151821] px-1.5 py-0.5 text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
              >
                IN
              </button>
              <button
                type="button"
                onClick={() => onLoopOut(deckId)}
                className="rounded border border-white/[0.06] bg-[#151821] px-1.5 py-0.5 text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
              >
                OUT
              </button>
              <button
                type="button"
                onClick={() => onToggleLoopExit(deckId)}
                className={`rounded border px-2 py-0.5 font-semibold cursor-pointer ${
                  deck.loop?.active
                    ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                    : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
                }`}
              >
                LOOP
              </button>
              {([1, 2, 4, 8] as const).map((beats) => (
                <button
                  key={beats}
                  type="button"
                  aria-label={`Loop ${beats}`}
                  onClick={() => onAutoLoop(deckId, beats)}
                  className={`rounded border px-1.5 py-0.5 font-mono-tabular cursor-pointer ${
                    deck.loop?.active && deck.loop.beats === beats
                      ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                      : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC]'
                  }`}
                >
                  {beats}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded border border-white/[0.06] bg-[#08090C] px-1.5 py-0.5">
              <button
                type="button"
                onClick={() => onPitchChange(deckId, deck.pitchPercent, !deck.keyLock)}
                className={`rounded border px-1.5 py-0.2 text-[10px] font-semibold cursor-pointer ${
                  deck.keyLock
                    ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                    : 'border-white/[0.06] bg-[#151821] text-[#64748B]'
                }`}
                title="Master Tempo (mantiene tono al cambiar BPM)"
              >
                Key
              </button>
              <button
                type="button"
                aria-label={`Key Shift - Deck ${deckId}`}
                onClick={() =>
                  onKeyShiftChange(deckId, Math.max(-6, deck.keyShiftSemitones - 1))
                }
                className="rounded p-0.5 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                title="Bajar 1 semitono"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onKeyShiftChange(deckId, 0)}
                className="min-w-8 text-center font-mono-tabular text-[10px] text-[#CBD5E1] cursor-pointer"
                title="Reiniciar Key Shift"
              >
                {deck.keyShiftSemitones > 0
                  ? `+${deck.keyShiftSemitones}`
                  : deck.keyShiftSemitones}
                st
              </button>
              <button
                type="button"
                aria-label={`Key Shift + Deck ${deckId}`}
                onClick={() =>
                  onKeyShiftChange(deckId, Math.min(6, deck.keyShiftSemitones + 1))
                }
                className="rounded p-0.5 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                title="Subir 1 semitono"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Mode 44px Tactile Performance Pads with Animated Sliding Pill */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-[#08090C] p-1.5">
        <div className="relative grid grid-cols-5 rounded-md bg-[#0F1117] p-0.5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded bg-[#1C202B] ring-1 ring-white/[0.12] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: 'calc(20% - 2px)',
              transform: `translateX(${padModeIndex * 100}%)`
            }}
          />
          {PAD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPadMode(m.id)}
              className={`relative z-10 rounded py-0.5 text-[10px] font-bold tracking-wide cursor-pointer ${
                padMode === m.id ? 'text-[#F8FAFC]' : 'text-[#64748B] hover:text-[#CBD5E1]'
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
              const flashKey = `${deckId}-hc-${slot}`;
              return (
                <button
                  key={slot}
                  type="button"
                  aria-label={`Hot Cue ${slot}`}
                  onClick={(e) => {
                    triggerPadFlash(flashKey);
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
                  className={`relative flex h-11 flex-col items-center justify-center rounded-md border border-white/[0.06] border-b-2 bg-[#151821] font-mono-tabular text-[11px] font-semibold hover:bg-[#1C202B] cursor-pointer ${
                    flashingPad === flashKey ? 'animate-pad-flash' : ''
                  }`}
                  style={{
                    borderBottomColor: cue ? accent : 'rgba(255,255,255,0.12)',
                    color: cue ? '#F8FAFC' : '#64748B'
                  }}
                >
                  <span>{slot}</span>
                  {cue ? (
                    <span className="text-[8px] font-normal text-[#94A3B8]">
                      {formatTime(cue.timeSec)}
                    </span>
                  ) : null}
                  {showHotkeys ? (
                    <span className="hardware-keycap pointer-events-none absolute top-0.5 right-0.5 rounded px-0.5 text-[7px]">
                      {deckId === 'A' ? slot : `⇧${slot}`}
                    </span>
                  ) : null}
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
                onPointerDown={() => {
                  triggerPadFlash(`${deckId}-roll-${beats}`);
                  onLoopRollStart(deckId, beats);
                }}
                onPointerUp={() => onLoopRollEnd(deckId)}
                onPointerLeave={() => onLoopRollEnd(deckId)}
                className={`h-11 rounded-md border border-white/[0.06] border-b-2 border-b-[#F8FAFC]/35 bg-[#151821] font-mono-tabular text-[11px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] disabled:opacity-40 cursor-pointer ${
                  flashingPad === `${deckId}-roll-${beats}` ? 'animate-pad-flash' : ''
                }`}
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
                onClick={() => {
                  triggerPadFlash(`${deckId}-jump-${beats}`);
                  onBeatJump(deckId, beats);
                }}
                className={`h-11 rounded-md border border-white/[0.06] border-b-2 bg-[#151821] font-mono-tabular text-[11px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] disabled:opacity-40 cursor-pointer ${
                  flashingPad === `${deckId}-jump-${beats}` ? 'animate-pad-flash' : ''
                }`}
                style={{ borderBottomColor: `${accent}88` }}
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
                onClick={() => {
                  triggerPadFlash(`${deckId}-sp-${pad.id}`);
                  onTriggerSample(pad.id);
                }}
                className={`h-11 rounded-md border border-white/[0.06] border-b-2 border-b-white/25 bg-[#151821] text-[10px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer ${
                  flashingPad === `${deckId}-sp-${pad.id}` ? 'animate-pad-flash' : ''
                }`}
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
                  className="flex h-11 items-center gap-1.5 rounded-md border border-white/[0.06] bg-[#151821] px-2"
                >
                  <button
                    type="button"
                    onClick={() => onDeckFxChange(deckId, fx, !st.enabled, st.wet, st.beatDiv)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase cursor-pointer ${
                      st.enabled
                        ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                        : 'border-white/[0.06] bg-[#08090C] text-[#94A3B8]'
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
                    onChange={(e) =>
                      onDeckFxChange(deckId, fx, st.enabled, Number(e.target.value), st.beatDiv)
                    }
                    aria-label={`${fx} Mix Deck ${deckId}`}
                    className="w-full accent-[#E2E8F0] cursor-pointer"
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
