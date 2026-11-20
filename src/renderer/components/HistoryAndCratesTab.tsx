import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { History, FolderPlus, Download, ListPlus, HardDriveDownload, X, Sparkles } from 'lucide-react';
import type { Crate, DeckId, HistoryEntry, MixSession, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface HistoryAndCratesTabProps {
  activeSessionId: string | null;
  onNewSession: (title?: string) => Promise<void>;
  onEndActiveSession: () => Promise<void>;
  onAddTracksToQueue: (tracks: YouTubeTrack[]) => void;
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  crates: Crate[];
  onRefreshCrates: () => Promise<void>;
  onStartBatchDownload?: (sessionId: string, format: 'video' | 'audio') => void;
  onCancelBatchDownload?: () => void;
}

export function HistoryAndCratesTab({
  activeSessionId,
  onNewSession,
  onEndActiveSession,
  onAddTracksToQueue,
  onLoadToDeck,
  crates,
  onRefreshCrates,
  onStartBatchDownload,
  onCancelBatchDownload
}: HistoryAndCratesTabProps): ReactElement {
  const [sessions, setSessions] = useState<MixSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(activeSessionId);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [downloadFmt, setDownloadFmt] = useState<'video' | 'audio'>('video');

  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [crateTracks, setCrateTracks] = useState<YouTubeTrack[]>([]);
  const [newCrateName, setNewCrateName] = useState('');

  const tasteProfile = useLibraryStore((s) => s.tasteProfile);
  const batchDownload = useLibraryStore((s) => s.batchDownload);

  const refreshSessions = async () => {
    const res = await window.tubedeckAPI?.listSessions();
    if (res?.success) {
      setSessions(res.data);
      if (!selectedSessionId && res.data.length > 0) {
        setSelectedSessionId(res.data[0].id);
      }
    }
  };

  useEffect(() => {
    void refreshSessions();
  }, [activeSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setEntries([]);
      return;
    }
    void window.tubedeckAPI?.getSessionHistory(selectedSessionId).then((res) => {
      if (res.success) setEntries(res.data);
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedCrateId) {
      setCrateTracks([]);
      return;
    }
    void window.tubedeckAPI?.getCrateTracks(selectedCrateId).then((res) => {
      if (res.success) setCrateTracks(res.data);
    });
  }, [selectedCrateId]);

  const handleExport = async (format: 'json' | 'csv' | 'm3u') => {
    if (!selectedSessionId || !window.tubedeckAPI) return;
    const res = await window.tubedeckAPI.exportSession(selectedSessionId, format);
    if (res.success && res.data) {
      setExportNote(`Exportado en ${res.data}`);
    } else if (!res.success) {
      setExportNote(`Error: ${res.error}`);
    }
  };

  const handleCreateCrate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newCrateName.trim();
    if (!name || !window.tubedeckAPI) return;
    const res = await window.tubedeckAPI.createCrate(name, '#10D9A0');
    if (res.success) {
      setNewCrateName('');
      await onRefreshCrates();
      setSelectedCrateId(res.data.id);
    }
  };

  const reloadSessionToQueue = () => {
    const tracks: YouTubeTrack[] = entries.map((e) => ({
      videoId: e.videoId,
      title: e.title,
      channel: e.channel,
      durationSec: e.durationSec,
      thumbnailUrl: e.videoId.startsWith('local_')
        ? ''
        : `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
      isLive: false,
      source: e.videoId.startsWith('local_') ? 'local' : 'youtube'
    }));
    onAddTracksToQueue(tracks);
  };

  return (
    <div className="grid h-full grid-cols-2 gap-3 text-xs">
      {/* Left: Mix History + Learned Taste + Batch Offline Download */}
      <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <History className="h-4 w-4 text-muted" />
            Historial de Mixes y Preferencias
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void onNewSession()}
              className="rounded border border-white/[0.1] bg-raised px-2 py-1 text-[11px] font-semibold text-ink hover:bg-raised-2 cursor-pointer"
            >
              Nueva Sesión
            </button>
            {activeSessionId ? (
              <button
                type="button"
                onClick={() => void onEndActiveSession()}
                className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-[11px] text-muted hover:text-ink cursor-pointer"
              >
                Cerrar Activa
              </button>
            ) : null}
          </div>
        </div>

        {/* Learned Taste Profile Summary */}
        {tasteProfile && tasteProfile.totalPlays > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/[0.06] bg-surface px-2 py-1 text-[10px]">
            <span className="inline-flex items-center gap-1 font-semibold text-ink-soft">
              <Sparkles className="h-3 w-3 text-muted" />
              Afinidad (<span className="font-mono-tabular">{tasteProfile.totalPlays}</span> pistas):
            </span>
            {tasteProfile.topChannels.slice(0, 3).map((c) => (
              <span key={c.name} className="rounded bg-raised px-1.5 py-0.2 text-ink">
                {c.name}
              </span>
            ))}
            {tasteProfile.topKeywords.slice(0, 4).map((k) => (
              <span
                key={k.word}
                className="rounded border border-white/[0.06] px-1.5 py-0.2 text-muted"
              >
                {k.word}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={selectedSessionId ?? ''}
            onChange={(e) => setSelectedSessionId(e.target.value || null)}
            className="min-w-36 flex-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-xs text-ink"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.endedAt ? 'Cerrada' : 'En curso'})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={entries.length === 0}
            onClick={reloadSessionToQueue}
            className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-raised px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer"
          >
            <ListPlus className="h-3.5 w-3.5" />
            Recargar Mix
          </button>

          {(['json', 'csv', 'm3u'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={!selectedSessionId}
              onClick={() => void handleExport(fmt)}
              className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-[11px] uppercase text-muted hover:text-ink disabled:opacity-40 cursor-pointer"
            >
              <Download className="h-3 w-3" />
              {fmt}
            </button>
          ))}
        </div>

        {/* Batch Offline Download Strip */}
        {onStartBatchDownload ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-surface px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              <HardDriveDownload className="h-3.5 w-3.5 text-muted" />
              <span className="font-semibold text-ink">Guardar sesión offline:</span>
              <select
                aria-label="Formato Descarga Sesión"
                value={downloadFmt}
                onChange={(e) => setDownloadFmt(e.target.value as 'video' | 'audio')}
                className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-[11px] text-ink"
              >
                <option value="video">Video MP4 (720p)</option>
                <option value="audio">Solo Audio M4A</option>
              </select>
            </div>

            {batchDownload?.status === 'running' ? (
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-live">
                  {batchDownload.completed}/{batchDownload.total} —{' '}
                  {batchDownload.currentTitle.slice(0, 22)}
                </span>
                <button
                  type="button"
                  onClick={onCancelBatchDownload}
                  className="inline-flex items-center gap-1 rounded border border-danger/50 bg-danger/15 px-2 py-0.5 text-danger-soft cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!selectedSessionId || entries.length === 0}
                onClick={() => selectedSessionId && onStartBatchDownload(selectedSessionId, downloadFmt)}
                className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2.5 py-0.5 font-mono-tabular font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer"
              >
                Descargar Lote ({entries.length})
              </button>
            )}
          </div>
        ) : null}

        {batchDownload && batchDownload.status === 'done' ? (
          <p className="text-[11px] text-live truncate">
            Descarga completada: {batchDownload.completed} archivos guardados en{' '}
            {batchDownload.outputDir} (agregados a Biblioteca Local)
          </p>
        ) : null}

        {exportNote ? <p className="text-[11px] text-live truncate">{exportNote}</p> : null}

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05] rounded border border-white/[0.06]">
          {entries.length === 0 ? (
            <div className="p-4 text-center text-faint">
              Sin pistas registradas aún (suenan ≥10s en Master para registrarse).
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    <span
                      className={entry.deck === 'A' ? 'text-deck-a' : 'text-deck-b'}
                    >
                      [{entry.deck}]
                    </span>{' '}
                    {entry.title}
                  </p>
                  <p className="truncate font-mono-tabular text-[11px] text-muted">
                    {entry.channel} • {entry.bpm ? `${entry.bpm.toFixed(1)} BPM • ` : ''}
                    {new Date(entry.playedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Crates */}
      <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-2.5">
        <form onSubmit={handleCreateCrate} className="flex items-center gap-2">
          <input
            type="text"
            value={newCrateName}
            onChange={(e) => setNewCrateName(e.target.value)}
            placeholder="Nuevo Crate (ej. Salsa, Karaoke Clásicos)..."
            className="flex-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-xs text-ink placeholder-faint"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2.5 py-1 text-xs font-semibold text-ink hover:bg-raised-2 cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5 text-muted" />
            Crear Crate
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          {crates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCrateId(c.id)}
              className={`rounded border px-2 py-1 font-mono-tabular text-[11px] cursor-pointer ${
                selectedCrateId === c.id
                  ? 'border-white/25 bg-raised-2 text-ink'
                  : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
              }`}
            >
              {c.name} ({c.trackCount})
            </button>
          ))}
          {crateTracks.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddTracksToQueue(crateTracks)}
              className="ml-auto rounded border border-white/[0.1] bg-raised px-2 py-1 text-[11px] text-ink-soft hover:bg-raised-2 cursor-pointer"
            >
              Crate a Cola
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05] rounded border border-white/[0.06]">
          {crateTracks.length === 0 ? (
            <div className="p-4 text-center text-faint">
              Selecciona un Crate para ver o cargar sus pistas.
            </div>
          ) : (
            crateTracks.map((t) => (
              <div key={t.videoId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <span className="truncate text-ink">{t.title}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('A', t)}
                    className="rounded border border-deck-a/45 px-1.5 py-0.5 text-[11px] text-deck-a cursor-pointer"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('B', t)}
                    className="rounded border border-deck-b/45 px-1.5 py-0.5 text-[11px] text-deck-b cursor-pointer"
                  >
                    B
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
