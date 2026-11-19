import type { ReactElement } from 'react';
import { Play, Pause, RotateCcw, Headphones } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import { useDeckStore } from '../store/useDeckStore';

interface DeckPanelProps {
  deckId: DeckId;
  onTogglePlay: (deck: DeckId) => void;
  onSeek: (deck: DeckId, timeSec: number) => void;
  onToggleCueMonitor: (deck: DeckId) => void;
  onPitchChange: (deck: DeckId, pitchPercent: number, keyLock: boolean) => void;
  attachPreviewContainer: (deck: DeckId, container: HTMLDivElement | null) => void;
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
  attachPreviewContainer
}: DeckPanelProps): ReactElement {
  const deck = useDeckStore((s) => s.decks[deckId]);
  const accent = deckId === 'A' ? '#00D4FF' : '#FF8A00';
  const remaining = Math.max(0, deck.durationSec - deck.currentTimeSec);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-[#1F2735] bg-[#131822] p-3"
      aria-label={`Deck ${deckId}`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded font-bold text-xs text-[#0B0E14]"
            style={{ backgroundColor: accent }}
          >
            {deckId}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#F1F5F9]">
              {deck.track ? deck.track.title : 'Sin pista cargada'}
            </p>
            <p className="truncate text-xs text-[#94A3B8]">
              {deck.track ? deck.track.channel : 'Selecciona un video del buscador'}
            </p>
          </div>
        </div>
        <div className="text-right font-mono-tabular shrink-0">
          <div className="text-sm font-semibold text-[#F1F5F9]">{formatTime(deck.currentTimeSec)}</div>
          <div className="text-[11px] text-[#94A3B8]">-{formatTime(remaining)}</div>
        </div>
      </header>

      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[#1F2735] bg-black">
        <div
          ref={(node) => attachPreviewContainer(deckId, node)}
          className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
        />
        {deck.loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-[#00D4FF]">
            Cargando stream en RAM...
          </div>
        ) : null}
        {deck.error ? (
          <div className="absolute inset-x-2 bottom-2 rounded bg-[#EF4444]/90 px-2 py-1 text-xs text-white">
            {deck.error}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max(1, deck.durationSec)}
          step={0.1}
          value={deck.currentTimeSec}
          disabled={!deck.track}
          onChange={(e) => onSeek(deckId, Number(e.target.value))}
          className="w-full accent-[#00D4FF] cursor-pointer"
          aria-label={`Posición Deck ${deckId}`}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!deck.track || deck.loading}
            onClick={() => onTogglePlay(deckId)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-[#0B0E14] disabled:opacity-40 cursor-pointer"
            style={{ backgroundColor: deck.playing ? '#10B981' : accent }}
          >
            {deck.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {deck.playing ? 'Pausa' : 'Play'}
          </button>

          <button
            type="button"
            disabled={!deck.track}
            onClick={() => onSeek(deckId, 0)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#1F2735] bg-[#0B0E14] px-2.5 py-2 text-xs text-[#F1F5F9] hover:border-[#334155] disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Cue 0
          </button>

          <button
            type="button"
            onClick={() => onToggleCueMonitor(deckId)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium cursor-pointer ${
              deck.cueEnabled
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#C4B5FD]'
                : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8]'
            }`}
          >
            <Headphones className="h-3.5 w-3.5" />
            PFL
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono-tabular text-[#94A3B8]">
            {deck.pitchPercent >= 0 ? '+' : ''}
            {deck.pitchPercent.toFixed(1)}%
          </span>
          <input
            type="range"
            min={-16}
            max={16}
            step={0.1}
            value={deck.pitchPercent}
            onChange={(e) => onPitchChange(deckId, Number(e.target.value), deck.keyLock)}
            onDoubleClick={() => onPitchChange(deckId, 0, deck.keyLock)}
            className="w-24 accent-[#00D4FF] cursor-pointer"
            aria-label={`Pitch Deck ${deckId}`}
          />
          <button
            type="button"
            onClick={() => onPitchChange(deckId, deck.pitchPercent, !deck.keyLock)}
            className={`rounded border px-2 py-1 text-[11px] font-medium cursor-pointer ${
              deck.keyLock
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8]'
            }`}
          >
            Key
          </button>
        </div>
      </div>
    </section>
  );
}
