import type { ChangeEvent, ReactElement } from 'react';
import { Image as ImageIcon, Type, Tv, Camera } from 'lucide-react';
import type { OverlayConfig, OverlayCorner } from '../video/OverlayCompositor';

interface OverlayControlsProps {
  config: OverlayConfig;
  onChange: (next: OverlayConfig) => void;
}

export function OverlayControls({ config, onChange }: OverlayControlsProps): ReactElement {
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

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] px-2.5 py-1.5 text-[11px]">
      <span className="font-semibold text-[#94A3B8]">OVERLAYS</span>

      <button
        type="button"
        onClick={() =>
          onChange({ ...config, osd: { ...config.osd, enabled: !config.osd.enabled } })
        }
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 cursor-pointer ${
          config.osd.enabled
            ? 'border-[#10B981] bg-[#10B981]/15 text-[#6EE7B7]'
            : 'border-[#1F2735] text-[#94A3B8]'
        }`}
      >
        <Tv className="h-3 w-3" />
        OSD Pista
      </button>

      <button
        type="button"
        onClick={() =>
          onChange({ ...config, marquee: { ...config.marquee, enabled: !config.marquee.enabled } })
        }
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 cursor-pointer ${
          config.marquee.enabled
            ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
            : 'border-[#1F2735] text-[#94A3B8]'
        }`}
      >
        <Type className="h-3 w-3" />
        Texto
      </button>

      {config.marquee.enabled ? (
        <input
          type="text"
          value={config.marquee.text}
          onChange={(e) =>
            onChange({ ...config, marquee: { ...config.marquee, text: e.target.value } })
          }
          placeholder="Texto en pantalla..."
          className="w-40 rounded border border-[#1F2735] bg-[#131822] px-2 py-0.5 text-[11px] text-[#F1F5F9]"
        />
      ) : null}

      <label className="inline-flex items-center gap-1 rounded border border-[#1F2735] px-2 py-1 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer">
        <ImageIcon className="h-3 w-3" />
        Logo
        <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
      </label>

      {config.logo.dataUrl ? (
        <>
          <button
            type="button"
            onClick={() =>
              onChange({ ...config, logo: { ...config.logo, enabled: !config.logo.enabled } })
            }
            className={`rounded border px-1.5 py-0.5 cursor-pointer ${
              config.logo.enabled
                ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
                : 'border-[#1F2735] text-[#94A3B8]'
            }`}
          >
            {config.logo.enabled ? 'ON' : 'OFF'}
          </button>
          <select
            value={config.logo.corner}
            onChange={(e) =>
              onChange({
                ...config,
                logo: { ...config.logo, corner: e.target.value as OverlayCorner }
              })
            }
            className="rounded border border-[#1F2735] bg-[#131822] px-1 py-0.5 text-[11px]"
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
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 cursor-pointer ${
          config.webcam.enabled
            ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#C4B5FD]'
            : 'border-[#1F2735] text-[#94A3B8]'
        }`}
      >
        <Camera className="h-3 w-3" />
        Webcam PiP
      </button>
    </div>
  );
}
