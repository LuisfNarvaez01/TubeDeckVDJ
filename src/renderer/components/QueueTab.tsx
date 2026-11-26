import { useEffect, useState, type ReactElement } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  Ban,
  ChevronDown,
  Film,
  HardDrive,
  Music,
  QrCode,
  Radio,
  Settings2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wand2
} from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { AutomixFadeType, PreloadMode } from '../dj/QueueAndAutomixEngine';
import { useDeckStore } from '../store/useDeckStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useMixerStore } from '../store/useMixerStore';
import { formatTrackDuration } from './SearchBrowserTab';

interface QueueTabProps {
  onLoadFromQueue: (deck: DeckId, queueId: string) => void;
  onReorderQueue: (fromIdx: number, toIdx: number) => void;
  onMoveToNext: (queueId: string) => void;
  onRemoveQueueItem: (queueId: string) => void;
  onClearQueue: () => void;
  onInterleaveQueue: () => void;
  onToggleAutomix: (enabled: boolean) => void;
  onToggleAutoRadio: (enabled: boolean) => void;
  onFadeTypeChange: (fadeType: AutomixFadeType) => void;
  onFadeDurationChange: (sec: number) => void;
  onPreloadModeChange: (mode: PreloadMode) => void;
  onFetchSuggestionsNow: () => void;
  onTrackFeedback: (queueId: string, signal: 'like' | 'dislike' | 'block-channel') => void;
  onOpenTasteSetup: () => void;
  /** The column's tab bar already says "Siguiente". */
  hideTitle?: boolean;
}

const selectClass =
  'w-full rounded-md border border-white/[0.06] bg-raised px-2 py-1 text-[11px] text-ink focus:border-white/25 focus:outline-none';
const ghostBtn =
  'inline-flex items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-raised px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer';
const iconBtn =
  'rounded p-1 text-muted transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-30 cursor-pointer';

/** Persistent "Siguiente" (Up Next) column: queue, Automix/Radio controls and radio feedback. */
export function QueueTab({
  onLoadFromQueue,
  onReorderQueue,
  onMoveToNext,
  onRemoveQueueItem,
  onClearQueue,
  onInterleaveQueue,
  onToggleAutomix,
  onToggleAutoRadio,
  onFadeTypeChange,
  onFadeDurationChange,
  onPreloadModeChange,
  onFetchSuggestionsNow,
  onTrackFeedback,
  onOpenTasteSetup,
  hideTitle = false
}: QueueTabProps): ReactElement {
  const queue = useLibraryStore((s) => s.queue);
  const automixEnabled = useLibraryStore((s) => s.automixEnabled);
  const autoRadioEnabled = useLibraryStore((s) => s.autoRadioEnabled);
  const automixFadeType = useLibraryStore((s) => s.automixFadeType);
  const automixFadeDurationSec = useLibraryStore((s) => s.automixFadeDurationSec);
  const preloadMode = useLibraryStore((s) => s.preloadMode);
  const sourceMode = useLibraryStore((s) => s.automixSourceMode);
  const setSourceMode = useLibraryStore((s) => s.setAutomixSourceMode);
  const localCount = useLibraryStore((s) => s.localTracks.length);
  const cachedCount = useLibraryStore((s) => s.cachedTracks.length);
  const statusNote = useLibraryStore((s) => s.automixStatusNote);
  const playedVideoIds = useLibraryStore((s) => s.playedVideoIds);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [likedQueueIds, setLikedQueueIds] = useState<Set<string>>(() => new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);

  const totalSec = queue.reduce((acc, q) => acc + (q.track.durationSec > 0 ? q.track.durationSec : 0), 0);

  // Estimated start time of each queued song (refreshed every 15 s, not every frame).
  const [clockTick, setClockTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClockTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const startTimes = (() => {
    const decks = useDeckStore.getState().decks;
    const active = useMixerStore.getState().crossfader <= 0.5 ? decks.A : decks.B;
    let cursorMs =
      clockTick +
      (active.track && active.playing && active.durationSec > 0
        ? Math.max(0, active.durationSec - active.currentTimeSec) * 1000
        : 0);
    return queue.map((q) => {
      const at = cursorMs;
      const dur = q.track.durationSec > 0 ? q.track.durationSec : 210;
      cursorMs += Math.max(0, dur - automixFadeDurationSec) * 1000;
      return at;
    });
  })();
  const formatStart = (ms: number): string =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Header: title + live toggles */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          {hideTitle ? null : <h2 className="text-sm font-semibold text-ink">Siguiente</h2>}
          <span className="truncate font-mono-tabular text-[11px] text-faint">
            {queue.length} {queue.length === 1 ? 'canción' : 'canciones'}
            {totalSec > 0 ? ` · ${formatTrackDuration(totalSec)}` : ''}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleAutomix(!automixEnabled)}
            aria-pressed={automixEnabled}
            title="Automix: mezcla sola la siguiente canción de la cola"
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
              automixEnabled
                ? 'border-live/50 bg-live/12 text-live'
                : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Automix
          </button>
          <button
            type="button"
            onClick={() => onToggleAutoRadio(!autoRadioEnabled)}
            aria-pressed={autoRadioEnabled}
            aria-label={`Radio YT: ${autoRadioEnabled ? 'ON' : 'OFF'}`}
            title="Radio YT: cuando la cola se vacía, sugiere canciones según lo que suena y tus gustos"
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
              autoRadioEnabled
                ? 'border-white/25 bg-raised-2 text-ink'
                : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
            }`}
          >
            <Radio className="h-3 w-3" />
            Radio
          </button>
          <button
            type="button"
            onClick={() => setOptionsOpen((v) => !v)}
            aria-expanded={optionsOpen}
            aria-controls="upnext-options"
            aria-label="Opciones de cola"
            title="Opciones de cola y Automix"
            className={`rounded-md border p-1 transition-colors duration-150 cursor-pointer ${
              optionsOpen
                ? 'border-white/25 bg-raised-2 text-ink'
                : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible options */}
      {optionsOpen ? (
        <div
          id="upnext-options"
          className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-2"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-faint">Fuente del Automix</span>
            <div role="radiogroup" aria-label="Fuente del Automix" className="grid grid-cols-3 gap-1">
              {(
                [
                  ['local', 'Local', 'Solo canciones de tu biblioteca local'],
                  ['youtube', 'YouTube', 'Radio de YouTube; si falla o no hay internet, sigue con canciones locales'],
                  ['autopilot', 'Autopilot', 'Mezcla local y YouTube eligiendo lo que mejor encaja con lo que suena']
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={sourceMode === id}
                  title={hint}
                  onClick={() => setSourceMode(id)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
                    sourceMode === id
                      ? 'border-live/50 bg-live/12 text-live'
                      : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-faint">
              Respaldo sin internet: {localCount} locales · {cachedCount} guardadas de YouTube
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="flex flex-col gap-0.5 text-[10px] text-faint">
              Precarga
              <select
                aria-label="Precarga"
                value={preloadMode}
                onChange={(e) => onPreloadModeChange(e.target.value as PreloadMode)}
                className={selectClass}
              >
                <option value="immediate">Inmediata</option>
                <option value="90s">90 s antes</option>
                <option value="60s">60 s antes</option>
                <option value="30s">30 s antes</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-faint">
              Mezcla
              <select
                aria-label="Estilo Automix"
                value={automixFadeType}
                onChange={(e) => onFadeTypeChange(e.target.value as AutomixFadeType)}
                className={selectClass}
              >
                <option value="smart-crossfade">Crossfade</option>
                <option value="fade-out-in">Fade out/in</option>
                <option value="cut">Corte</option>
                <option value="backspin">Backspin</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-faint">
              Duración
              <select
                aria-label="Duración Automix"
                value={automixFadeDurationSec}
                onChange={(e) => onFadeDurationChange(Number(e.target.value))}
                className={`${selectClass} font-mono-tabular`}
              >
                {[2, 4, 6, 8, 12].map((sec) => (
                  <option key={sec} value={sec}>
                    {sec} s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onFetchSuggestionsNow} className={ghostBtn}>
              <Wand2 className="h-3 w-3" />
              Sugerir 3 ahora
            </button>
            <button type="button" onClick={onOpenTasteSetup} className={ghostBtn}>
              <SlidersHorizontal className="h-3 w-3" />
              Ajustar mi radio
            </button>
            <button
              type="button"
              disabled={queue.length < 2}
              onClick={onInterleaveQueue}
              className={ghostBtn}
              title="Alternar canciones de YouTube con canciones locales"
            >
              <Shuffle className="h-3 w-3" />
              Intercalar Local/YT
            </button>
            <button
              type="button"
              disabled={queue.length === 0}
              onClick={onClearQueue}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-danger/35 bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger-soft transition-colors duration-150 hover:bg-danger/20 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Vaciar Cola
            </button>
          </div>
        </div>
      ) : null}

      {statusNote ? (
        <p
          className="truncate rounded-md bg-raised px-2 py-1 text-[11px] text-ink-soft"
          title={statusNote}
          role="status"
        >
          {statusNote}
        </p>
      ) : null}

      {/* Queue list */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {queue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-muted">La cola está vacía.</p>
            <p className="text-[11px] leading-relaxed text-faint">
              Agrega canciones desde el buscador o la biblioteca.
              {autoRadioEnabled ? ' Con Radio activa, nunca habrá silencio.' : ''}
            </p>
            <div className="mt-1 flex gap-1.5">
              <button type="button" onClick={onFetchSuggestionsNow} className={ghostBtn}>
                <Wand2 className="h-3 w-3" />
                Sugerir ahora
              </button>
              <button type="button" onClick={onOpenTasteSetup} className={ghostBtn}>
                <SlidersHorizontal className="h-3 w-3" />
                Ajustar mi radio
              </button>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {queue.map((item, idx) => {
              const wasPlayed = playedVideoIds.includes(item.track.videoId);
              const isRadio = item.source === 'youtube-radio';
              const liked = likedQueueIds.has(item.queueId);
              return (
                <li
                  key={item.queueId}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (overIdx !== idx) setOverIdx(idx);
                  }}
                  onDragLeave={() => {
                    if (overIdx === idx) setOverIdx(null);
                  }}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) onReorderQueue(dragIdx, idx);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  className={`group flex gap-2 rounded-md p-1.5 transition-colors duration-150 hover:bg-raised focus-within:bg-raised ${
                    overIdx === idx ? 'bg-raised-2 shadow-[inset_0_2px_0_#22E1F0]' : ''
                  } ${dragIdx === idx ? 'opacity-50' : ''}`}
                >
                  <div className="relative aspect-video w-[88px] shrink-0 cursor-grab overflow-hidden rounded bg-raised">
                    {item.track.thumbnailUrl ? (
                      <img
                        src={item.track.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className={`h-full w-full object-cover ${wasPlayed ? 'opacity-50' : ''}`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {item.track.mediaKind === 'audio' ? (
                          <Music className="h-4 w-4 text-ink-soft" />
                        ) : (
                          <Film className="h-4 w-4 text-muted" />
                        )}
                      </div>
                    )}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/80 px-1 font-mono-tabular text-[10px] font-semibold text-ink-soft">
                      {idx + 1}
                    </span>
                    {item.track.durationSec > 0 ? (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[10px] text-ink">
                        {formatTrackDuration(item.track.durationSec)}
                      </span>
                    ) : null}
                    {item.status === 'loaded' ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-live" aria-hidden="true" />
                    ) : item.status === 'pending' || item.status === 'preloading' ? (
                      <span
                        className={`absolute inset-x-0 bottom-0 border-b border-dashed ${
                          item.status === 'preloading' ? 'border-live/80' : 'border-ink/35'
                        }`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-2">
                      <p
                        className={`line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug ${
                          wasPlayed ? 'text-muted' : 'text-ink'
                        } ${item.status === 'failed' ? 'line-through decoration-danger/70' : ''}`}
                        title={item.track.title}
                      >
                        {item.track.title}
                      </p>
                      <span
                        className="shrink-0 font-mono-tabular text-[10px] text-faint"
                        title="Hora estimada a la que empezará a sonar"
                      >
                        ~{formatStart(startTimes[idx])}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted">{item.track.channel}</p>
                    <p className="flex min-w-0 items-center gap-1 text-[10px] text-faint">
                      {item.status === 'loaded' ? (
                        <span className="text-live">Precargada en el deck libre</span>
                      ) : item.status === 'failed' ? (
                        <span className="truncate text-danger-soft">
                          No se pudo cargar: {item.errorMessage ?? 'omitida'}
                        </span>
                      ) : item.source === 'request' && item.request ? (
                        <>
                          <QrCode className="h-2.5 w-2.5 shrink-0 text-ink-soft" />
                          <span className="truncate text-ink-soft">
                            {/^\d+$/.test(item.request.table) ? `Mesa ${item.request.table}` : item.request.table}
                            {item.request.guest ? ` · ${item.request.guest}` : ''}
                          </span>
                        </>
                      ) : isRadio ? (
                        <>
                          <Radio className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{item.track.recommendReason ?? 'Sugerida por la radio'}</span>
                        </>
                      ) : item.track.source === 'local' ? (
                        <>
                          <HardDrive className="h-2.5 w-2.5 shrink-0" />
                          <span>Archivo local</span>
                        </>
                      ) : wasPlayed ? (
                        <span>Ya sonó en esta sesión</span>
                      ) : null}
                    </p>

                    <div className="mt-auto flex items-center justify-between gap-1 pt-0.5">
                      {isRadio ? (
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              setLikedQueueIds((prev) => new Set(prev).add(item.queueId));
                              onTrackFeedback(item.queueId, 'like');
                            }}
                            aria-pressed={liked}
                            aria-label="Me gusta esta sugerencia"
                            title="Me gusta: la radio pondrá más como esta"
                            className={`${iconBtn} ${liked ? 'text-live hover:text-live' : ''}`}
                          >
                            <ThumbsUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onTrackFeedback(item.queueId, 'dislike')}
                            aria-label="No me gusta esta sugerencia"
                            title="No me gusta: la quita y la radio aprende"
                            className={iconBtn}
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onTrackFeedback(item.queueId, 'block-channel')}
                            aria-label={`No recomendar ${item.track.channel}`}
                            title={`No recomendar más ${item.track.channel}`}
                            className={`${iconBtn} hover:text-danger-soft`}
                          >
                            <Ban className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span />
                      )}

                      <div className="flex items-center gap-0.5 opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => onLoadFromQueue('A', item.queueId)}
                          aria-label={`Cargar en Deck A: ${item.track.title}`}
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-deck-a transition-colors duration-150 hover:bg-deck-a/15 cursor-pointer"
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={() => onLoadFromQueue('B', item.queueId)}
                          aria-label={`Cargar en Deck B: ${item.track.title}`}
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-deck-b transition-colors duration-150 hover:bg-deck-b/15 cursor-pointer"
                        >
                          B
                        </button>
                        {idx > 0 && item.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => onMoveToNext(item.queueId)}
                            aria-label="Poner como siguiente"
                            title="Poner como siguiente"
                            className={iconBtn}
                          >
                            <ArrowUpToLine className="h-3 w-3" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onReorderQueue(idx, idx - 1)}
                          disabled={idx === 0}
                          className={iconBtn}
                          aria-label="Subir"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderQueue(idx, idx + 1)}
                          disabled={idx === queue.length - 1}
                          className={iconBtn}
                          aria-label="Bajar"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveQueueItem(item.queueId)}
                          className={`${iconBtn} hover:text-danger-soft`}
                          aria-label="Quitar de la cola"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {!optionsOpen && queue.length > 0 ? (
        <button
          type="button"
          onClick={() => setOptionsOpen(true)}
          className="inline-flex items-center justify-center gap-1 self-center text-[10px] text-faint transition-colors duration-150 hover:text-ink-soft cursor-pointer"
        >
          <ChevronDown className="h-3 w-3" />
          Opciones de mezcla
        </button>
      ) : null}
    </div>
  );
}
