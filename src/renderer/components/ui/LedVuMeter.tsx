import { useEffect, useRef, type ReactElement } from 'react';

interface LedVuMeterProps {
  getLevel: () => number;
  label?: string;
  segments?: number;
  height?: number;
}

export function LedVuMeter({
  getLevel,
  label,
  segments = 14,
  height = 128
}: LedVuMeterProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef(0);
  const peakHoldFramesRef = useRef(0);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const level = Math.min(1, Math.max(0, getLevel()));
          const activeCount = Math.round(level * segments);

          if (activeCount >= peakHoldRef.current) {
            peakHoldRef.current = activeCount;
            peakHoldFramesRef.current = 24;
          } else if (peakHoldFramesRef.current > 0) {
            peakHoldFramesRef.current -= 1;
          } else {
            peakHoldRef.current = Math.max(0, peakHoldRef.current - 1);
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const gap = 2;
          const segH = (canvas.height - gap * (segments - 1)) / segments;

          for (let i = 0; i < segments; i += 1) {
            const idxFromBottom = segments - 1 - i;
            const y = i * (segH + gap);
            const lit = idxFromBottom < activeCount || idxFromBottom === peakHoldRef.current - 1;

            let color = '#10B981';
            if (idxFromBottom >= segments - 2) color = '#EF4444';
            else if (idxFromBottom >= segments - 5) color = '#F59E0B';

            ctx.fillStyle = lit ? color : '#1A2230';
            ctx.fillRect(0, y, canvas.width, segH);
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [getLevel, segments]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={12}
        height={height}
        className="rounded-sm bg-[#0B0E14] p-0.5 border border-[#1F2735]"
      />
      {label ? <span className="text-[9px] text-[#64748B]">{label}</span> : null}
    </div>
  );
}

