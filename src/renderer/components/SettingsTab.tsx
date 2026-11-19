import type { ReactElement } from 'react';
import { RefreshCw, Download, Monitor, Volume2 } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

interface SettingsTabProps {
  onRefreshAudioDevices: () => void;
  onSelectMasterDevice: (deviceId: string) => void;
  onSelectCueDevice: (deviceId: string) => void;
  onToggleMonoSplit: (enabled: boolean) => void;
  onEnsureYtDlp: () => void;
  onResolutionChange: (res: '720p' | '1080p') => void;
}

export function SettingsTab({
  onRefreshAudioDevices,
  onSelectMasterDevice,
  onSelectCueDevice,
  onToggleMonoSplit,
  onEnsureYtDlp,
  onResolutionChange
}: SettingsTabProps): ReactElement {
  const settings = useSettingsStore();

  return (
    <div className="grid h-full grid-cols-3 gap-3 overflow-y-auto text-xs">
      {/* Audio Routing */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
            <Volume2 className="h-4 w-4 text-[#10B981]" />
            Salidas de Audio (Master / Audífonos)
          </h3>
          <button
            type="button"
            onClick={onRefreshAudioDevices}
            className="rounded border border-[#1F2735] p-1 text-[#94A3B8] hover:text-white cursor-pointer"
            title="Actualizar dispositivos"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="flex flex-col gap-1 text-[#94A3B8]">
          Salida Master (Parlantes)
          <select
            value={settings.masterDeviceId}
            onChange={(e) => onSelectMasterDevice(e.target.value)}
            className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1.5 text-[#F1F5F9]"
          >
            {settings.audioOutputs.map((d) => (
              <option key={`m-${d.deviceId}`} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[#94A3B8]">
          Salida Audífonos (Cue / PFL)
          <select
            value={settings.cueDeviceId}
            disabled={settings.monoSplit}
            onChange={(e) => onSelectCueDevice(e.target.value)}
            className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1.5 text-[#F1F5F9] disabled:opacity-50"
          >
            {settings.audioOutputs.map((d) => (
              <option key={`c-${d.deviceId}`} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-[#F1F5F9] cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={settings.monoSplit}
            onChange={(e) => onToggleMonoSplit(e.target.checked)}
            className="accent-[#8B5CF6]"
          />
          Modo Mono Split (Izq = Master, Der = Audífonos)
        </label>

        {settings.audioNotice ? (
          <p className="rounded bg-[#FF8A00]/15 px-2 py-1 text-[11px] text-[#FDBA74]">
            {settings.audioNotice}
          </p>
        ) : null}
      </div>

      {/* Video & Display */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
        <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
          <Monitor className="h-4 w-4 text-[#00D4FF]" />
          Video Master y Monitores
        </h3>

        <label className="flex flex-col gap-1 text-[#94A3B8]">
          Resolución del Compositor Master
          <select
            value={settings.outputResolution}
            onChange={(e) => onResolutionChange(e.target.value as '720p' | '1080p')}
            className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1.5 text-[#F1F5F9]"
          >
            <option value="1080p">1920 × 1080 (Full HD 60 fps)</option>
            <option value="720p">1280 × 720 (HD 60 fps)</option>
          </select>
        </label>

        <div className="text-[11px] text-[#94A3B8]">
          Monitores detectados: <strong className="text-[#F1F5F9]">{settings.displays.length}</strong>
          <ul className="mt-1 space-y-1">
            {settings.displays.map((d) => (
              <li key={d.id} className="truncate">
                • {d.label} ({d.bounds.width}×{d.bounds.height}){d.isPrimary ? ' [Principal]' : ' [Externo]'}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* yt-dlp Engine */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
        <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
          <Download className="h-4 w-4 text-[#8B5CF6]" />
          Motor de Streaming YouTube (RAM)
        </h3>

        <div className="rounded border border-[#1F2735] bg-[#131822] p-2 text-[11px]">
          Estado de <code>yt-dlp</code>:{' '}
          <span
            className={
              settings.ytDlpStatus.available ? 'font-semibold text-[#10B981]' : 'font-semibold text-[#FF8A00]'
            }
          >
            {settings.ytDlpStatus.available ? 'Disponible' : 'Se descargará al usar'}
          </span>
          {settings.ytDlpStatus.binaryPath ? (
            <p className="mt-1 truncate text-[#64748B]">{settings.ytDlpStatus.binaryPath}</p>
          ) : null}
          {settings.ytDlpStatus.error ? (
            <p className="mt-1 text-[#EF4444]">{settings.ytDlpStatus.error}</p>
          ) : null}
        </div>

        <button
          type="button"
          disabled={settings.ytDlpStatus.downloading}
          onClick={onEnsureYtDlp}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#00D4FF]/50 bg-[#00D4FF]/15 px-3 py-1.5 font-semibold text-[#00D4FF] disabled:opacity-50 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          {settings.ytDlpStatus.downloading ? 'Descargando...' : 'Verificar / Instalar yt-dlp'}
        </button>
      </div>
    </div>
  );
}
