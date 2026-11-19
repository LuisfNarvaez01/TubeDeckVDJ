import { useState, type ReactElement } from 'react';
import { ArrowUp, ArrowDown, Trash2, Sparkles } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface QueueTabProps {
  onLoadFromQueue: (deck: DeckId, queueId: string) => void;
  onReorderQueue: (fromIdx: number, toIdx: number) => void;
  onRemoveQueueItem: (queueId: string) => void;
  onToggleAutomix: (enabled: boolean) => void;
}

export function QueueTab({
  onLoadFromQueue,
  onReorderQueue,
  onRemoveQueueItem,
  onToggleAutomix
}: QueueTabProps): ReactElement {
  const queue = useLibraryStore((s) => s.queue);
  const automixEnabled = useLibraryStore((s) => s.automixEnabled);
  const statusNote = useLibraryStore((s) => s.automixStatusNote);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleAutomix(!automixEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-semibold cursor-pointer ${
              automixEnabled
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                : 'border-[#1F2735] bg-[#131822] text-[#94A3B8]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Automix: {automixEnabled ? 'ACTIVO' : 'INACTIVO'}
          </button>
          <span className="text-[11px] text-[#94A3B8]">
            Pre-carga a 30s del final y mezcla automática (salto si un video falla)
          </span>
        </div>
        <span className="font-mono-tabular text-[11px] text-[#94A3B8]">{queue.length} en cola</span>
      </div>

      {statusNote ? (
        <div className="rounded border border-[#FF8A00]/40 bg-[#FF8A00]/10 px-3 py-1.5 text-xs text-[#FDBA74]">
          {statusNote}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#1F2735] bg-[#0B0E14] divide-y divide-[#1F2735]">
        {queue.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            La cola Up Next está vacía. Agrega videos desde el buscador.
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
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#131822]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-5 text-center font-mono-tabular text-xs text-[#64748B]">
                  {idx + 1}
                </span>
                <img
                  src={item.track.thumbnailUrl}
                  alt={item.track.title}
                  className="h-9 w-14 shrink-0 rounded object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#F1F5F9]">{item.track.title}</p>
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
                        ? 'Pre-cargado'
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
                  className="rounded border border-[#00D4FF]/40 px-2 py-1 text-xs text-[#00D4FF] cursor-pointer"
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => onLoadFromQueue('B', item.queueId)}
                  className="rounded border border-[#FF8A00]/40 px-2 py-1 text-xs text-[#FF8A00] cursor-pointer"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => onReorderQueue(idx, idx - 1)}
                  disabled={idx === 0}
                  className="rounded border border-[#1F2735] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                  aria-label="Subir"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onReorderQueue(idx, idx + 1)}
                  disabled={idx === queue.length - 1}
                  className="rounded border border-[#1F2735] p-1 text-[#94A3B8] disabled:opacity-30 cursor-pointer"
                  aria-label="Bajar"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveQueueItem(item.queueId)}
                  className="rounded border border-[#1F2735] p-1 text-[#EF4444] cursor-pointer"
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

