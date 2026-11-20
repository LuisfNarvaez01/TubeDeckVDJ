import type { ChangeEvent, ReactElement } from 'react';
import { Frame, Image as ImageIcon, Type, Tv, Camera, Upload } from 'lucide-react';
import type { OverlayConfig, OverlayCorner, VideoFramePreset } from '../video/OverlayCompositor';

interface OverlayControlsProps {
  config: OverlayConfig;
  onChange: (next: OverlayConfig) => void;
}

const FRAME_PRESETS: Array<{ id: VideoFramePreset; label: string }> = [
  { id: 'none', label: 'Sin Marco' },
  { id: 'minimal-studio', label: 'Studio' },
  { id: 'karaoke-stage', label: 'Karaoke' },
  { id: 'gala-gold', label: 'Gala Dorado' },
  { id: 'club-led', label: 'Club LED' }
];

export function OverlayControls({ config, onChange }: OverlayControlsProps): ReactElement {
  const frame = config.frame ?? {
    enabled: false,
    preset: 'minimal-studio',
    customDataUrl: null,
    insetPercent: 8,
    accentColor: '#0EA5E9',
    titleText: ''
  };

  const handleLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...config,
        logo: {
          ...config.logo,
          enabled: true,
          dataUrl: typeof reader.result === 'string' ? reader.result : null
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleCustomFrameFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...config,
        frame: {
          ...frame,
          enabled: true,
          preset: 'custom',
          customDataUrl: typeof reader.result === 'string' ? reader.result : null
        }
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Marcos / Video Frames */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] bg-[#08090C] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <Frame className="h-4 w-4 text-[#94A3B8]" />
            Marcos de Video (Video dentro del Marco)
          </h3>
          <span className="font-mono-tabular text-[11px] text-[#94A3B8]">
            {frame.enabled && frame.preset !== 'none' ? `Activo: ${frame.preset}` : 'Desactivado'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FRAME_PRESETS.map((p) => {
            const active =
              p.id === 'none'
                ? !frame.enabled || frame.preset === 'none'
                : frame.enabled && frame.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    frame: {
                      ...frame,
                      enabled: p.id !== 'none',
                      preset: p.id
                    }
                  })
                }
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  active
                    ? 'border-white/30 bg-[#1C202B] text-[#F8FAFC]'
                    : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {p.label}
              </button>
            );
          })}

          <label className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#151821] px-2.5 py-1 text-[11px] font-semibold text-[#CBD5E1] hover:bg-[#1C202B] cursor-pointer">
            <Upload className="h-3 w-3" />
            Subir Marco PNG
            <input
              type="file"
              accept="image/png,image/webp"
              onChange={handleCustomFrameFile}
              className="hidden"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[#94A3B8]">
            Margen del Marco (<span className="font-mono-tabular">{frame.insetPercent}%</span>)
            <input
              type="range"
              min={2}
              max={20}
              step={1}
              value={frame.insetPercent}
              onChange={(e) =>
                onChange({
                  ...config,
                  frame: { ...frame, enabled: true, insetPercent: Number(e.target.value) }
                })
              }
              className="accent-[#E2E8F0] cursor-pointer"
            />
          </label>

          <label className="flex flex-col gap-1 text-[#94A3B8]">
            Título superior del Evento / Karaoke
            <input
              type="text"
              value={frame.titleText}
              onChange={(e) =>
                onChange({
                  ...config,
                  frame: { ...frame, titleText: e.target.value }
                })
              }
              placeholder="Ej. Viernes de Karaoke En Vivo"
              className="rounded-lg border border-white/[0.06] bg-[#151821] px-2.5 py-1 text-xs text-[#F8FAFC] placeholder-[#64748B]"
            />
          </label>
        </div>
      </div>

      {/* Overlays: OSD, Texto, Logo, Webcam */}
      <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-[#08090C] p-3">
        <span className="font-semibold text-[#F8FAFC]">
          Elementos en Pantalla (OSD / Logo / Cámara)
        </span>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() =>
              onChange({ ...config, osd: { ...config.osd, enabled: !config.osd.enabled } })
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium cursor-pointer ${
              config.osd.enabled
                ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#10B981]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            OSD Pista
          </button>

          <button
            type="button"
            onClick={() =>
              onChange({
                ...config,
                marquee: { ...config.marquee, enabled: !config.marquee.enabled }
              })
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium cursor-pointer ${
              config.marquee.enabled
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
            }`}
          >
            <Type className="h-3.5 w-3.5" />
            Marquesina
          </button>

          {config.marquee.enabled ? (
            <input
              type="text"
              value={config.marquee.text}
              onChange={(e) =>
                onChange({ ...config, marquee: { ...config.marquee, text: e.target.value } })
              }
              placeholder="Texto deslizante en vivo..."
              className="w-48 rounded-lg border border-white/[0.06] bg-[#151821] px-2.5 py-1 text-xs text-[#F8FAFC]"
            />
          ) : null}

          <label className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#151821] px-2.5 py-1 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer">
            <ImageIcon className="h-3.5 w-3.5" />
            Subir Logo
            <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
          </label>

          {config.logo.dataUrl ? (
            <>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...config, logo: { ...config.logo, enabled: !config.logo.enabled } })
                }
                className={`rounded border px-2 py-0.5 cursor-pointer ${
                  config.logo.enabled
                    ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                    : 'border-white/[0.06] text-[#94A3B8]'
                }`}
              >
                Logo {config.logo.enabled ? 'ON' : 'OFF'}
              </button>
              <select
                value={config.logo.corner}
                onChange={(e) =>
                  onChange({
                    ...config,
                    logo: { ...config.logo, corner: e.target.value as OverlayCorner }
                  })
                }
                className="rounded border border-white/[0.06] bg-[#151821] px-1.5 py-0.5 text-[11px] text-[#F8FAFC]"
              >
                <option value="top-left">Sup. Izq</option>
                <option value="top-right">Sup. Der</option>
                <option value="bottom-left">Inf. Izq</option>
                <option value="bottom-right">Inf. Der</option>
              </select>
            </>
          ) : null}

          <button
            type="button"
            onClick={() =>
              onChange({ ...config, webcam: { ...config.webcam, enabled: !config.webcam.enabled } })
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium cursor-pointer ${
              config.webcam.enabled
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8]'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            Webcam PiP
          </button>
        </div>
      </div>
    </div>
  );
}
