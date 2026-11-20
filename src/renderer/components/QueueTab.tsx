import { useState, type ReactElement } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  GripVertical,
  Shuffle,
  Trash2,
  Sparkles,
  Radio,
  Wand2,
  Film,
  Music
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
}

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
  onFetchSuggestionsNow
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

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleAutomix(!automixEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-semibold cursor-pointer ${
              automixEnabled
                ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Automix: {automixEnabled ? 'ACTIVO' : 'INACTIVO'}
          </button>

          <button
            type="button"
            onClick={() => onToggleAutoRadio(!autoRadioEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold cursor-pointer ${
              autoRadioEnabled
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
            }`}
            title="Al vaciarse la cola sugiere temas según la última canción e historial"
          >
            <Radio className="h-3.5 w-3.5" />
            Radio YT: {autoRadioEnabled ? 'ON' : 'OFF'}
          </button>

          <select
            aria-label="Precarga"
            value={preloadMode}
            onChange={(e) => onPreloadModeChange(e.target.value as PreloadMode)}
            className="rounded-lg border border-white/[0.06] bg-[#151821] px-2 py-1 text-[11px] text-[#F8FAFC]"
            title="Cuándo empezar a almacenar en caché la siguiente canción"
          >
            <option value="immediate">Precarga: Inmediata (4s)</option>
            <option value="90s">Precarga: 90s antes</option>
            <option value="60s">Precarga: 60s antes</option>
            <option value="30s">Precarga: 30s antes</option>
          </select>

          <select
            aria-label="Estilo Automix"
            value={automixFadeType}
            onChange={(e) => onFadeTypeChange(e.target.value as AutomixFadeType)}
            className="rounded-lg border border-white/[0.06] bg-[#151821] px-2 py-1 text-[11px] text-[#F8FAFC]"
          >
            <option value="smart-crossfade">Mezcla: Crossfade Suave</option>
            <option value="fade-out-in">Mezcla: Fade Out / In</option>
            <option value="cut">Mezcla: Corte Directo</option>
            <option value="backspin">Mezcla: Backspin</option>
          </select>

          <select
            aria-label="Duración Automix"
            value={automixFadeDurationSec}
            onChange={(e) => onFadeDurationChange(Number(e.target.value))}
            className="rounded-lg border border-white/[0.06] bg-[#151821] px-2 py-1 font-mono-tabular text-[11px] text-[#F8FAFC]"
          >
            <option value={2}>Fade 2s</option>
            <option value={4}>Fade 4s</option>
            <option value={6}>Fade 6s</option>
            <option value={8}>Fade 8s</option>
            <option value={12}>Fade 12s</option>
          </select>

          <button
            type="button"
            onClick={onFetchSuggestionsNow}
            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#151821] px-2.5 py-1 text-[11px] font-semibold text-[#F8FAFC] hover:bg-[#1C202B] cursor-pointer"
          >
            <Wand2 className="h-3.5 w-3.5" />
            + Sugerir YT
          </button>

          <button
            type="button"
            disabled={queue.length < 2}
            onClick={onInterleaveQueue}
            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#151821] px-2.5 py-1 text-[11px] font-medium text-[#94A3B8] hover:text-[#F8FAFC] disabled:opacity-40 cursor-pointer"
            title="Alternar canciones de YouTube con canciones locales"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Intercalar Local/YT
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono-tabular text-[11px] text-[#94A3B8]">{queue.length} en cola</span>
          <button
            type="button"
            disabled={queue.length === 0}
            onClick={onClearQueue}
            className="inline-flex items-center gap-1 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FCA5A5] hover:bg-[#EF4444]/20 disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Vaciar Cola
          </button>
        </div>
      </div>

      {statusNote ? (
        <div className="rounded-lg border border-white/[0.08] bg-[#151821] px-3 py-1.5 text-xs text-[#CBD5E1]">
          {statusNote}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#08090C] divide-y divide-white/[0.05]">
        {queue.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            La cola Up Next está vacía. Arrastra o agrega videos del buscador o biblioteca local; con Radio YT ON nunca habrá silencios.
          </div>
        ) : (
          queue.map((item, idx) => {
            const wasPlayed = playedVideoIds.includes(item.track.videoId);
            return (
              <div
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
                  if (dragIdx !== null && dragIdx !== idx) {
                    onReorderQueue(dragIdx, idx);
                  }
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#151821]/70 ${
                  overIdx === idx ? 'border-t-2 border-t-[#0EA5E9] bg-[#1C202B]/70' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[#64748B]" />
                  <span className="w-5 text-center font-mono-tabular text-xs text-[#64748B]">
                    {idx + 1}
                  </span>

                  <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-[#151821]">
                    {item.track.thumbnailUrl ? (
                      <img
                        src={item.track.thumbnailUrl}
                        alt={item.track.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {item.track.mediaKind === 'audio' ? (
                          <Music className="h-4 w-4 text-[#CBD5E1]" />
                        ) : (
                          <Film className="h-4 w-4 text-[#0EA5E9]" />
                        )}
                      </div>
                    )}
                    {item.track.durationSec > 0 ? (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[9px] text-[#F8FAFC]">
                        {formatTrackDuration(item.track.durationSec)}
                      </span>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-[#F8FAFC]">
                        {item.track.title}
                      </p>
                      {item.source === 'youtube-radio' ? (
                        <span className="shrink-0 rounded border border-white/[0.1] bg-[#151821] px-1.5 py-0.2 text-[10px] font-semibold text-[#CBD5E1]">
                          Sugerido YT
                        </span>
                      ) : item.track.source === 'local' ? (
                        <span className="shrink-0 rounded border border-white/[0.1] bg-[#151821] px-1.5 py-0.2 text-[10px] font-semibold text-[#CBD5E1]">
                          Local
                        </span>
                      ) : null}
                      {wasPlayed ? (
                        <span className="shrink-0 rounded border border-white/[0.08] bg-[#151821] px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-[#94A3B8]">
                          REPRODUCIDA
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[#94A3B8]">
                      {item.track.channel} •{' '}
                      <span
                        className={
                          item.status === 'failed'
                            ? 'text-[#EF4444]'
                            : item.status === 'loaded'
                              ? 'text-[#10B981]'
                              : 'text-[#94A3B8]'
                        }
                      >
                        {item.status === 'loaded'
                          ? 'Pre-cargado en Deck alterno'
                          : item.status === 'failed'
                            ? `Error: ${item.errorMessage ?? 'omitido'}`
                            : item.status}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {idx > 0 && item.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => onMoveToNext(item.queueId)}
                      className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-[#151821] px-2 py-1 text-[11px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                      title="Mover al primer puesto siguiente"
                    >
                      <ArrowUpToLine className="h-3 w-3" />
                      Siguiente
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onLoadFromQueue('A', item.queueId)}
                    className="rounded border border-[#0EA5E9]/45 px-2 py-1 text-xs font-semibold text-[#0EA5E9] hover:bg-[#0EA5E9]/15 cursor-pointer"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadFromQueue('B', item.queueId)}
                    className="rounded border border-[#F59E0B]/45 px-2 py-1 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/15 cursor-pointer"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorderQueue(idx, idx - 1)}
                    disabled={idx === 0}
                    className="rounded border border-white/[0.06] bg-[#151821] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                    aria-label="Subir"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorderQueue(idx, idx + 1)}
                    disabled={idx === queue.length - 1}
                    className="rounded border border-white/[0.06] bg-[#151821] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                    aria-label="Bajar"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveQueueItem(item.queueId)}
                    className="rounded border border-white/[0.06] bg-[#151821] p-1 text-[#EF4444] cursor-pointer"
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
