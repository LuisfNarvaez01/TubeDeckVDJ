import { useCallback, type ReactElement } from 'react';
import { Monitor, ArrowLeftRight, Sparkles, Frame, Link2, Tv } from 'lucide-react';
import type { DeckId, DisplayInfo, VideoQualityTier } from '../../shared/types';
import type { VideoFxId } from '../video/VideoFxPipeline';
import type { VideoCrossfaderMode, VideoTransitionId } from '../video/WebGLVideoCompositor';

interface VideoPreviewBarProps {
  masterCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  attachPreviewContainer: (deck: DeckId, container: HTMLDivElement | null) => void;
  videoMix: number;
  videoMode: VideoCrossfaderMode;
  autoDurationSec: number;
  transition: VideoTransitionId;
  activeFx: Record<VideoFxId, boolean>;
  fxIntensity?: number;
  osdEnabled?: boolean;
  displays: DisplayInfo[];
  selectedDisplayId: number | null;
  outputOpen: boolean;
  frameEnabled?: boolean;
  activeQualityA?: VideoQualityTier | null;
  activeQualityB?: VideoQualityTier | null;
  showHotkeys?: boolean;
  onVideoMixChange: (mix: number) => void;
  onVideoModeChange: (mode: VideoCrossfaderMode) => void;
  onAutoDurationChange: (sec: number) => void;
  onTriggerAutoTransition: () => void;
  onTransitionChange: (id: VideoTransitionId) => void;
  onToggleFx: (fx: VideoFxId) => void;
  onFxIntensityChange?: (intensity: number) => void;
  onToggleOsdNow?: () => void;
  onSelectDisplay: (displayId: number) => void;
  onToggleOutputWindow: () => void;
  onOpenFramesDrawer?: () => void;
}

const TRANSITIONS: Array<{ id: VideoTransitionId; label: string }> = [
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'wipe-h', label: 'Wipe H' },
  { id: 'wipe-v', label: 'Wipe V' },
  { id: 'wipe-diag', label: 'Wipe Diag' },
  { id: 'zoom-push', label: 'Zoom Push' },
  { id: 'circle-iris', label: 'Iris' },
  { id: 'luma-fade', label: 'Luma' },
  { id: 'curtain-split', label: 'Cortina' },
  { id: 'slide', label: 'Slide' }
];

const FX_BUTTONS: Array<{ id: VideoFxId; label: string }> = [
  { id: 'blur', label: 'Blur' },
  { id: 'strobe', label: 'Strobe' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'hue-tint', label: 'Hue' },
  { id: 'bw-contrast', label: 'B&W' },
  { id: 'pixelate', label: 'Pixel' },
  { id: 'audio-shader', label: 'Shader' }
];

export function VideoPreviewBar({
  masterCanvasRef,
  attachPreviewContainer,
  videoMix,
  videoMode,
  autoDurationSec,
  transition,
  activeFx,
  fxIntensity = 0.7,
  osdEnabled = true,
  displays,
  selectedDisplayId,
  outputOpen,
  frameEnabled = false,
  activeQualityA = null,
  activeQualityB = null,
  showHotkeys = false,
  onVideoMixChange,
  onVideoModeChange,
  onAutoDurationChange,
  onTriggerAutoTransition,
  onTransitionChange,
  onToggleFx,
  onFxIntensityChange,
  onToggleOsdNow,
  onSelectDisplay,
  onToggleOutputWindow,
  onOpenFramesDrawer
}: VideoPreviewBarProps): ReactElement {
  const refA = useCallback(
    (el: HTMLDivElement | null) => attachPreviewContainer('A', el),
    [attachPreviewContainer]
  );
  const refB = useCallback(
    (el: HTMLDivElement | null) => attachPreviewContainer('B', el),
    [attachPreviewContainer]
  );

  return (
    <section
      className="flex flex-col justify-between gap-2 rounded-xl border border-white/[0.06] bg-surface p-2.5"
      aria-label="Cabina de Video Master"
    >
      {/* Compact Side-by-Side Monitors: Master Live (66%) + Stacked Previews A/B (34%) */}
      <div className="grid grid-cols-[1.85fr_1fr] gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 font-bold tracking-wider text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live" />
                MASTER LIVE
              </span>
              {frameEnabled ? (
                <span className="rounded border border-white/[0.12] bg-raised px-1 py-0.2 text-[10px] font-semibold text-ink-soft">
                  MARCO
                </span>
              ) : null}
            </div>
            <span
              className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                outputOpen
                  ? 'bg-live/15 text-live'
                  : 'bg-raised text-faint'
              }`}
            >
              {outputOpen ? 'P2 LIVE' : 'P2 OFF'}
            </span>
          </div>

          <div className="aspect-video w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black">
            <canvas ref={masterCanvasRef} className="h-full w-full object-contain" />
          </div>
        </div>

        <div className="flex flex-col justify-between gap-1.5">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold tracking-wider text-deck-a">DECK A</span>
              {activeQualityA ? (
                <span className="font-mono-tabular text-faint">{activeQualityA}</span>
              ) : null}
            </div>
            <div
              ref={refA}
              className="aspect-video w-full overflow-hidden rounded border border-deck-a/45 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold tracking-wider text-deck-b">DECK B</span>
              {activeQualityB ? (
                <span className="font-mono-tabular text-faint">{activeQualityB}</span>
              ) : null}
            </div>
            <div
              ref={refB}
              className="aspect-video w-full overflow-hidden rounded border border-deck-b/45 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
            />
          </div>
        </div>
      </div>

      {/* Broadcast Strip & Compact 2-Row 4x2 FX Matrix */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-ground p-2 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <select
              value={transition}
              onChange={(e) => onTransitionChange(e.target.value as VideoTransitionId)}
              className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-[10px] text-ink"
              aria-label="Transición Video"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onTriggerAutoTransition}
              className="relative inline-flex items-center gap-1 rounded border border-live/50 bg-live/15 px-2 py-0.5 text-[10px] font-semibold text-live hover:bg-live/25 cursor-pointer"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Auto {autoDurationSec}s
              {showHotkeys ? (
                <span className="hardware-keycap pointer-events-none ml-0.5 rounded px-1 text-[10px]">
                  V
                </span>
              ) : null}
            </button>

            <select
              value={autoDurationSec}
              onChange={(e) => onAutoDurationChange(Number(e.target.value))}
              className="rounded border border-white/[0.06] bg-raised px-1 py-0.5 font-mono-tabular text-[10px] text-ink"
              aria-label="Duración Auto Transición"
            >
              <option value={1}>1s</option>
              <option value={2}>2s</option>
              <option value={4}>4s</option>
              <option value={8}>8s</option>
            </select>

            {onOpenFramesDrawer ? (
              <button
                type="button"
                onClick={onOpenFramesDrawer}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${
                  frameEnabled
                    ? 'border-white/30 bg-raised-2 text-ink'
                    : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
                }`}
              >
                <Frame className="h-3 w-3" />
                Marcos
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {displays.length > 0 ? (
              <select
                value={selectedDisplayId ?? displays[0].id}
                onChange={(e) => onSelectDisplay(Number(e.target.value))}
                className="max-w-32 rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-[10px] text-ink"
                aria-label="Monitor Salida"
              >
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.bounds.width}×{d.bounds.height})
                  </option>
                ))}
              </select>
            ) : null}

            <button
              type="button"
              onClick={onToggleOutputWindow}
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                outputOpen
                  ? 'border-danger/60 bg-danger/20 text-danger-soft'
                  : 'border-live/60 bg-live/15 text-live hover:bg-live/25'
              }`}
            >
              <Monitor className="h-3 w-3" />
              {outputOpen ? 'Cerrar P2' : 'Abrir P2'}
            </button>
          </div>
        </div>

        {/* 2-Row Compact Video FX Pad Matrix + Intensity & Video Crossfade */}
        <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-1.5">
          <div className="grid grid-cols-4 gap-1">
            {FX_BUTTONS.map((fx) => (
              <button
                key={fx.id}
                type="button"
                onClick={() => onToggleFx(fx.id)}
                className={`rounded border py-0.5 text-[10px] font-semibold cursor-pointer ${
                  activeFx[fx.id]
                    ? 'border-white/35 bg-raised-2 text-ink'
                    : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
                }`}
              >
                {fx.label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Mostrar OSD Pista"
              onClick={() => onToggleOsdNow?.()}
              className={`inline-flex items-center justify-center gap-1 rounded border py-0.5 text-[10px] font-semibold cursor-pointer ${
                osdEnabled
                  ? 'border-live/50 bg-live/15 text-live'
                  : 'border-white/[0.06] bg-raised text-faint'
              }`}
              title="Mostrar u ocultar rótulo de pista (OSD) en Pantalla 2"
            >
              <Tv className="h-2.5 w-2.5" />
              OSD
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px]">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-muted" />
              <span className="text-faint">FX Mix</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={fxIntensity}
                onChange={(e) => onFxIntensityChange?.(Number(e.target.value))}
                className="w-16 accent-ink-2 cursor-pointer"
                aria-label="Intensidad Video FX"
              />
              <span className="w-7 font-mono-tabular text-muted">
                {Math.round(fxIntensity * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onVideoModeChange(videoMode === 'linked' ? 'independent' : 'linked')
                }
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold cursor-pointer ${
                  videoMode === 'linked'
                    ? 'border-live/50 bg-live/15 text-live'
                    : 'border-white/[0.06] bg-raised text-muted'
                }`}
                title="Enlazar transición de video al crossfader de audio"
              >
                <Link2 className="h-2.5 w-2.5" />
                {videoMode === 'linked' ? 'A+V' : 'Indep'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={videoMix}
                disabled={videoMode === 'linked'}
                onChange={(e) => onVideoMixChange(Number(e.target.value))}
                className="w-16 accent-live disabled:opacity-40 cursor-pointer"
                aria-label="Video Crossfader"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
