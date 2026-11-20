import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { Disc3, Minus, Plus, OctagonPause } from 'lucide-react';
import type { DeckId } from '../../../shared/types';

interface JogWheelProps {
  deckId: DeckId;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  thumbnailUrl?: string | null;
  accentColor: string;
  onNudge: (bendMultiplier: number) => void;
  onScrubDelta: (deltaSec: number) => void;
  onBrake: () => void;
}

export function JogWheel({
  deckId,
  playing,
  currentTimeSec,
  durationSec,
  thumbnailUrl,
  accentColor,
  onNudge,
  onScrubDelta,
  onBrake
}: JogWheelProps): ReactElement {
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0
  });
  const [scratching, setScratching] = useState(false);

  // 33.3 RPM = 200 degrees per second
  const rotationDeg = (currentTimeSec * 200) % 360;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    setScratching(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore synthetic test pointer events without pointerId
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = dragRef.current.lastY - e.clientY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    const delta = dx + dy * 0.5;
    if (Math.abs(delta) < 0.25) return;

    if (playing) {
      const bend = Math.min(1.08, Math.max(0.92, 1 + delta * 0.008));
      onNudge(bend);
    } else {
      onScrubDelta(delta * 0.08);
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setScratching(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore synthetic pointer release
    }
    if (playing) {
      onNudge(1);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Jog Wheel Deck ${deckId}`}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.round(durationSec))}
        aria-valuenow={Math.round(currentTimeSec)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onScrubDelta(-1.5);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            onScrubDelta(1.5);
          }
        }}
        className="relative flex h-24 w-24 shrink-0 cursor-grab items-center justify-center rounded-full border-2 bg-[#07090E] shadow-inner active:cursor-grabbing"
        style={{
          borderColor: scratching || playing ? accentColor : '#1F2937'
        }}
        title={
          playing
            ? 'Arrastra para Pitch Bend (Nudge temporal)'
            : 'Arrastra para buscar punto exacto (Scrub / Frame)'
        }
      >
        {/* Outer rotating vinyl grooves & position marker */}
        <div
          className="absolute inset-1 rounded-full border border-[#1F2937] bg-[radial-gradient(circle_at_center,#131924_0%,#090C12_65%,#111827_100%)]"
          style={{ transform: `rotate(${rotationDeg.toFixed(1)}deg)` }}
        >
          <span
            className="absolute left-1/2 top-1 h-2.5 w-1 -translate-x-1/2 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        </div>

        {/* Center album art cap */}
        <div className="relative z-10 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#0F141D]">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover outline-1 -outline-offset-1 outline-white/10"
            />
          ) : (
            <Disc3 className="h-5 w-5 text-[#64748B]" />
          )}
        </div>
      </div>

      {/* Pitch Bend +/- & Brake */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Bend - Deck ${deckId}`}
          onPointerDown={() => onNudge(0.95)}
          onPointerUp={() => onNudge(1)}
          onPointerLeave={() => onNudge(1)}
          className="rounded border border-[#1F2937] bg-[#090C12] px-1.5 py-0.5 text-[10px] text-[#94A3B8] hover:border-[#334155] hover:text-white cursor-pointer"
          title="Frenar momentáneamente (Bend -)"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`Brake Deck ${deckId}`}
          onClick={onBrake}
          className="inline-flex items-center gap-0.5 rounded border border-[#1F2937] bg-[#090C12] px-1.5 py-0.5 text-[10px] font-semibold text-[#94A3B8] hover:border-[#EF4444]/60 hover:text-[#FCA5A5] cursor-pointer"
          title="Parada tipo vinilo (Brake)"
        >
          <OctagonPause className="h-3 w-3" />
          BRK
        </button>
        <button
          type="button"
          aria-label={`Bend + Deck ${deckId}`}
          onPointerDown={() => onNudge(1.05)}
          onPointerUp={() => onNudge(1)}
          onPointerLeave={() => onNudge(1)}
          className="rounded border border-[#1F2937] bg-[#090C12] px-1.5 py-0.5 text-[10px] text-[#94A3B8] hover:border-[#334155] hover:text-white cursor-pointer"
          title="Acelerar momentáneamente (Bend +)"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

