import { useState, type ReactElement } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  Ban,
  ChevronDown,
  Film,
  HardDrive,
  Music,
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
import { useLibraryStore } from '../store/useLibraryStore';
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
}

const selectClass =
  'w-full rounded-md border border-white/[0.06] bg-[#151821] px-2 py-1 text-[11px] text-[#F8FAFC] focus:border-white/25 focus:outline-none';
const ghostBtn =
  'inline-flex items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-[#151821] px-2 py-1 text-[11px] font-medium text-[#CBD5E1] transition-colors duration-150 hover:bg-[#1C202B] hover:text-[#F8FAFC] disabled:opacity-40 cursor-pointer';
const iconBtn =
  'rounded p-1 text-[#94A3B8] transition-colors duration-150 hover:bg-[#1C202B] hover:text-[#F8FAFC] disabled:opacity-30 cursor-pointer';

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
  onOpenTasteSetup
}: QueueTabProps): ReactElement {
  const queue = useLibraryStore((s) => s.queue);
  const automixEnabled = useLibraryStore((s) => s.automixEnabled);
  const autoRadioEnabled = useLibraryStore((s) => s.autoRadioEnabled);
  const automixFadeType = useLibraryStore((s) => s.automixFadeType);
  const automixFadeDurationSec = useLibraryStore((s) => s.automixFadeDurationSec);
  const preloadMode = useLibraryStore((s) => s.preloadMode);
  const statusNote = useLibraryStore((s) => s.automixStatusNote);
  const playedVideoIds = useLibraryStore((s) => s.playedVideoIds);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [likedQueueIds, setLikedQueueIds] = useState<Set<string>>(() => new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);

  const totalSec = queue.reduce((acc, q) => acc + (q.track.durationSec > 0 ? q.track.durationSec : 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Header: title + live toggles */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold text-[#F8FAFC]">Siguiente</h2>
          <span className="truncate font-mono-tabular text-[11px] text-[#64748B]">
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
                ? 'border-[#10B981]/50 bg-[#10B981]/12 text-[#10B981]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
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
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
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
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
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
          className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-2"
        >
          <div className="grid grid-cols-3 gap-1.5">
            <label className="flex flex-col gap-0.5 text-[10px] text-[#64748B]">
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
            <label className="flex flex-col gap-0.5 text-[10px] text-[#64748B]">
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
            <label className="flex flex-col gap-0.5 text-[10px] text-[#64748B]">
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
              className="inline-flex items-center justify-center gap-1 rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 px-2 py-1 text-[11px] font-semibold text-[#FCA5A5] transition-colors duration-150 hover:bg-[#EF4444]/20 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Vaciar Cola
            </button>
          </div>
        </div>
      ) : null}

      {statusNote ? (
        <p
          className="truncate rounded-md bg-[#151821] px-2 py-1 text-[11px] text-[#CBD5E1]"
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
            <p className="text-xs text-[#94A3B8]">La cola está vacía.</p>
            <p className="text-[11px] leading-relaxed text-[#64748B]">
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
                  className={`group flex gap-2 rounded-md p-1.5 transition-colors duration-150 hover:bg-[#151821] focus-within:bg-[#151821] ${
                    overIdx === idx ? 'bg-[#1C202B] shadow-[inset_0_2px_0_#0EA5E9]' : ''
                  } ${dragIdx === idx ? 'opacity-50' : ''}`}
                >
                  <div className="relative aspect-video w-[88px] shrink-0 cursor-grab overflow-hidden rounded bg-[#151821]">
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
                          <Music className="h-4 w-4 text-[#CBD5E1]" />
                        ) : (
                          <Film className="h-4 w-4 text-[#94A3B8]" />
                        )}
                      </div>
                    )}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/80 px-1 font-mono-tabular text-[9px] font-semibold text-[#CBD5E1]">
                      {idx + 1}
                    </span>
                    {item.track.durationSec > 0 ? (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[9px] text-[#F8FAFC]">
                        {formatTrackDuration(item.track.durationSec)}
                      </span>
                    ) : null}
                    {item.status === 'loaded' ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#10B981]" aria-hidden="true" />
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <p
                      className={`line-clamp-2 text-xs font-medium leading-snug ${
                        wasPlayed ? 'text-[#94A3B8]' : 'text-[#F8FAFC]'
                      }`}
                      title={item.track.title}
                    >
                      {item.track.title}
                    </p>
                    <p className="truncate text-[11px] text-[#94A3B8]">{item.track.channel}</p>
                    <p className="flex min-w-0 items-center gap-1 text-[10px] text-[#64748B]">
                      {item.status === 'loaded' ? (
                        <span className="text-[#10B981]">Precargada en el deck libre</span>
                      ) : item.status === 'failed' ? (
                        <span className="truncate text-[#FCA5A5]">
                          No se pudo cargar: {item.errorMessage ?? 'omitida'}
                        </span>
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
                            className={`${iconBtn} ${liked ? 'text-[#10B981] hover:text-[#10B981]' : ''}`}
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
                            className={`${iconBtn} hover:text-[#FCA5A5]`}
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
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#0EA5E9] transition-colors duration-150 hover:bg-[#0EA5E9]/15 cursor-pointer"
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={() => onLoadFromQueue('B', item.queueId)}
                          aria-label={`Cargar en Deck B: ${item.track.title}`}
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#F59E0B] transition-colors duration-150 hover:bg-[#F59E0B]/15 cursor-pointer"
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
                          className={`${iconBtn} hover:text-[#FCA5A5]`}
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
          className="inline-flex items-center justify-center gap-1 self-center text-[10px] text-[#64748B] transition-colors duration-150 hover:text-[#CBD5E1] cursor-pointer"
        >
          <ChevronDown className="h-3 w-3" />
          Opciones de mezcla
        </button>
      ) : null}
    </div>
  );
}
