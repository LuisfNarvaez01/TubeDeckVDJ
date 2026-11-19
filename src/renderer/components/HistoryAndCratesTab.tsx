import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { History, FolderPlus, Download, ListPlus } from 'lucide-react';
import type { Crate, DeckId, HistoryEntry, MixSession, YouTubeTrack } from '../../shared/types';

interface HistoryAndCratesTabProps {
  activeSessionId: string | null;
  onNewSession: (title?: string) => Promise<void>;
  onEndActiveSession: () => Promise<void>;
  onAddTracksToQueue: (tracks: YouTubeTrack[]) => void;
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  crates: Crate[];
  onRefreshCrates: () => Promise<void>;
}

export function HistoryAndCratesTab({
  activeSessionId,
  onNewSession,
  onEndActiveSession,
  onAddTracksToQueue,
  onLoadToDeck,
  crates,
  onRefreshCrates
}: HistoryAndCratesTabProps): ReactElement {
  const [sessions, setSessions] = useState<MixSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(activeSessionId);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [crateTracks, setCrateTracks] = useState<YouTubeTrack[]>([]);
  const [newCrateName, setNewCrateName] = useState('');

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
    const res = await window.tubedeckAPI.createCrate(name, '#00D4FF');
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
      thumbnailUrl: `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
      isLive: false
    }));
    onAddTracksToQueue(tracks);
  };

  return (
    <div className="grid h-full grid-cols-2 gap-3 text-xs">
      {/* Left: Mix History */}
      <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 font-semibold text-[#F1F5F9]">
            <History className="h-4 w-4 text-[#00D4FF]" />
            Historial de Mixes
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void onNewSession()}
              className="rounded border border-[#00D4FF]/50 bg-[#00D4FF]/15 px-2 py-1 text-[11px] text-[#00D4FF] cursor-pointer"
            >
              Nueva Sesión
            </button>
            {activeSessionId ? (
              <button
                type="button"
                onClick={() => void onEndActiveSession()}
                className="rounded border border-[#1F2735] px-2 py-1 text-[11px] text-[#94A3B8] cursor-pointer"
              >
                Cerrar Activa
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={selectedSessionId ?? ''}
            onChange={(e) => setSelectedSessionId(e.target.value || null)}
            className="flex-1 rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-xs text-[#F1F5F9]"
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
            className="inline-flex items-center gap-1 rounded border border-[#10B981]/40 bg-[#10B981]/15 px-2 py-1 text-[11px] text-[#6EE7B7] disabled:opacity-40 cursor-pointer"
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
              className="inline-flex items-center gap-1 rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-[11px] uppercase text-[#94A3B8] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              <Download className="h-3 w-3" />
              {fmt}
            </button>
          ))}
        </div>

        {exportNote ? <p className="text-[11px] text-[#10B981] truncate">{exportNote}</p> : null}

        <div className="flex-1 overflow-y-auto divide-y divide-[#1F2735] rounded border border-[#1F2735]">
          {entries.length === 0 ? (
            <div className="p-4 text-center text-[#64748B]">
              Sin pistas registradas aún (suenan ≥10s en Master para registrarse).
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[#F1F5F9]">
                    [{entry.deck}] {entry.title}
                  </p>
                  <p className="truncate text-[11px] text-[#94A3B8]">
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
      <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-2.5">
        <form onSubmit={handleCreateCrate} className="flex items-center gap-2">
          <input
            type="text"
            value={newCrateName}
            onChange={(e) => setNewCrateName(e.target.value)}
            placeholder="Nuevo Crate (ej. Salsa, Techno 130)..."
            className="flex-1 rounded border border-[#1F2735] bg-[#131822] px-2 py-1 text-xs text-[#F1F5F9]"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded border border-[#FF8A00]/50 bg-[#FF8A00]/15 px-2.5 py-1 text-xs font-semibold text-[#FF8A00] cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Crear Crate
          </button>
        </form>

        <div className="flex items-center gap-1.5 flex-wrap">
          {crates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCrateId(c.id)}
              className={`rounded border px-2 py-1 text-[11px] cursor-pointer ${
                selectedCrateId === c.id
                  ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
                  : 'border-[#1F2735] bg-[#131822] text-[#94A3B8]'
              }`}
            >
              {c.name} ({c.trackCount})
            </button>
          ))}
          {crateTracks.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddTracksToQueue(crateTracks)}
              className="ml-auto rounded border border-[#10B981]/50 bg-[#10B981]/15 px-2 py-1 text-[11px] text-[#6EE7B7] cursor-pointer"
            >
              Crate a Cola
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#1F2735] rounded border border-[#1F2735]">
          {crateTracks.length === 0 ? (
            <div className="p-4 text-center text-[#64748B]">
              Selecciona un Crate para ver o cargar sus pistas.
            </div>
          ) : (
            crateTracks.map((t) => (
              <div key={t.videoId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <span className="truncate text-[#F1F5F9]">{t.title}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('A', t)}
                    className="rounded border border-[#00D4FF]/40 px-1.5 py-0.5 text-[11px] text-[#00D4FF] cursor-pointer"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('B', t)}
                    className="rounded border border-[#FF8A00]/40 px-1.5 py-0.5 text-[11px] text-[#FF8A00] cursor-pointer"
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

