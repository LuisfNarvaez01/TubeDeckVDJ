import { useRef, useState, type PointerEvent, type ReactElement, type WheelEvent } from 'react';

interface RotaryKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  accentColor?: string;
  bipolar?: boolean;
  size?: number;
  onChange: (nextValue: number) => void;
  formatValue?: (v: number) => string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = Math.abs(endAngle - startAngle) <= 180 ? '0' : '1';
  const sweep = endAngle >= startAngle ? '0' : '1';
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function RotaryKnob({
  label,
  value,
  min,
  max,
  defaultValue = 0,
  accentColor = '#E6E6E9',
  bipolar = false,
  size = 40,
  onChange,
  formatValue
}: RotaryKnobProps): ReactElement {
  const dragStartRef = useRef<{ y: number; val: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const ratio = max > min ? (clamp(value, min, max) - min) / (max - min) : 0;
  const angle = -135 + ratio * 270;

  const center = size / 2;
  const radius = size / 2 - 5;

  const trackArc = describeArc(center, center, radius, -135, 135);
  const valueArc = bipolar
    ? angle >= 0
      ? describeArc(center, center, radius, 0, angle)
      : describeArc(center, center, radius, angle, 0)
    : describeArc(center, center, radius, -135, angle);

  const pointerEnd = polarToCartesian(center, center, radius - 4, angle);
  const formattedText = formatValue ? formatValue(value) : value.toFixed(1);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStartRef.current = { y: e.clientY, val: value };
    setDragging(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dy = dragStartRef.current.y - e.clientY;
    const delta = (dy / 110) * (max - min);
    const next = clamp(dragStartRef.current.val + delta, min, max);
    onChange(Number(next.toFixed(2)));
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragStartRef.current = null;
      setDragging(false);
    }
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = (max - min) * 0.03;
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(Number(clamp(value + dir * step, min, max).toFixed(2)));
  };

  return (
    <div className="relative flex flex-col items-center gap-0.5 select-none">
      {dragging ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute -top-6 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded border border-white/[0.14] bg-ground/95 px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold text-ink shadow-lg"
        >
          {formattedText}
        </div>
      ) : null}

      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onWheel={handleWheel}
        title={`${label}: ${formattedText} (doble clic para reset)`}
        className="relative cursor-ns-resize rounded-full focus:outline-none focus:ring-1 focus:ring-white/30"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path
            d={trackArc}
            fill="none"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path d={valueArc} fill="none" stroke={accentColor} strokeWidth={3} strokeLinecap="round" />
          <circle
            cx={center}
            cy={center}
            r={radius - 5}
            fill="#151518"
            stroke={dragging ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)'}
            strokeWidth={1.1}
          />
          <line
            x1={center}
            y1={center}
            x2={pointerEnd.x}
            y2={pointerEnd.y}
            stroke="#F5F5F6"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="text-[10px] font-semibold tracking-wider text-muted">{label}</span>
    </div>
  );
}
