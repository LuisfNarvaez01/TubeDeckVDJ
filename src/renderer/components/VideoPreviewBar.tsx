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

  const previewMonitor = (deck: DeckId) => {
    const quality = deck === 'A' ? activeQualityA : activeQualityB;
    const visibleShare = deck === 'A' ? 1 - videoMix : videoMix;
    return (
      <div className="flex w-[clamp(140px,min(40%,28vh),300px)] min-w-0 shrink-0 flex-col gap-1 self-center">
        <div className="flex items-center justify-between text-[10px]">
          <span className={`font-bold tracking-[0.14em] ${deck === 'A' ? 'text-deck-a' : 'text-deck-b'}`}>
            PREVIA {deck}
          </span>
          <span className="font-mono-tabular text-faint">
            {quality ? `${quality} · ` : ''}
            {Math.round(visibleShare * 100)}% al aire
          </span>
        </div>
        <div
          ref={deck === 'A' ? refA : refB}
          className={`aspect-video w-full overflow-hidden rounded-lg border bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain ${
            deck === 'A' ? 'border-deck-a/45' : 'border-deck-b/45'
          }`}
        />
      </div>
    );
  };

  const chip = 'rounded border border-white/[0.06] bg-raised px-1.5 py-1 text-[10px] text-ink';
  const wingLabel = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-faint';

  return (
    <section
      className="grid grid-cols-[minmax(0,1fr)_clamp(220px,min(21vw,32vh),370px)_minmax(0,1fr)] items-stretch gap-3 rounded-xl border border-white/[0.06] bg-surface p-2.5"
      aria-label="Cabina de Video Master"
    >
      {/* Left wing: video transition controls, then Preview A beside the program */}
      <div className="flex min-w-0 gap-3">
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
          <span className={wingLabel}>Transición</span>
          <div className="flex flex-wrap items-center gap-1">
            <select
              value={transition}
              onChange={(e) => onTransitionChange(e.target.value as VideoTransitionId)}
              className={chip}
              aria-label="Transición Video"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              value={autoDurationSec}
              onChange={(e) => onAutoDurationChange(Number(e.target.value))}
              className={`${chip} font-mono-tabular`}
              aria-label="Duración Auto Transición"
            >
              <option value={1}>1s</option>
              <option value={2}>2s</option>
              <option value={4}>4s</option>
              <option value={8}>8s</option>
            </select>
          </div>
          <button
            type="button"
            onClick={onTriggerAutoTransition}
            className="relative inline-flex items-center justify-center gap-1.5 rounded-md border border-live/50 bg-live/15 px-2 py-1 text-[11px] font-semibold text-live hover:bg-live/25 cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Pasar al otro video · {autoDurationSec}s
            {showHotkeys ? (
              <span className="hardware-keycap pointer-events-none ml-0.5 rounded px-1 text-[10px]">V</span>
            ) : null}
          </button>
          <div className="flex items-center gap-1.5 text-[10px]">
            <button
              type="button"
              onClick={() => onVideoModeChange(videoMode === 'linked' ? 'independent' : 'linked')}
              className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 font-semibold cursor-pointer ${
                videoMode === 'linked'
                  ? 'border-live/50 bg-live/15 text-live'
                  : 'border-white/[0.06] bg-raised text-muted'
              }`}
              title="Enlazar la mezcla de video al crossfader de audio"
            >
              <Link2 className="h-3 w-3" />
              {videoMode === 'linked' ? 'A+V' : 'Indep'}
            </button>
            <span className="font-bold text-deck-a">A</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={videoMix}
              disabled={videoMode === 'linked'}
              onChange={(e) => onVideoMixChange(Number(e.target.value))}
              className="min-w-0 flex-1 accent-live disabled:opacity-40 cursor-pointer"
              aria-label="Video Crossfader"
            />
            <span className="font-bold text-deck-b">B</span>
          </div>
          {onOpenFramesDrawer ? (
            <button
              type="button"
              onClick={onOpenFramesDrawer}
              className={`inline-flex items-center justify-center gap-1 rounded border px-1.5 py-1 text-[10px] font-semibold cursor-pointer ${
                frameEnabled
                  ? 'border-white/30 bg-raised-2 text-ink'
                  : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
              }`}
            >
              <Frame className="h-3 w-3" />
              {frameEnabled ? 'Marco activo' : 'Marcos'}
            </button>
          ) : null}
        </div>
        {previewMonitor('A')}
      </div>

      {/* Program: what the room sees */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-[0.18em] text-live">
            <span className="h-2 w-2 rounded-full bg-danger shadow-[0_0_10px_rgba(255,82,71,0.8)]" />
            AL AIRE
            {frameEnabled ? (
              <span className="rounded border border-white/[0.12] bg-raised px-1 text-[10px] font-semibold tracking-normal text-ink-soft">
                MARCO
              </span>
            ) : null}
          </span>
          <span
            className={`rounded px-1.5 font-bold ${outputOpen ? 'bg-live/15 text-live' : 'bg-raised text-faint'}`}
          >
            {outputOpen ? 'PANTALLA 2 EN VIVO' : 'PANTALLA 2 APAGADA'}
          </span>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-white/[0.14]">
          <canvas ref={masterCanvasRef} className="h-full w-full object-contain" />
        </div>
      </div>

      {/* Right wing: Preview B beside the program, then video FX and Screen 2 output */}
      <div className="flex min-w-0 gap-3">
        {previewMonitor('B')}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
          <span className={wingLabel}>Efectos de video</span>
          <div className="grid grid-cols-4 gap-1">
            {FX_BUTTONS.map((fx) => (
              <button
                key={fx.id}
                type="button"
                onClick={() => onToggleFx(fx.id)}
                className={`rounded border py-1 text-[10px] font-semibold cursor-pointer ${
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
              className={`inline-flex items-center justify-center gap-1 rounded border py-1 text-[10px] font-semibold cursor-pointer ${
                osdEnabled ? 'border-live/50 bg-live/15 text-live' : 'border-white/[0.06] bg-raised text-faint'
              }`}
              title="Mostrar u ocultar el rótulo de la canción en Pantalla 2"
            >
              <Tv className="h-2.5 w-2.5" />
              OSD
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <Sparkles className="h-3 w-3 shrink-0 text-muted" />
            <span className="shrink-0 text-faint">Intensidad</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={fxIntensity}
              onChange={(e) => onFxIntensityChange?.(Number(e.target.value))}
              className="min-w-0 flex-1 accent-ink-2 cursor-pointer"
              aria-label="Intensidad Video FX"
            />
            <span className="w-8 shrink-0 text-right font-mono-tabular text-muted">
              {Math.round(fxIntensity * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1">
            {displays.length > 0 ? (
              <select
                value={selectedDisplayId ?? displays[0].id}
                onChange={(e) => onSelectDisplay(Number(e.target.value))}
                className={`${chip} min-w-0 flex-1`}
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
              className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold cursor-pointer ${
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
      </div>
    </section>
  );
}
