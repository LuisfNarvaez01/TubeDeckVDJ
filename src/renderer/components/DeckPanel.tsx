import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { Play, Pause, RotateCcw, Headphones } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import { useDeckStore } from '../store/useDeckStore';

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
  onSync
}: DeckPanelProps): ReactElement {
  const deck = useDeckStore((s) => s.decks[deckId]);
  const setDeckPatch = useDeckStore((s) => s.setDeckPatch);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const accent = deckId === 'A' ? '#00D4FF' : '#FF8A00';
  const remaining = Math.max(0, deck.durationSec - deck.currentTimeSec);
  const effectiveBpm = deck.bpm ? Number((deck.bpm * (1 + deck.pitchPercent / 100)).toFixed(1)) : null;

  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(0, 0, w, h);

    const peaks = deck.waveformPeaks;
    const progress = deck.durationSec > 0 ? Math.min(1, deck.currentTimeSec / deck.durationSec) : 0;

    if (peaks && peaks.length > 0) {
      const barW = w / peaks.length;
      for (let i = 0; i < peaks.length; i += 1) {
        const barH = Math.max(3, peaks[i] * (h - 8));
        const x = i * barW;
        const y = (h - barH) / 2;
        ctx.fillStyle = i / peaks.length <= progress ? accent : '#334155';
        ctx.fillRect(x, y, Math.max(1, barW - 1), barH);
      }
    } else {
      ctx.fillStyle = '#1F2735';
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.fillStyle = accent;
      ctx.fillRect(0, h / 2 - 2, w * progress, 4);
    }

    if (deck.loop && deck.durationSec > 0) {
      const lx1 = (deck.loop.inSec / deck.durationSec) * w;
      const lx2 = (deck.loop.outSec / deck.durationSec) * w;
      ctx.fillStyle = deck.loop.active ? 'rgba(16, 185, 129, 0.25)' : 'rgba(148, 163, 184, 0.15)';
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), h);
    }

    if (deck.durationSec > 0) {
      for (const cue of deck.hotCues) {
        const cx = (cue.timeSec / deck.durationSec) * w;
        ctx.fillStyle = cue.color;
        ctx.fillRect(cx - 1, 0, 2, h);
      }
    }

    // Playhead
    const px = progress * w;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(px - 1, 0, 2, h);
  }, [deck.waveformPeaks, deck.currentTimeSec, deck.durationSec, deck.hotCues, deck.loop, accent]);

  const handleWaveformClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!deck.track || deck.durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(deckId, ratio * deck.durationSec);
  };

  return (
    <section
      className="flex flex-col gap-2.5 rounded-xl border border-[#1F2735] bg-[#131822] p-3"
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
              {deck.track ? deck.track.channel : 'Carga un video del buscador o cola'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded border border-[#1F2735] bg-[#0B0E14] px-2 py-1 text-xs">
            <span className="font-mono-tabular font-semibold text-[#F1F5F9]">
              {effectiveBpm ? effectiveBpm.toFixed(1) : '--.-'}
            </span>
            <span className="text-[10px] text-[#94A3B8]">BPM</span>
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
              className="rounded border border-[#1F2735] bg-[#131822] px-1.5 py-0.5 text-[10px] font-semibold text-[#F1F5F9] cursor-pointer"
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
            <div className="text-xs font-semibold text-[#F1F5F9]">{formatTime(deck.currentTimeSec)}</div>
            <div className="text-[10px] text-[#94A3B8]">-{formatTime(remaining)}</div>
          </div>
        </div>
      </header>

      <div className="relative">
        <canvas
          ref={waveCanvasRef}
          width={480}
          height={54}
          onClick={handleWaveformClick}
          className="h-14 w-full rounded-lg border border-[#1F2735] bg-[#0B0E14] cursor-pointer"
        />
        {deck.loading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/75 text-xs text-[#00D4FF]">
            Cargando stream en RAM...
          </div>
        ) : null}
        {deck.error ? (
          <div className="mt-1 rounded bg-[#EF4444]/90 px-2 py-1 text-xs text-white">
            {deck.error}
          </div>
        ) : null}
      </div>

      {/* 8 Hot Cues */}
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
              title={cue ? `Cue ${slot}: ${formatTime(cue.timeSec)} (Shift+Clic o Clic derecho para borrar)` : `Guardar Hot Cue ${slot}`}
              className="rounded border py-1 text-[11px] font-mono-tabular font-semibold cursor-pointer"
              style={{
                borderColor: cue ? cue.color : '#1F2735',
                backgroundColor: cue ? `${cue.color}28` : '#0B0E14',
                color: cue ? '#F1F5F9' : '#64748B'
              }}
            >
              {slot}
            </button>
          );
        })}
      </div>

      {/* Auto-Loop + Manual Loop */}
      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onLoopIn(deckId)}
            className="rounded border border-[#1F2735] bg-[#0B0E14] px-2 py-1 text-[#94A3B8] hover:text-white cursor-pointer"
          >
            IN
          </button>
          <button
            type="button"
            onClick={() => onLoopOut(deckId)}
            className="rounded border border-[#1F2735] bg-[#0B0E14] px-2 py-1 text-[#94A3B8] hover:text-white cursor-pointer"
          >
            OUT
          </button>
          <button
            type="button"
            onClick={() => onToggleLoopExit(deckId)}
            className={`rounded border px-2 py-1 font-semibold cursor-pointer ${
              deck.loop?.active
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8]'
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
              className={`rounded border px-2 py-1 font-mono-tabular cursor-pointer ${
                deck.loop?.active && deck.loop.beats === beats
                  ? 'border-[#10B981] bg-[#10B981]/20 text-[#6EE7B7]'
                  : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8] hover:text-white'
              }`}
            >
              {beats}
            </button>
          ))}
        </div>
      </div>

      {/* Transport + Pitch */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!deck.track || deck.loading}
            onClick={() => onTogglePlay(deckId)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#0B0E14] disabled:opacity-40 cursor-pointer"
            style={{ backgroundColor: deck.playing ? '#10B981' : accent }}
          >
            {deck.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {deck.playing ? 'Pausa' : 'Play'}
          </button>

          <button
            type="button"
            disabled={!deck.track}
            onClick={() => onSeek(deckId, 0)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#1F2735] bg-[#0B0E14] px-2 py-1.5 text-xs text-[#F1F5F9] hover:border-[#334155] disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Cue
          </button>

          <button
            type="button"
            onClick={() => onToggleCueMonitor(deckId)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium cursor-pointer ${
              deck.cueEnabled
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#C4B5FD]'
                : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8]'
            }`}
          >
            <Headphones className="h-3.5 w-3.5" />
            PFL
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              const nextRange = deck.pitchRange === 8 ? 16 : deck.pitchRange === 16 ? 50 : 8;
              setDeckPatch(deckId, { pitchRange: nextRange });
            }}
            className="rounded border border-[#1F2735] bg-[#0B0E14] px-1.5 py-0.5 text-[10px] text-[#94A3B8] cursor-pointer"
          >
            ±{deck.pitchRange}%
          </button>
          <span className="w-12 text-right font-mono-tabular text-[11px] text-[#94A3B8]">
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
            className="w-20 accent-[#00D4FF] cursor-pointer"
            aria-label={`Pitch Deck ${deckId}`}
          />
          <button
            type="button"
            onClick={() => onPitchChange(deckId, deck.pitchPercent, !deck.keyLock)}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer ${
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
