import type { ReactElement } from 'react';
import {
  RefreshCw,
  Download,
  Monitor,
  Volume2,
  Sliders,
  Trash2,
  CloudDownload,
  RotateCw
} from 'lucide-react';
import type { MidiMapping } from '../../shared/types';
import type { MidiLearnMode } from '../controllers/MidiLearnEngine';
import { useSettingsStore } from '../store/useSettingsStore';

interface SettingsTabProps {
  onRefreshAudioDevices: () => void;
  onSelectMasterDevice: (deviceId: string) => void;
  onSelectCueDevice: (deviceId: string) => void;
  onToggleMonoSplit: (enabled: boolean) => void;
  onEnsureYtDlp: () => void;
  onResolutionChange: (res: '720p' | '1080p') => void;
  midiDevices?: string[];
  midiMappings?: MidiMapping[];
  learningControlKey?: string | null;
  onInitMidi?: () => void;
  onStartMidiLearn?: (controlKey: string, mode: MidiLearnMode) => void;
  onDeleteMidiMapping?: (id: string) => void;
  onCheckForUpdates?: () => void;
  onDownloadUpdate?: () => void;
  onInstallUpdate?: () => void;
}

const MIDI_CONTROLS: Array<{ key: string; label: string; mode: MidiLearnMode }> = [
  { key: 'mixer.crossfader', label: 'Crossfader Audio', mode: 'absolute' },
  { key: 'deckA.fader', label: 'Fader Canal A', mode: 'absolute' },
  { key: 'deckB.fader', label: 'Fader Canal B', mode: 'absolute' },
  { key: 'deckA.playPause', label: 'Play/Pausa Deck A', mode: 'trigger' },
  { key: 'deckB.playPause', label: 'Play/Pausa Deck B', mode: 'trigger' },
  { key: 'video.autoTransition', label: 'Transición Auto Video', mode: 'trigger' }
];

export function SettingsTab({
  onRefreshAudioDevices,
  onSelectMasterDevice,
  onSelectCueDevice,
  onToggleMonoSplit,
  onEnsureYtDlp,
  onResolutionChange,
  midiDevices = [],
  midiMappings = [],
  learningControlKey = null,
  onInitMidi,
  onStartMidiLearn,
  onDeleteMidiMapping,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate
}: SettingsTabProps): ReactElement {
  const settings = useSettingsStore();
  const upd = settings.updaterStatus;

  return (
    <div className="grid h-full grid-cols-2 gap-3 overflow-y-auto text-xs">
      {/* Audio Routing */}
      <div className="flex flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
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

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[#94A3B8]">
            Master (Parlantes)
            <select
              value={settings.masterDeviceId}
              onChange={(e) => onSelectMasterDevice(e.target.value)}
              className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-[#F1F5F9]"
            >
              {settings.audioOutputs.map((d) => (
                <option key={`m-${d.deviceId}`} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[#94A3B8]">
            Audífonos (Cue / PFL)
            <select
              value={settings.cueDeviceId}
              disabled={settings.monoSplit}
              onChange={(e) => onSelectCueDevice(e.target.value)}
              className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-[#F1F5F9] disabled:opacity-50"
            >
              {settings.audioOutputs.map((d) => (
                <option key={`c-${d.deviceId}`} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-[#F1F5F9] cursor-pointer">
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

      {/* Video, Display & yt-dlp */}
      <div className="flex flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
            <Monitor className="h-4 w-4 text-[#00D4FF]" />
            Video Master, Monitores y yt-dlp
          </h3>
          <button
            type="button"
            disabled={settings.ytDlpStatus.downloading}
            onClick={onEnsureYtDlp}
            className="inline-flex items-center gap-1 rounded border border-[#00D4FF]/50 bg-[#00D4FF]/15 px-2 py-0.5 text-[11px] font-semibold text-[#00D4FF] disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3 w-3" />
            {settings.ytDlpStatus.available ? 'yt-dlp OK' : 'Instalar yt-dlp'}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-[#94A3B8]">
          Resolución Master (60 fps)
          <select
            value={settings.outputResolution}
            onChange={(e) => onResolutionChange(e.target.value as '720p' | '1080p')}
            className="rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-[#F1F5F9]"
          >
            <option value="1080p">1920 × 1080 (Full HD 60 fps)</option>
            <option value="720p">1280 × 720 (HD 60 fps)</option>
          </select>
        </label>

        <div className="text-[11px] text-[#94A3B8]">
          Monitores: {settings.displays.map((d) => `${d.label} (${d.bounds.width}×${d.bounds.height})`).join(' | ') || 'Detectando...'}
        </div>
      </div>

      {/* MIDI USB & MIDI Learn */}
      <div className="flex flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
            <Sliders className="h-4 w-4 text-[#8B5CF6]" />
            Controladores MIDI USB (MIDI Learn)
          </h3>
          {onInitMidi ? (
            <button
              type="button"
              onClick={onInitMidi}
              className="rounded border border-[#1F2735] px-2 py-0.5 text-[11px] text-[#94A3B8] hover:text-white cursor-pointer"
            >
              Escanear MIDI
            </button>
          ) : null}
        </div>

        <div className="text-[11px] text-[#94A3B8]">
          Detectados: {midiDevices.length > 0 ? midiDevices.join(', ') : 'Ningún controlador USB conectado'}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MIDI_CONTROLS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onStartMidiLearn?.(c.key, c.mode)}
              className={`rounded border px-2 py-1 text-[11px] cursor-pointer ${
                learningControlKey === c.key
                  ? 'border-[#FF8A00] bg-[#FF8A00]/20 text-[#FDBA74]'
                  : 'border-[#1F2735] bg-[#131822] text-[#94A3B8] hover:text-white'
              }`}
            >
              {learningControlKey === c.key ? `Mueve control para ${c.label}...` : `Learn: ${c.label}`}
            </button>
          ))}
        </div>

        {midiMappings.length > 0 ? (
          <div className="max-h-20 overflow-y-auto divide-y divide-[#1F2735] rounded border border-[#1F2735]">
            {midiMappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-2 py-1 text-[11px]">
                <span className="truncate">
                  {m.deviceName} • {m.controlKey} ({m.statusType.toUpperCase()} {m.ccOrNote})
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteMidiMapping?.(m.id)}
                  className="text-[#EF4444] cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Auto-Updater (GitHub Releases) */}
      <div className="flex flex-col gap-2 rounded-lg border border-[#1F2937] bg-[#07090E] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <CloudDownload className="h-4 w-4 text-[#00D4FF]" />
            Actualizaciones (GitHub Releases)
          </h3>
          <span className="rounded bg-[#0F141D] px-2 py-0.5 font-mono-tabular text-[11px] text-[#94A3B8]">
            v{upd?.currentVersion ?? '2.0.0'}
          </span>
        </div>

        <div className="text-[11px] text-[#94A3B8]">
          Estado:{' '}
          <span className="font-semibold text-[#F8FAFC]">
            {!upd || upd.state === 'dev-mode'
              ? 'Modo desarrollo (auto-update activo en .exe instalado)'
              : upd.state === 'idle'
                ? 'Listo para comprobar'
                : upd.state === 'checking'
                  ? 'Buscando en GitHub...'
                  : upd.state === 'not-available'
                    ? 'Versión actualizada'
                    : upd.state === 'available'
                      ? `Disponible v${upd.availableVersion ?? ''}`
                      : upd.state === 'downloading'
                        ? `Descargando ${upd.progressPercent.toFixed(0)}%`
                        : upd.state === 'downloaded'
                          ? `Descargada v${upd.availableVersion ?? ''} — lista para instalar`
                          : `Error: ${upd.error ?? 'fallo de red'}`}
          </span>
        </div>

        {upd?.state === 'downloading' ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0F141D]">
            <div
              className="h-full bg-[#00D4FF]"
              style={{ width: `${Math.min(100, upd.progressPercent)}%` }}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={upd?.state === 'checking' || upd?.state === 'downloading'}
            onClick={() => onCheckForUpdates?.()}
            className="inline-flex items-center gap-1 rounded border border-[#00D4FF]/50 bg-[#00D4FF]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00D4FF] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Buscar actualizaciones
          </button>

          {upd?.state === 'available' ? (
            <button
              type="button"
              onClick={() => onDownloadUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/50 bg-[#10B981]/20 px-2.5 py-1 text-[11px] font-semibold text-[#6EE7B7] cursor-pointer"
            >
              <Download className="h-3 w-3" />
              Descargar v{upd.availableVersion}
            </button>
          ) : null}

          {upd?.state === 'downloaded' ? (
            <button
              type="button"
              onClick={() => onInstallUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-[#10B981] bg-[#10B981] px-2.5 py-1 text-[11px] font-bold text-[#07090E] cursor-pointer"
            >
              <RotateCw className="h-3 w-3" />
              Reiniciar e instalar
            </button>
          ) : null}
        </div>
      </div>

      {/* Keyboard shortcuts summary */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[#1F2937] bg-[#07090E] p-3 text-[11px] text-[#94A3B8]">
        <h3 className="font-semibold text-[#F8FAFC]">Atajos de Teclado DJ Activos</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono-tabular">
          <span>Space / Shift+Space: Play A / B</span>
          <span>Q / W: Cue Deck A / B</span>
          <span>S / Shift+S: Sync A / B</span>
          <span>1..8 / Shift+1..8: Hot Cues</span>
          <span>← / → / C: Crossfader</span>
          <span>V: Auto Transición Video</span>
        </div>
      </div>
    </div>
  );
}
