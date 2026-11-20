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
import type { MidiMapping, VideoQualityPreference } from '../../shared/types';
import type { MidiLearnMode } from '../controllers/MidiLearnEngine';
import { useSettingsStore } from '../store/useSettingsStore';

interface SettingsTabProps {
  onRefreshAudioDevices: () => void;
  onSelectMasterDevice: (deviceId: string) => void;
  onSelectCueDevice: (deviceId: string) => void;
  onToggleMonoSplit: (enabled: boolean) => void;
  onEnsureYtDlp: () => void;
  onResolutionChange: (res: '720p' | '1080p') => void;
  onVideoQualityChange?: (q: VideoQualityPreference) => void;
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
  onVideoQualityChange,
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
    <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto text-xs sm:grid-cols-2">
      {/* Audio Routing */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <Volume2 className="h-4 w-4 text-[#10B981]" />
            Salidas de Audio (Master / Audífonos)
          </h3>
          <button
            type="button"
            onClick={onRefreshAudioDevices}
            className="rounded border border-white/[0.06] bg-[#151821] p-1 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
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
              className="rounded border border-white/[0.06] bg-[#151821] px-2 py-1 text-[#F8FAFC]"
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
              className="rounded border border-white/[0.06] bg-[#151821] px-2 py-1 text-[#F8FAFC] disabled:opacity-50"
            >
              {settings.audioOutputs.map((d) => (
                <option key={`c-${d.deviceId}`} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-[#CBD5E1] cursor-pointer">
          <input
            type="checkbox"
            checked={settings.monoSplit}
            onChange={(e) => onToggleMonoSplit(e.target.checked)}
            className="accent-[#E2E8F0]"
          />
          Modo Mono Split (Izq = Master, Der = Audífonos)
        </label>

        {settings.audioNotice ? (
          <p className="rounded border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-2 py-1 text-[11px] text-[#F59E0B]">
            {settings.audioNotice}
          </p>
        ) : null}
      </div>

      {/* Video, Display & yt-dlp */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <Monitor className="h-4 w-4 text-[#94A3B8]" />
            Video Master, Monitores y yt-dlp
          </h3>
          <button
            type="button"
            disabled={settings.ytDlpStatus.downloading}
            onClick={onEnsureYtDlp}
            className="inline-flex items-center gap-1 rounded border border-white/[0.12] bg-[#151821] px-2 py-0.5 text-[11px] font-semibold text-[#F8FAFC] disabled:opacity-50 cursor-pointer"
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
            className="rounded border border-white/[0.06] bg-[#151821] px-2 py-1 text-[#F8FAFC]"
          >
            <option value="1080p">1920 × 1080 (Full HD 60 fps)</option>
            <option value="720p">1280 × 720 (HD 60 fps)</option>
          </select>
        </label>

        {onVideoQualityChange ? (
          <label className="flex flex-col gap-1 text-[#94A3B8]">
            Calidad Streaming Video YouTube (Anti-Cortes)
            <select
              value={settings.videoQuality}
              onChange={(e) => onVideoQualityChange(e.target.value as VideoQualityPreference)}
              className="rounded border border-white/[0.06] bg-[#151821] px-2 py-1 text-[#F8FAFC]"
            >
              <option value="auto">Automática (720p H.264 → baja si hay lentitud)</option>
              <option value="720p">720p HD fluido</option>
              <option value="480p">480p Ligero (Internet lento / Karaoke)</option>
              <option value="360p">360p Ultra-Ligero</option>
              <option value="1080p">1080p Full HD (Internet rápido)</option>
            </select>
          </label>
        ) : null}

        <div className="text-[11px] text-[#94A3B8]">
          Monitores:{' '}
          {settings.displays
            .map((d) => `${d.label} (${d.bounds.width}×${d.bounds.height})`)
            .join(' | ') || 'Detectando...'}
        </div>
      </div>

      {/* MIDI USB & MIDI Learn */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <Sliders className="h-4 w-4 text-[#94A3B8]" />
            Controladores MIDI USB (MIDI Learn)
          </h3>
          {onInitMidi ? (
            <button
              type="button"
              onClick={onInitMidi}
              className="rounded border border-white/[0.06] bg-[#151821] px-2 py-0.5 text-[11px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
            >
              Escanear MIDI
            </button>
          ) : null}
        </div>

        <div className="text-[11px] text-[#94A3B8]">
          Detectados:{' '}
          {midiDevices.length > 0 ? midiDevices.join(', ') : 'Ningún controlador USB conectado'}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MIDI_CONTROLS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onStartMidiLearn?.(c.key, c.mode)}
              className={`rounded border px-2 py-1 text-[11px] cursor-pointer ${
                learningControlKey === c.key
                  ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                  : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {learningControlKey === c.key ? `Mueve control para ${c.label}...` : `Learn: ${c.label}`}
            </button>
          ))}
        </div>

        {midiMappings.length > 0 ? (
          <div className="max-h-20 overflow-y-auto divide-y divide-white/[0.06] rounded border border-white/[0.06]">
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
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
            <CloudDownload className="h-4 w-4 text-[#94A3B8]" />
            Actualizaciones (GitHub Releases)
          </h3>
          <span className="rounded border border-white/[0.06] bg-[#151821] px-2 py-0.5 font-mono-tabular text-[11px] text-[#CBD5E1]">
            v{upd?.currentVersion ?? '2.2.0'}
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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#151821]">
            <div
              className="h-full bg-[#10B981]"
              style={{ width: `${Math.min(100, upd.progressPercent)}%` }}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={upd?.state === 'checking' || upd?.state === 'downloading'}
            onClick={() => onCheckForUpdates?.()}
            className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-[#151821] px-2.5 py-1 text-[11px] font-semibold text-[#F8FAFC] hover:bg-[#1C202B] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Buscar actualizaciones
          </button>

          {upd?.state === 'available' ? (
            <button
              type="button"
              onClick={() => onDownloadUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/50 bg-[#10B981]/15 px-2.5 py-1 text-[11px] font-semibold text-[#10B981] cursor-pointer"
            >
              <Download className="h-3 w-3" />
              Descargar v{upd.availableVersion}
            </button>
          ) : null}

          {upd?.state === 'downloaded' ? (
            <button
              type="button"
              onClick={() => onInstallUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-[#10B981] bg-[#10B981] px-2.5 py-1 text-[11px] font-bold text-[#08090C] cursor-pointer"
            >
              <RotateCw className="h-3 w-3" />
              Reiniciar e instalar
            </button>
          ) : null}
        </div>
      </div>

      {/* Keyboard shortcuts summary */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-[#08090C] p-3 text-[11px] text-[#94A3B8] sm:col-span-2">
        <h3 className="font-semibold text-[#F8FAFC]">Atajos de Teclado DJ Activos</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono-tabular sm:grid-cols-3">
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
