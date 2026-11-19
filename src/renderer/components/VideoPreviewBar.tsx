import type { ReactElement } from 'react';
import { Monitor, ArrowLeftRight, Sparkles } from 'lucide-react';
import type { DeckId, DisplayInfo } from '../../shared/types';
import type { VideoCrossfaderMode, VideoTransitionId } from '../video/WebGLVideoCompositor';
import type { VideoFxId } from '../video/VideoFxPipeline';

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
  onVideoMixChange: (mix: number) => void;
  onVideoModeChange: (mode: VideoCrossfaderMode) => void;
  onAutoDurationChange: (sec: number) => void;
  onTriggerAutoTransition: () => void;
  onTransitionChange: (id: VideoTransitionId) => void;
  onToggleFx: (fx: VideoFxId) => void;
  onSelectDisplay: (displayId: number) => void;
  onToggleOutputWindow: () => void;
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
  onVideoMixChange,
  onVideoModeChange,
  onAutoDurationChange,
  onTriggerAutoTransition,
  onTransitionChange,
  onToggleFx,
  onSelectDisplay,
  onToggleOutputWindow
}: VideoPreviewBarProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-[#1F2735] bg-[#131822] p-2.5"
      aria-label="Cabina de Video Master"
    >
      <div className="grid grid-cols-[120px_1fr_120px] items-center gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wider text-[#00D4FF]">PREVIEW A</span>
          <div
            ref={(el) => attachPreviewContainer('A', el)}
            className="aspect-video w-full overflow-hidden rounded border border-[#00D4FF]/40 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold tracking-wider text-[#10B981]">MASTER LIVE</span>
            <span
              className={`rounded px-1.5 py-0.5 font-bold ${
                outputOpen ? 'bg-[#EF4444]/20 text-[#FCA5A5]' : 'bg-[#1F2735] text-[#94A3B8]'
              }`}
            >
              {outputOpen ? 'PANTALLA 2 ON AIR' : 'SALIDA OFF'}
            </span>
          </div>
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-[#10B981]/50 bg-black">
            <canvas ref={masterCanvasRef} className="h-full w-full object-contain" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wider text-[#FF8A00]">PREVIEW B</span>
          <div
            ref={(el) => attachPreviewContainer('B', el)}
            className="aspect-video w-full overflow-hidden rounded border border-[#FF8A00]/40 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] px-2 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <select
            value={videoMode}
            onChange={(e) => onVideoModeChange(e.target.value as VideoCrossfaderMode)}
            className="rounded border border-[#1F2735] bg-[#131822] px-1.5 py-0.5 text-[11px]"
            aria-label="Modo Video Crossfader"
          >
            <option value="linked">Video: Linked</option>
            <option value="independent">Video: Indep.</option>
            <option value="auto-timed">Video: Auto</option>
          </select>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={videoMix}
            disabled={videoMode === 'linked'}
            onChange={(e) => onVideoMixChange(Number(e.target.value))}
            className="w-24 accent-[#10B981] disabled:opacity-50"
            aria-label="Video Crossfader"
          />

          <button
            type="button"
            onClick={onTriggerAutoTransition}
            className="inline-flex items-center gap-1 rounded border border-[#10B981]/50 bg-[#10B981]/15 px-2 py-0.5 font-medium text-[#6EE7B7] cursor-pointer"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Auto {autoDurationSec}s
          </button>

          <select
            value={autoDurationSec}
            onChange={(e) => onAutoDurationChange(Number(e.target.value))}
            className="rounded border border-[#1F2735] bg-[#131822] px-1 py-0.5 text-[11px]"
            aria-label="Duración Auto Transición"
          >
            <option value={1}>1s</option>
            <option value={2}>2s</option>
            <option value={4}>4s</option>
            <option value={8}>8s</option>
          </select>

          <select
            value={transition}
            onChange={(e) => onTransitionChange(e.target.value as VideoTransitionId)}
            className="rounded border border-[#1F2735] bg-[#131822] px-1.5 py-0.5 text-[11px]"
            aria-label="Transición Video"
          >
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          {displays.length > 0 ? (
            <select
              value={selectedDisplayId ?? displays[0].id}
              onChange={(e) => onSelectDisplay(Number(e.target.value))}
              className="max-w-36 rounded border border-[#1F2735] bg-[#131822] px-1.5 py-0.5 text-[11px]"
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
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-semibold cursor-pointer ${
              outputOpen
                ? 'border-[#EF4444] bg-[#EF4444]/20 text-[#FCA5A5]'
                : 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
            }`}
          >
            <Monitor className="h-3 w-3" />
            {outputOpen ? 'Cerrar P2' : 'Abrir P2'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold text-[#94A3B8]">
          <Sparkles className="h-3 w-3 text-[#8B5CF6]" />
          FX:
        </span>
        {FX_BUTTONS.map((fx) => (
          <button
            key={fx.id}
            type="button"
            onClick={() => onToggleFx(fx.id)}
            className={`rounded border px-2 py-0.5 cursor-pointer ${
              activeFx[fx.id]
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/25 text-[#DDD6FE]'
                : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8]'
            }`}
          >
            {fx.label}
          </button>
        ))}
      </div>
    </section>
  );
}

