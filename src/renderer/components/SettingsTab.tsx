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
import { YouTubeAccountCard } from './YouTubeAccess';
import { MediaCacheCard } from './MediaCacheCard';

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
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Volume2 className="h-4 w-4 text-live" />
            Salidas de Audio (Master / Audífonos)
          </h3>
          <button
            type="button"
            onClick={onRefreshAudioDevices}
            className="rounded border border-white/[0.06] bg-raised p-1 text-muted hover:text-ink cursor-pointer"
            title="Actualizar dispositivos"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-muted">
            Master (Parlantes)
            <select
              value={settings.masterDeviceId}
              onChange={(e) => onSelectMasterDevice(e.target.value)}
              className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink"
            >
              {settings.audioOutputs.map((d) => (
                <option key={`m-${d.deviceId}`} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-muted">
            Audífonos (Cue / PFL)
            <select
              value={settings.cueDeviceId}
              disabled={settings.monoSplit}
              onChange={(e) => onSelectCueDevice(e.target.value)}
              className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink disabled:opacity-50"
            >
              {settings.audioOutputs.map((d) => (
                <option key={`c-${d.deviceId}`} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={settings.monoSplit}
            onChange={(e) => onToggleMonoSplit(e.target.checked)}
            className="accent-ink-2"
          />
          Modo Mono Split (Izq = Master, Der = Audífonos)
        </label>

        {settings.audioNotice ? (
          <p className="rounded border border-deck-b/30 bg-deck-b/10 px-2 py-1 text-[11px] text-deck-b">
            {settings.audioNotice}
          </p>
        ) : null}
      </div>

      {/* Video, Display & yt-dlp */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Monitor className="h-4 w-4 text-muted" />
            Video Master, Monitores y yt-dlp
          </h3>
          <button
            type="button"
            disabled={settings.ytDlpStatus.downloading}
            onClick={onEnsureYtDlp}
            className="inline-flex items-center gap-1 rounded border border-white/[0.12] bg-raised px-2 py-0.5 text-[11px] font-semibold text-ink disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3 w-3" />
            {settings.ytDlpStatus.available ? 'yt-dlp OK' : 'Instalar yt-dlp'}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-muted">
          Resolución Master (60 fps)
          <select
            value={settings.outputResolution}
            onChange={(e) => onResolutionChange(e.target.value as '720p' | '1080p')}
            className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink"
          >
            <option value="1080p">1920 × 1080 (Full HD 60 fps)</option>
            <option value="720p">1280 × 720 (HD 60 fps)</option>
          </select>
        </label>

        {onVideoQualityChange ? (
          <label className="flex flex-col gap-1 text-muted">
            Calidad Streaming Video YouTube (Anti-Cortes)
            <select
              value={settings.videoQuality}
              onChange={(e) => onVideoQualityChange(e.target.value as VideoQualityPreference)}
              className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink"
            >
              <option value="auto">Automática (720p H.264 → baja si hay lentitud)</option>
              <option value="720p">720p HD fluido</option>
              <option value="480p">480p Ligero (Internet lento / Karaoke)</option>
              <option value="360p">360p Ultra-Ligero</option>
              <option value="1080p">1080p Full HD (Internet rápido)</option>
            </select>
          </label>
        ) : null}

        <div className="text-[11px] text-muted">
          Monitores:{' '}
          {settings.displays
            .map((d) => `${d.label} (${d.bounds.width}×${d.bounds.height})`)
            .join(' | ') || 'Detectando...'}
        </div>
      </div>

      {/* MIDI USB & MIDI Learn */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Sliders className="h-4 w-4 text-muted" />
            Controladores MIDI USB (MIDI Learn)
          </h3>
          {onInitMidi ? (
            <button
              type="button"
              onClick={onInitMidi}
              className="rounded border border-white/[0.06] bg-raised px-2 py-0.5 text-[11px] text-muted hover:text-ink cursor-pointer"
            >
              Escanear MIDI
            </button>
          ) : null}
        </div>

        <div className="text-[11px] text-muted">
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
                  ? 'border-live/60 bg-live/15 text-live'
                  : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
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
                  className="text-danger cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <YouTubeAccountCard />
      <MediaCacheCard />

      {/* Auto-Updater (GitHub Releases) */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <CloudDownload className="h-4 w-4 text-muted" />
            Acerca de Proyecta
          </h3>
          <span className="rounded border border-white/[0.06] bg-raised px-2 py-0.5 font-mono-tabular text-[11px] text-ink-soft">
            {upd?.currentVersion ? `v${upd.currentVersion}` : '—'}
          </span>
        </div>
        <p className="text-[11px] text-muted">
          Proyecta es parte del ecosistema <span className="font-semibold text-ink">Lantify</span>.
        </p>

        <div className="text-[11px] text-muted">
          Estado:{' '}
          <span className="font-semibold text-ink">
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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div
              className="h-full bg-live"
              style={{ width: `${Math.min(100, upd.progressPercent)}%` }}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={upd?.state === 'checking' || upd?.state === 'downloading'}
            onClick={() => onCheckForUpdates?.()}
            className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-raised-2 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Buscar actualizaciones
          </button>

          {upd?.state === 'available' ? (
            <button
              type="button"
              onClick={() => onDownloadUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-live/50 bg-live/15 px-2.5 py-1 text-[11px] font-semibold text-live cursor-pointer"
            >
              <Download className="h-3 w-3" />
              Descargar v{upd.availableVersion}
            </button>
          ) : null}

          {upd?.state === 'downloaded' ? (
            <button
              type="button"
              onClick={() => onInstallUpdate?.()}
              className="inline-flex items-center gap-1 rounded border border-live bg-live px-2.5 py-1 text-[11px] font-bold text-ground cursor-pointer"
            >
              <RotateCw className="h-3 w-3" />
              Reiniciar e instalar
            </button>
          ) : null}
        </div>
      </div>

      {/* Keyboard shortcuts summary */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-ground p-3 text-[11px] text-muted sm:col-span-2">
        <h3 className="font-semibold text-ink">Atajos de Teclado DJ Activos</h3>
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
