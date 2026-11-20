import { useEffect, useRef, type MouseEvent, type MutableRefObject, type ReactElement } from 'react';
import type { DeckId, HotCue, LoopState } from '../../../shared/types';

export interface RgbWaveSample {
  low: number;
  mid: number;
  high: number;
}

interface RgbWaveformStripProps {
  deckId: DeckId;
  accentColor: string;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  waveformPeaks: number[] | null;
  hotCues: HotCue[];
  loop: LoopState | null;
  liveRgbRef?: MutableRefObject<Record<DeckId, RgbWaveSample[]>>;
  onSeek: (timeSec: number) => void;
}

export function RgbWaveformStrip({
  deckId,
  accentColor,
  playing,
  currentTimeSec,
  durationSec,
  waveformPeaks,
  hotCues,
  loop,
  liveRgbRef,
  onSeek
}: RgbWaveformStripProps): ReactElement {
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live 3-band scrolling RGB waveform via requestAnimationFrame (zero React re-renders)
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    let rafId = 0;
    const renderLive = () => {
      const w = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      ctx!.fillStyle = '#0A0F0D';
      ctx!.fillRect(0, 0, w, h);

      // Subtle horizontal center axis
      ctx!.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx!.fillRect(0, midY, w, 1);

      const samples = liveRgbRef?.current[deckId] ?? [];
      const maxSlots = 140;
      const barW = w / maxSlots;

      if (samples.length > 0) {
        const offset = Math.max(0, maxSlots - samples.length);
        for (let i = 0; i < samples.length; i += 1) {
          const s = samples[i];
          const x = (offset + i) * barW;
          const bw = Math.max(1.5, barW - 1);

          // Bass body in the deck's own colour, so A and B can never be confused
          const lowH = Math.max(1, s.low * (midY - 2));
          ctx!.globalAlpha = 0.9;
          ctx!.fillStyle = accentColor;
          ctx!.fillRect(x, midY - lowH, bw, lowH * 2);
          ctx!.globalAlpha = 1;

          // Mids in translucent ink
          const midH = s.mid * (midY - 4);
          if (midH > 1) {
            ctx!.fillStyle = 'rgba(243, 241, 234, 0.45)';
            ctx!.fillRect(x, midY - midH, bw, midH * 2);
          }

          // Highs as a crisp ink crest
          const hiH = s.high * (midY - 6);
          if (hiH > 1) {
            ctx!.fillStyle = 'rgba(243, 241, 234, 0.85)';
            ctx!.fillRect(x, midY - hiH, bw, hiH * 2);
          }
        }
      }

      // Center needle
      ctx!.fillStyle = '#F3F1EA';
      ctx!.fillRect(w - 3, 0, 2, h);

      rafId = requestAnimationFrame(renderLive);
    };

    rafId = requestAnimationFrame(renderLive);
    return () => cancelAnimationFrame(rafId);
  }, [deckId, liveRgbRef, accentColor]);

  // Full-track Overview + Hot Cues + Loop overlay + End Warning
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0A0F0D';
    ctx.fillRect(0, 0, w, h);

    const remaining = Math.max(0, durationSec - currentTimeSec);
    const isNearEnd = playing && durationSec > 20 && remaining <= 15;
    if (isNearEnd) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(0, 0, w, h);
    }

    const progress = durationSec > 0 ? Math.min(1, currentTimeSec / durationSec) : 0;

    if (waveformPeaks && waveformPeaks.length > 0) {
      const barW = w / waveformPeaks.length;
      for (let i = 0; i < waveformPeaks.length; i += 1) {
        const barH = Math.max(2, waveformPeaks[i] * (h - 6));
        const x = i * barW;
        const y = (h - barH) / 2;
        ctx.fillStyle = i / waveformPeaks.length <= progress ? accentColor : '#2A3530';
        ctx.fillRect(x, y, Math.max(1, barW - 0.8), barH);
      }
    } else {
      ctx.fillStyle = '#1E2722';
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, h / 2 - 2, w * progress, 4);
    }

    if (loop && durationSec > 0) {
      const lx1 = (loop.inSec / durationSec) * w;
      const lx2 = (loop.outSec / durationSec) * w;
      ctx.fillStyle = loop.active ? 'rgba(255, 244, 220, 0.22)' : 'rgba(143, 156, 149, 0.16)';
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), h);
    }

    if (durationSec > 0) {
      for (const cue of hotCues) {
        const cx = (cue.timeSec / durationSec) * w;
        ctx.fillStyle = cue.color;
        ctx.fillRect(cx - 1, 0, 2, h);
      }
    }

    const px = progress * w;
    ctx.fillStyle = '#F3F1EA';
    ctx.fillRect(px - 1, 0, 2, h);
  }, [waveformPeaks, currentTimeSec, durationSec, hotCues, loop, playing, accentColor]);

  const handleOverviewClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * durationSec);
  };

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={liveCanvasRef}
        width={480}
        height={32}
        className="h-8 w-full rounded-t-md border border-b-0 border-white/[0.06] bg-ground"
      />
      <canvas
        ref={overviewCanvasRef}
        width={480}
        height={24}
        onClick={handleOverviewClick}
        className="h-6 w-full cursor-pointer rounded-b-md border border-white/[0.06] bg-ground"
        title="Clic para saltar a cualquier punto de la canción"
      />
    </div>
  );
}

