import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
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
  const grooveRef = useRef<HTMLDivElement | null>(null);
  const timeSyncRef = useRef(currentTimeSec);
  const [scratching, setScratching] = useState(false);

  timeSyncRef.current = currentTimeSec;

  // Smooth 60fps platter spin while playing (no React state re-renders)
  useEffect(() => {
    if (!playing) {
      if (grooveRef.current) {
        grooveRef.current.style.transform = `rotate(${((currentTimeSec * 200) % 360).toFixed(1)}deg)`;
      }
      return;
    }

    let rafId = 0;
    const baseSec = timeSyncRef.current;
    const startMs = performance.now();

    const step = (now: number) => {
      const elapsedSec = (now - startMs) / 1000;
      const deg = ((baseSec + elapsedSec) * 200) % 360;
      if (grooveRef.current) {
        grooveRef.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [playing, currentTimeSec]);

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

  const progressRatio = durationSec > 0 ? Math.min(1, Math.max(0, currentTimeSec / durationSec)) : 0;
  const ringRadius = 48;
  const circumference = 2 * Math.PI * ringRadius;
  const dashOffset = circumference * (1 - progressRatio);
  const rotationDeg = (currentTimeSec * 200) % 360;

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
        className="relative flex h-[104px] w-[104px] shrink-0 cursor-grab items-center justify-center rounded-full border border-white/[0.08] bg-[#08090C] shadow-inner active:cursor-grabbing"
        style={{
          boxShadow: scratching || playing ? `0 0 0 1px ${accentColor}55` : undefined
        }}
        title={
          playing
            ? 'Arrastra borde o plato para Pitch Bend (Nudge temporal)'
            : 'Arrastra para buscar punto exacto (Scrub / Frame)'
        }
      >
        {/* Outer SVG LED progress arc */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
          viewBox="0 0 104 104"
          aria-hidden="true"
        >
          <circle
            cx="52"
            cy="52"
            r={ringRadius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="2.5"
          />
          <circle
            cx="52"
            cy="52"
            r={ringRadius}
            fill="none"
            stroke={playing || scratching ? accentColor : 'rgba(226,232,240,0.45)'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>

        {/* Tactile vinyl/CDJ rotating platter grooves */}
        <div
          ref={grooveRef}
          className="absolute inset-2 rounded-full border border-white/[0.08] bg-[repeating-radial-gradient(circle_at_center,#141720_0px,#0a0c10_3px,#11141c_5px)]"
          style={{ transform: `rotate(${rotationDeg.toFixed(1)}deg)` }}
        >
          <span
            className="absolute left-1/2 top-1 h-3 w-1 -translate-x-1/2 rounded-full"
            style={{ backgroundColor: playing ? accentColor : '#E2E8F0' }}
          />
        </div>

        {/* Center album art spindle */}
        <div className="relative z-10 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#151821]">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
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
          className="rounded border border-white/[0.08] bg-[#151821] px-1.5 py-0.5 text-[10px] text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
          title="Frenar momentáneamente (Bend -)"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`Brake Deck ${deckId}`}
          onClick={onBrake}
          className="inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-[#151821] px-1.5 py-0.5 text-[10px] font-semibold text-[#94A3B8] hover:border-[#EF4444]/50 hover:text-[#FCA5A5] cursor-pointer"
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
          className="rounded border border-white/[0.08] bg-[#151821] px-1.5 py-0.5 text-[10px] text-[#94A3B8] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
          title="Acelerar momentáneamente (Bend +)"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
