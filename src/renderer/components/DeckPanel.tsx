import { useEffect, useState, type MutableRefObject, type ReactElement } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Headphones,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Eject
} from 'lucide-react';
import type { DeckId, VideoQualityTier } from '../../shared/types';
import type { AudioFxId, FxBeatDivision, SamplerPadId } from '../audio/AudioDspEngine';
import { HARMONIC_LABEL, harmonicMatch, shiftCamelot } from '../dj/HarmonicKey';
import { useDeckStore } from '../store/useDeckStore';
import { isBotCheckMessage } from './YouTubeAccess';
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
  /** Like / dislike the track on this deck to teach the radio. */
  onTrackFeedback?: (deck: DeckId, signal: 'like' | 'dislike') => void;
  /** This deck is audible on the master right now (playing, fader and crossfader open). */
  onAir?: boolean;
  /** The other deck is on air and this one is not: step back identity chrome (never controls). */
  offAirDimmed?: boolean;
  /** Retry loading the current track after a stream error. */
  onRetryLoad?: (deck: DeckId) => void;
  /** Empty the deck (only while it is not on air). */
  onEject?: (deck: DeckId) => void;
  /**
   * full: whole deck in one card. strip: one-line identity + waveform + tempo (the
   * broadcast "camera" row under the program monitor). controls: platter, transport, pads.
   */
  layout?: 'full' | 'strip' | 'controls';
  /** Opens the YouTube sign-in when playback is blocked by the bot check. */
  onConnectYouTube?: () => void;
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
  liveRgbRef,
  onTrackFeedback,
  onAir = false,
  offAirDimmed = false,
  onRetryLoad,
  onEject,
  layout = 'full',
  onConnectYouTube
}: DeckPanelProps): ReactElement {
  const isStrip = layout === 'strip';
  const showIdentity = layout !== 'controls';
  const showPerformance = layout !== 'strip';
  const deck = useDeckStore((s) => s.decks[deckId]);
  const setDeckPatch = useDeckStore((s) => s.setDeckPatch);
  const [padMode, setPadMode] = useState<PadMode>('hot-cue');
  const [flashingPad, setFlashingPad] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const [feedbackGiven, setFeedbackGiven] = useState<'like' | 'dislike' | null>(null);

  useEffect(() => {
    setEditingTitle(false);
    setFeedbackGiven(null);
  }, [deck.track?.videoId]);

  const accent = deckId === 'A' ? '#22E1F0' : '#FF4FA8';
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
      className={`@container relative flex min-w-0 overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isStrip ? 'flex-row items-center gap-3 py-2 pl-3 pr-2.5' : 'flex-col gap-2 p-2.5'
      } ${
        onAir && showIdentity
          ? deckId === 'A'
            ? '-translate-y-px border-deck-a/45 shadow-[0_14px_32px_-16px_rgba(34,225,240,0.45)]'
            : '-translate-y-px border-deck-b/45 shadow-[0_14px_32px_-16px_rgba(255,79,168,0.45)]'
          : 'border-white/[0.06]'
      }`}
      aria-label={layout === 'controls' ? `Controles Deck ${deckId}` : `Deck ${deckId}`}
    >
      {/* Tally light: the broadcast-camera signal of which deck the room is hearing */}
      {deck.track && showIdentity ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute ${isStrip ? 'inset-y-0 left-0 w-[3px]' : 'inset-x-0 top-0 h-[3px]'} transition-[opacity,box-shadow] duration-200 ${
            onAir ? 'opacity-100' : 'opacity-30'
          }`}
          style={{
            backgroundColor: accent,
            boxShadow: onAir ? `0 0 14px 1px ${accent}` : 'none'
          }}
        />
      ) : null}

      {/* Header: Identity + OSD Editable Title + Stream Health + BPM + Clocks */}
      {showIdentity ? (
      <>
      <header className={isStrip ? 'contents' : 'flex items-center justify-between gap-2'}>
        <div
          className={`flex min-w-0 items-center gap-2.5 transition-[opacity,filter] duration-200 ${
            isStrip ? 'order-1 w-[clamp(240px,24%,380px)] flex-none' : 'flex-1'
          } ${
            offAirDimmed ? 'opacity-60 saturate-50' : ''
          }`}
        >
          <div className="relative aspect-video w-[56px] shrink-0 overflow-hidden rounded-md bg-raised @2xl:w-[76px]">
            {deck.track?.thumbnailUrl ? (
              <img src={deck.track.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
            <span
              className="absolute left-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-extrabold text-ground"
              style={{ backgroundColor: accent }}
            >
              {deckId}
            </span>
          </div>
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
                className="w-full rounded border border-white/[0.16] bg-ground px-1.5 py-0.5 text-xs font-semibold text-ink focus:outline-none"
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
                className="group/title flex cursor-text items-center gap-1.5 truncate text-[14px] font-semibold leading-tight text-ink @2xl:text-[17px]"
              >
                <span className={`truncate transition-colors duration-200 ${onAir || !deck.track ? 'text-ink' : 'text-ink-soft'}`}>
                  {displayTitle}
                </span>
                {onAir ? (
                  <span className="shrink-0 rounded bg-live px-1.5 py-px text-[10px] font-bold tracking-wider text-ground">
                    AL AIRE
                  </span>
                ) : null}
                {deck.track ? (
                  <Pencil className="h-2.5 w-2.5 shrink-0 text-faint opacity-0 group-hover/title:opacity-100" />
                ) : null}
              </p>
            )}

            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              <span className="truncate" title={deck.track?.recommendReason}>
                {deck.track ? deck.track.channel : 'Carga un video del buscador o cola'}
              </span>

              {deck.track && deck.track.source !== 'local' && onTrackFeedback ? (
                <div className="inline-flex shrink-0 items-center gap-0.5">
                  {(['like', 'dislike'] as const).map((signal) => {
                    const active = feedbackGiven === signal;
                    const Icon = signal === 'like' ? ThumbsUp : ThumbsDown;
                    return (
                      <button
                        key={signal}
                        type="button"
                        aria-pressed={active}
                        aria-label={signal === 'like' ? 'Me gusta esta canción' : 'No me gusta esta canción'}
                        title={
                          signal === 'like'
                            ? 'Me gusta: la radio pondrá más como esta'
                            : 'No me gusta: la radio la evitará'
                        }
                        onClick={() => {
                          setFeedbackGiven(signal);
                          onTrackFeedback(deckId, signal);
                        }}
                        className={`rounded p-0.5 transition-colors duration-150 cursor-pointer ${
                          active
                            ? signal === 'like'
                              ? 'text-live'
                              : 'text-danger-soft'
                            : 'text-faint hover:text-ink'
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {(deck.track || deck.loading) && onEject ? (
                <button
                  type="button"
                  aria-label={`Quitar canción del deck ${deckId}`}
                  title={
                    onAir
                      ? 'Está sonando al aire: pausa o baja el fader para quitarla'
                      : 'Quitar la canción de este deck'
                  }
                  disabled={onAir}
                  onClick={() => onEject(deckId)}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-faint transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-faint cursor-pointer"
                >
                  <Eject className="h-3 w-3" />
                  <span className="hidden @2xl:inline">Quitar</span>
                </button>
              ) : null}

              {healthLabel ? (
                <div
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/[0.06] bg-ground px-1.5 py-0.5"
                  title={`Resolución: ${healthLabel} • Buffer RAM: ${Math.round(deck.bufferRatio * 100)}%`}
                >
                  <span className="font-mono-tabular text-[10px] font-semibold text-ink-soft">
                    {healthLabel}
                  </span>
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-raised">
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
                <span className="shrink-0 rounded border border-white/[0.06] bg-raised px-1 font-mono-tabular text-[10px] text-ink-soft">
                  {deck.autoGainDb > 0
                    ? `+${deck.autoGainDb.toFixed(1)}`
                    : deck.autoGainDb.toFixed(1)}{' '}
                  dB
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`flex shrink-0 items-center gap-2 ${isStrip ? 'order-3' : ''}`}>
          <KeyBadge deckId={deckId} />
          <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-ground px-2 py-1 text-xs">
            <span className="font-mono-tabular text-[14px] leading-none text-ink @2xl:text-[20px]">
              {effectiveBpm ? effectiveBpm.toFixed(1) : '--.-'}
            </span>
            <span className="text-[10px] text-faint">BPM</span>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 0.5)}
              className="hidden rounded px-1 text-[10px] text-muted hover:text-ink cursor-pointer @2xl:inline"
              title="Mitad BPM"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => onAdjustBpmHalfDouble(deckId, 2)}
              className="hidden rounded px-1 text-[10px] text-muted hover:text-ink cursor-pointer @2xl:inline"
              title="Doble BPM"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={() => onTapBpm(deckId)}
              className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft hover:bg-raised-2 cursor-pointer"
            >
              TAP
            </button>
            <button
              type="button"
              onClick={() => onSync(deckId)}
              className={`relative rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${
                deck.synced
                  ? 'border-live/60 bg-live/20 text-live'
                  : 'border-white/[0.08] bg-raised text-ink-soft hover:bg-raised-2 hover:text-ink'
              }`}
            >
              SYNC
              {showHotkeys ? (
                <span className="hardware-keycap pointer-events-none absolute -top-2.5 -right-1 rounded px-1 text-[10px]">
                  {deckId === 'A' ? 'S' : '⇧S'}
                </span>
              ) : null}
            </button>
          </div>

          <div className="min-w-[64px] text-right font-mono-tabular leading-none @2xl:min-w-[88px]">
            <div className="text-[20px] text-ink @2xl:text-[28px]">{formatTime(deck.currentTimeSec)}</div>
            <div className={`mt-1 text-[13px] ${isNearEnd ? 'font-bold text-danger' : 'text-muted'}`}>
              -{formatTime(remaining)}
            </div>
          </div>
        </div>
      </header>

      {/* Dual RGB Live + Overview Waveform */}
      <div className={`relative ${isStrip ? 'order-2 min-w-0 flex-1' : ''}`}>
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
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/80 text-xs font-medium text-ink-soft">
            Cargando stream en RAM...
          </div>
        ) : null}
        {deck.error && !deck.loading ? (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-ground/95 px-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-danger-soft">
                {isBotCheckMessage(deck.error)
                  ? 'YouTube pidió confirmar que no eres un robot'
                  : 'No se pudo cargar este video'}
              </p>
              <p className="truncate text-[11px] text-muted">
                {isBotCheckMessage(deck.error)
                  ? 'Está bloqueando esta conexión. Conecta tu cuenta de YouTube o espera un rato y reintenta.'
                  : 'YouTube no entregó el stream. Prueba de nuevo o carga otra canción.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-[11px] text-muted hover:text-ink">
                  Detalles
                </summary>
                <p className="absolute right-0 top-7 z-20 w-80 break-words rounded-md border border-white/[0.08] bg-surface p-2 text-[10px] text-muted shadow-xl select-text">
                  {deck.error}
                </p>
              </details>
              {isBotCheckMessage(deck.error) && onConnectYouTube ? (
                <button
                  type="button"
                  onClick={onConnectYouTube}
                  className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-ground hover:bg-ink-2 cursor-pointer"
                >
                  Conectar YouTube
                </button>
              ) : null}
              {onRetryLoad && deck.track ? (
                <button
                  type="button"
                  onClick={() => onRetryLoad(deckId)}
                  className="rounded-md border border-white/[0.1] bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-raised-2 cursor-pointer"
                >
                  Reintentar
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      </>
      ) : null}

      {showPerformance ? (
      <>
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
                className="relative inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-bold text-ground disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: deck.playing ? '#F0FDFF' : accent }}
              >
                {deck.playing ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {deck.playing ? 'Pausa' : 'Play'}
                {showHotkeys ? (
                  <span className="hardware-keycap pointer-events-none absolute -top-2 right-0 rounded px-1 text-[10px]">
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
                className="relative inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.1] bg-raised px-2.5 text-xs font-semibold text-ink hover:bg-raised-2 disabled:opacity-40 cursor-pointer"
                title="Clic en pausa para fijar Cue, mantener en Cue para preescucha o en Play para regresar al Cue"
              >
                <RotateCcw className="h-3.5 w-3.5 text-ink-soft" />
                Cue
                {showHotkeys ? (
                  <span className="hardware-keycap pointer-events-none absolute -top-2 right-0 rounded px-1 text-[10px]">
                    {deckId === 'A' ? 'Q' : 'W'}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => onToggleCueMonitor(deckId)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                  deck.cueEnabled
                    ? 'border-white/35 bg-raised-2 text-ink ring-1 ring-white/20'
                    : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" />
                PFL
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-ground px-1.5 py-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  const nextRange =
                    deck.pitchRange === 8 ? 16 : deck.pitchRange === 16 ? 50 : 8;
                  setDeckPatch(deckId, { pitchRange: nextRange });
                }}
                className="rounded border border-white/[0.06] bg-raised px-1 py-0.5 font-mono-tabular text-[10px] text-muted hover:text-ink cursor-pointer"
              >
                ±{deck.pitchRange}%
              </button>
              <button
                type="button"
                aria-label={`Nudge - Deck ${deckId}`}
                onPointerDown={() => onJogNudge(deckId, 0.96)}
                onPointerUp={() => onJogNudge(deckId, 1)}
                onPointerLeave={() => onJogNudge(deckId, 1)}
                className="rounded border border-white/[0.06] bg-raised px-1 py-0.5 text-[10px] font-bold text-muted hover:bg-raised-2 hover:text-ink cursor-pointer"
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
                className="w-16 accent-ink-2 cursor-pointer"
                aria-label={`Pitch Deck ${deckId}`}
              />
              <button
                type="button"
                aria-label={`Nudge + Deck ${deckId}`}
                onPointerDown={() => onJogNudge(deckId, 1.04)}
                onPointerUp={() => onJogNudge(deckId, 1)}
                onPointerLeave={() => onJogNudge(deckId, 1)}
                className="rounded border border-white/[0.06] bg-raised px-1 py-0.5 text-[10px] font-bold text-muted hover:bg-raised-2 hover:text-ink cursor-pointer"
                title="Nudge + (Adelantar fase)"
              >
                N+
              </button>
              <span className="w-11 text-right font-mono-tabular text-[10px] text-ink">
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
                className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-muted hover:bg-raised-2 hover:text-ink cursor-pointer"
              >
                IN
              </button>
              <button
                type="button"
                onClick={() => onLoopOut(deckId)}
                className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-muted hover:bg-raised-2 hover:text-ink cursor-pointer"
              >
                OUT
              </button>
              <button
                type="button"
                onClick={() => onToggleLoopExit(deckId)}
                className={`rounded border px-2 py-0.5 font-semibold cursor-pointer ${
                  deck.loop?.active
                    ? 'border-live/60 bg-live/15 text-live'
                    : 'border-white/[0.06] bg-raised text-muted'
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
                      ? 'border-live/60 bg-live/15 text-live'
                      : 'border-white/[0.06] bg-raised text-muted hover:bg-raised-2 hover:text-ink'
                  }`}
                >
                  {beats}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded border border-white/[0.06] bg-ground px-1.5 py-0.5">
              <button
                type="button"
                onClick={() => onPitchChange(deckId, deck.pitchPercent, !deck.keyLock)}
                className={`rounded border px-1.5 py-0.2 text-[10px] font-semibold cursor-pointer ${
                  deck.keyLock
                    ? 'border-white/25 bg-raised-2 text-ink'
                    : 'border-white/[0.06] bg-raised text-faint'
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
                className="rounded p-0.5 text-muted hover:text-ink cursor-pointer"
                title="Bajar 1 semitono"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onKeyShiftChange(deckId, 0)}
                className="min-w-8 text-center font-mono-tabular text-[10px] text-ink-soft cursor-pointer"
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
                className="rounded p-0.5 text-muted hover:text-ink cursor-pointer"
                title="Subir 1 semitono"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Mode 44px Tactile Performance Pads with Animated Sliding Pill */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-ground p-1.5">
        <div className="relative grid grid-cols-5 rounded-md bg-surface p-0.5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded bg-raised-2 ring-1 ring-white/[0.12] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
                padMode === m.id ? 'text-ink' : 'text-faint hover:text-ink-soft'
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
                  className={`relative flex h-11 flex-col items-center justify-center rounded-md border border-white/[0.06] bg-raised font-mono-tabular text-[11px] font-semibold hover:bg-raised-2 cursor-pointer ${
                    flashingPad === flashKey ? 'animate-pad-flash' : ''
                  }`}
                  style={{
                    // A stored cue is a deck-colour tint; an empty slot stays a plain surface
                    backgroundColor: cue ? `${accent}26` : undefined,
                    borderColor: cue ? `${accent}66` : undefined,
                    color: cue ? 'var(--color-ink)' : 'var(--color-faint)'
                  }}
                >
                  <span>{slot}</span>
                  {cue ? (
                    <span className="text-[10px] font-normal text-muted">
                      {formatTime(cue.timeSec)}
                    </span>
                  ) : null}
                  {showHotkeys ? (
                    <span className="hardware-keycap pointer-events-none absolute top-0.5 right-0.5 rounded px-0.5 text-[10px]">
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
                className={`h-11 rounded-md border border-white/[0.06] bg-raised font-mono-tabular text-[11px] font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer ${
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
                className={`h-11 rounded-md border border-white/[0.06] bg-raised font-mono-tabular text-[11px] font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer ${
                  flashingPad === `${deckId}-jump-${beats}` ? 'animate-pad-flash' : ''
                }`}
                style={{ color: accent }}
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
                className={`h-11 rounded-md border border-white/[0.06] bg-raised text-[10px] font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer ${
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
                  className="flex h-11 items-center gap-1.5 rounded-md border border-white/[0.06] bg-raised px-2"
                >
                  <button
                    type="button"
                    onClick={() => onDeckFxChange(deckId, fx, !st.enabled, st.wet, st.beatDiv)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase cursor-pointer ${
                      st.enabled
                        ? 'border-live/60 bg-live/15 text-live'
                        : 'border-white/[0.06] bg-ground text-muted'
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
                    className="w-full accent-ink-2 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const divs = ['1/4', '1/2', '3/4', '1/1'] as const;
                      const next = divs[(divs.indexOf(st.beatDiv) + 1) % divs.length];
                      onDeckFxChange(deckId, fx, st.enabled, st.wet, next);
                    }}
                    aria-label={`Tiempo de ${fx} Deck ${deckId}: ${st.beatDiv} de beat`}
                    title="Tiempo del efecto en beats (clic para cambiar)"
                    className="shrink-0 rounded border border-white/[0.06] bg-ground px-1 py-0.5 font-mono-tabular text-[10px] text-ink-soft hover:text-ink cursor-pointer"
                  >
                    {st.beatDiv}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      </>
      ) : null}
    </section>
  );
}

/** Camelot key of the deck (after key shift) and how it sits against the other deck. */
function KeyBadge({ deckId }: { deckId: DeckId }): ReactElement {
  const self = useDeckStore((s) => s.decks[deckId]);
  const other = useDeckStore((s) => s.decks[deckId === 'A' ? 'B' : 'A']);
  const key = self.musicalKey ? shiftCamelot(self.musicalKey, self.keyShiftSemitones) : null;
  const otherKey =
    other.track && other.musicalKey ? shiftCamelot(other.musicalKey, other.keyShiftSemitones) : null;
  const match = key && otherKey ? harmonicMatch(key, otherKey) : null;
  const tone =
    match === 'same' || match === 'compatible'
      ? 'border-live/50 text-live'
      : match === 'energy'
        ? 'border-white/[0.16] text-ink'
        : match === 'clash'
          ? 'border-danger/50 text-danger-soft'
          : 'border-white/[0.06] text-ink-soft';
  const title = !self.track
    ? 'Tono musical (Camelot)'
    : !key
      ? 'Detectando el tono… suena unos 20 s'
      : match
        ? `Tono ${key} frente a ${otherKey} del otro deck: ${HARMONIC_LABEL[match]}`
        : `Tono ${key} (rueda Camelot)`;
  return (
    <div
      title={title}
      aria-label={title}
      className={`hidden min-w-[46px] flex-col items-center rounded-md border bg-ground px-1.5 py-0.5 @2xl:flex ${tone}`}
    >
      <span className="font-mono-tabular text-[14px] font-semibold leading-none">{key ?? '--'}</span>
      <span className="text-[10px] leading-tight text-faint">
        {match ? HARMONIC_LABEL[match] : 'Tono'}
      </span>
    </div>
  );
}
