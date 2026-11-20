import { useCallback, type ReactElement } from 'react';
import { Monitor, ArrowLeftRight, Sparkles, Frame, Link2 } from 'lucide-react';
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
  displays: DisplayInfo[];
  selectedDisplayId: number | null;
  outputOpen: boolean;
  frameEnabled?: boolean;
  activeQualityA?: VideoQualityTier | null;
  activeQualityB?: VideoQualityTier | null;
  onVideoMixChange: (mix: number) => void;
  onVideoModeChange: (mode: VideoCrossfaderMode) => void;
  onAutoDurationChange: (sec: number) => void;
  onTriggerAutoTransition: () => void;
  onTransitionChange: (id: VideoTransitionId) => void;
  onToggleFx: (fx: VideoFxId) => void;
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
  displays,
  selectedDisplayId,
  outputOpen,
  frameEnabled = false,
  activeQualityA = null,
  activeQualityB = null,
  onVideoMixChange,
  onVideoModeChange,
  onAutoDurationChange,
  onTriggerAutoTransition,
  onTransitionChange,
  onToggleFx,
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
      className="flex flex-col gap-2 rounded-xl border border-[#262F3F] bg-[#141820] p-2.5"
      aria-label="Cabina de Video Master"
    >
      {/* Large 16:9 Master Live Stage */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-wider text-[#10B981]">MASTER LIVE</span>
            {frameEnabled ? (
              <span className="rounded border border-[#0EA5E9]/40 bg-[#0EA5E9]/15 px-1.5 py-0.2 font-semibold text-[#0EA5E9]">
                MARCO ACTIVO
              </span>
            ) : null}
          </div>
          <span
            className={`rounded px-1.5 py-0.5 font-bold ${
              outputOpen ? 'bg-[#EF4444]/20 text-[#FCA5A5]' : 'bg-[#1B212D] text-[#94A3B8]'
            }`}
          >
            {outputOpen ? 'PANTALLA 2 ON AIR' : 'PANTALLA 2 OFF'}
          </span>
        </div>

        <div className="aspect-video w-full overflow-hidden rounded-lg border border-[#262F3F] bg-black">
          <canvas ref={masterCanvasRef} className="h-full w-full object-contain" />
        </div>
      </div>

      {/* Symmetrical Spacious Previews A & B */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold tracking-wider text-[#0EA5E9]">DECK A PREVIEW</span>
            {activeQualityA ? (
              <span className="font-mono-tabular text-[#94A3B8]">{activeQualityA}</span>
            ) : null}
          </div>
          <div
            ref={refA}
            className="aspect-video w-full overflow-hidden rounded-md border border-[#0EA5E9]/40 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold tracking-wider text-[#F59E0B]">DECK B PREVIEW</span>
            {activeQualityB ? (
              <span className="font-mono-tabular text-[#94A3B8]">{activeQualityB}</span>
            ) : null}
          </div>
          <div
            ref={refB}
            className="aspect-video w-full overflow-hidden rounded-md border border-[#F59E0B]/40 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
          />
        </div>
      </div>

      {/* Organized Broadcast Control Bar */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[#262F3F] bg-[#0B0D11] p-2 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={transition}
              onChange={(e) => onTransitionChange(e.target.value as VideoTransitionId)}
              className="rounded border border-[#262F3F] bg-[#141820] px-1.5 py-0.5 text-[11px] text-[#F8FAFC]"
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
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/50 bg-[#10B981]/15 px-2 py-0.5 font-semibold text-[#10B981] hover:bg-[#10B981]/25 cursor-pointer"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Auto {autoDurationSec}s
            </button>

            <select
              value={autoDurationSec}
              onChange={(e) => onAutoDurationChange(Number(e.target.value))}
              className="rounded border border-[#262F3F] bg-[#141820] px-1 py-0.5 text-[11px] text-[#F8FAFC]"
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
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-semibold cursor-pointer ${
                  frameEnabled
                    ? 'border-[#0EA5E9] bg-[#0EA5E9]/20 text-[#0EA5E9]'
                    : 'border-[#262F3F] bg-[#141820] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                <Frame className="h-3 w-3" />
                Marcos
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {displays.length > 0 ? (
              <select
                value={selectedDisplayId ?? displays[0].id}
                onChange={(e) => onSelectDisplay(Number(e.target.value))}
                className="max-w-36 rounded border border-[#262F3F] bg-[#141820] px-1.5 py-0.5 text-[11px] text-[#F8FAFC]"
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
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-0.5 font-bold cursor-pointer ${
                outputOpen
                  ? 'border-[#EF4444] bg-[#EF4444]/20 text-[#FCA5A5]'
                  : 'border-[#0EA5E9] bg-[#0EA5E9]/15 text-[#0EA5E9] hover:bg-[#0EA5E9]/25'
              }`}
            >
              <Monitor className="h-3 w-3" />
              {outputOpen ? 'Cerrar P2' : 'Abrir P2'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 border-t border-[#1E2634]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-1 font-semibold text-[#64748B] mr-0.5">
              <Sparkles className="h-3 w-3 text-[#6366F1]" />
              FX
            </span>
            {FX_BUTTONS.map((fx) => (
              <button
                key={fx.id}
                type="button"
                onClick={() => onToggleFx(fx.id)}
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer ${
                  activeFx[fx.id]
                    ? 'border-[#6366F1] bg-[#6366F1]/25 text-[#C7D2FE]'
                    : 'border-[#262F3F] bg-[#141820] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {fx.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onVideoModeChange(videoMode === 'linked' ? 'independent' : 'linked')
              }
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${
                videoMode === 'linked'
                  ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#10B981]'
                  : 'border-[#262F3F] bg-[#141820] text-[#94A3B8]'
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
              className="w-16 accent-[#10B981] disabled:opacity-40 cursor-pointer"
              aria-label="Video Crossfader"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
