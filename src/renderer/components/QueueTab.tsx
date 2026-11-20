import { useState, type ReactElement } from 'react';
import { ArrowUp, ArrowDown, Trash2, Sparkles, Radio, Wand2 } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { AutomixFadeType } from '../dj/QueueAndAutomixEngine';
import { useLibraryStore } from '../store/useLibraryStore';

interface QueueTabProps {
  onLoadFromQueue: (deck: DeckId, queueId: string) => void;
  onReorderQueue: (fromIdx: number, toIdx: number) => void;
  onRemoveQueueItem: (queueId: string) => void;
  onToggleAutomix: (enabled: boolean) => void;
  onToggleAutoRadio: (enabled: boolean) => void;
  onFadeTypeChange: (fadeType: AutomixFadeType) => void;
  onFadeDurationChange: (sec: number) => void;
  onFetchSuggestionsNow: () => void;
}

export function QueueTab({
  onLoadFromQueue,
  onReorderQueue,
  onRemoveQueueItem,
  onToggleAutomix,
  onToggleAutoRadio,
  onFadeTypeChange,
  onFadeDurationChange,
  onFetchSuggestionsNow
}: QueueTabProps): ReactElement {
  const queue = useLibraryStore((s) => s.queue);
  const automixEnabled = useLibraryStore((s) => s.automixEnabled);
  const autoRadioEnabled = useLibraryStore((s) => s.autoRadioEnabled);
  const automixFadeType = useLibraryStore((s) => s.automixFadeType);
  const automixFadeDurationSec = useLibraryStore((s) => s.automixFadeDurationSec);
  const statusNote = useLibraryStore((s) => s.automixStatusNote);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1F2937] bg-[#07090E] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleAutomix(!automixEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-semibold cursor-pointer ${
              automixEnabled
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                : 'border-[#1F2937] bg-[#0F141D] text-[#94A3B8]'
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
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#DDD6FE]'
                : 'border-[#1F2937] bg-[#0F141D] text-[#94A3B8]'
            }`}
            title="Cuando la cola se vacía, pide recomendaciones automáticas a YouTube sin repetir historial"
          >
            <Radio className="h-3.5 w-3.5" />
            Radio YT: {autoRadioEnabled ? 'ON' : 'OFF'}
          </button>

          <select
            aria-label="Estilo Automix"
            value={automixFadeType}
            onChange={(e) => onFadeTypeChange(e.target.value as AutomixFadeType)}
            className="rounded-lg border border-[#1F2937] bg-[#0F141D] px-2 py-1 text-[11px] text-[#F8FAFC]"
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
            className="rounded-lg border border-[#1F2937] bg-[#0F141D] px-2 py-1 text-[11px] text-[#F8FAFC]"
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
            className="inline-flex items-center gap-1 rounded-lg border border-[#00D4FF]/40 bg-[#00D4FF]/10 px-2.5 py-1 text-[11px] font-semibold text-[#00D4FF] hover:bg-[#00D4FF]/20 cursor-pointer"
          >
            <Wand2 className="h-3.5 w-3.5" />
            + Sugerir YT ahora
          </button>
        </div>

        <span className="font-mono-tabular text-[11px] text-[#94A3B8]">{queue.length} en cola</span>
      </div>

      {statusNote ? (
        <div className="rounded border border-[#FF8A00]/40 bg-[#FF8A00]/10 px-3 py-1.5 text-xs text-[#FDBA74]">
          {statusNote}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#1F2937] bg-[#07090E] divide-y divide-[#1F2937]">
        {queue.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            La cola Up Next está vacía. Agrega videos del buscador o deja Radio YT ON para mezcla continua automática.
          </div>
        ) : (
          queue.map((item, idx) => (
            <div
              key={item.queueId}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== idx) {
                  onReorderQueue(dragIdx, idx);
                }
                setDragIdx(null);
              }}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#0F141D]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="w-5 text-center font-mono-tabular text-xs text-[#64748B]">
                  {idx + 1}
                </span>
                <img
                  src={item.track.thumbnailUrl}
                  alt={item.track.title}
                  className="h-9 w-14 shrink-0 rounded object-cover outline-1 -outline-offset-1 outline-white/10"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-[#F8FAFC]">{item.track.title}</p>
                    {item.source === 'youtube-radio' ? (
                      <span className="shrink-0 rounded border border-[#8B5CF6]/40 bg-[#8B5CF6]/20 px-1.5 py-0.2 text-[10px] font-semibold text-[#DDD6FE]">
                        Sugerido YT
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
                <button
                  type="button"
                  onClick={() => onLoadFromQueue('A', item.queueId)}
                  className="rounded border border-[#00D4FF]/40 px-2 py-1 text-xs font-semibold text-[#00D4FF] cursor-pointer"
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => onLoadFromQueue('B', item.queueId)}
                  className="rounded border border-[#FF8A00]/40 px-2 py-1 text-xs font-semibold text-[#FF8A00] cursor-pointer"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => onReorderQueue(idx, idx - 1)}
                  disabled={idx === 0}
                  className="rounded border border-[#1F2937] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                  aria-label="Subir"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onReorderQueue(idx, idx + 1)}
                  disabled={idx === queue.length - 1}
                  className="rounded border border-[#1F2937] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                  aria-label="Bajar"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveQueueItem(item.queueId)}
                  className="rounded border border-[#1F2937] p-1 text-[#EF4444] cursor-pointer"
                  aria-label="Quitar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
