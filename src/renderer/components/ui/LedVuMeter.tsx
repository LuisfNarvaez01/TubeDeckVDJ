import { useEffect, useRef, type ReactElement } from 'react';

interface LedVuMeterProps {
  getLevel: () => number;
  getStereoLevels?: () => [number, number];
  stereo?: boolean;
  label?: string;
  segments?: number;
  height?: number;
}

export function LedVuMeter({
  getLevel,
  getStereoLevels,
  stereo = false,
  label,
  segments = 18,
  height = 128
}: LedVuMeterProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef<[number, number]>([0, 0]);
  const peakHoldFramesRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const [rawL, rawR] = getStereoLevels
            ? getStereoLevels()
            : [getLevel(), getLevel()];
          const channels = stereo ? [rawL, rawR] : [rawL];

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const gapY = 1.5;
          const segH = (canvas.height - gapY * (segments - 1)) / segments;
          const colGap = stereo ? 2 : 0;
          const colW = stereo ? (canvas.width - colGap) / 2 : canvas.width;

          channels.forEach((raw, chIdx) => {
            const level = Math.min(1, Math.max(0, raw));
            const activeCount = Math.round(level * segments);

            if (activeCount >= peakHoldRef.current[chIdx]) {
              peakHoldRef.current[chIdx] = activeCount;
              peakHoldFramesRef.current[chIdx] = 26;
            } else if (peakHoldFramesRef.current[chIdx] > 0) {
              peakHoldFramesRef.current[chIdx] -= 1;
            } else {
              peakHoldRef.current[chIdx] = Math.max(0, peakHoldRef.current[chIdx] - 1);
            }

            const x = chIdx * (colW + colGap);
            for (let i = 0; i < segments; i += 1) {
              const idxFromBottom = segments - 1 - i;
              const y = i * (segH + gapY);
              const isPeak = idxFromBottom === peakHoldRef.current[chIdx] - 1 && peakHoldRef.current[chIdx] > 0;
              const lit = idxFromBottom < activeCount || isPeak;

              let color = '#F0FDFF';
              if (idxFromBottom >= segments - 2) color = '#FF5247';
              else if (idxFromBottom >= segments - 5) color = '#F5C542';
              else if (isPeak) color = '#F5F5F6';

              ctx.fillStyle = lit ? color : '#151518';
              ctx.fillRect(x, y, colW, segH);
            }
          });
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [getLevel, getStereoLevels, stereo, segments]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={stereo ? 16 : 11}
        height={height}
        className="rounded-sm border border-white/[0.06] bg-ground p-0.5"
      />
      {label ? <span className="font-mono-tabular text-[10px] text-faint">{label}</span> : null}
    </div>
  );
}
