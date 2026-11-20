import { useMemo, useState, type ReactElement } from 'react';
import {
  FolderPlus,
  FilePlus,
  Trash2,
  Search,
  Film,
  Music,
  ListPlus,
  ArrowUpToLine,
  X,
  Headphones,
  Loader2
} from 'lucide-react';
import type { DeckId, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface LocalLibraryTabProps {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onRemoveFolder: (folderPath: string) => void;
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue: (track: YouTubeTrack) => void;
  onCuePreview?: (track: YouTubeTrack) => void;
}

export function LocalLibraryTab({
  onPickFiles,
  onPickFolder,
  onRemoveFolder,
  onLoadToDeck,
  onAddToQueue,
  onPlayNextInQueue,
  onCuePreview
}: LocalLibraryTabProps): ReactElement {
  const folders = useLibraryStore((s) => s.localFolders);
  const tracks = useLibraryStore((s) => s.localTracks);
  const playedVideoIds = useLibraryStore((s) => s.playedVideoIds);
  const previewingVideoId = useLibraryStore((s) => s.previewingVideoId);
  const previewLoading = useLibraryStore((s) => s.previewLoading);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.channel.toLowerCase().includes(q) ||
        (t.localFilePath?.toLowerCase().includes(q) ?? false)
    );
  }, [tracks, filter]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-48 flex-1 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#08090C] px-2.5 py-1 focus-within:border-white/25">
          <Search className="h-4 w-4 shrink-0 text-[#64748B]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar archivos o carpetas locales por título o artista..."
            className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Limpiar filtro local"
              onClick={() => setFilter('')}
              className="rounded p-0.5 text-[#64748B] hover:text-[#F8FAFC] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={onPickFiles}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#151821] px-3 py-1.5 font-semibold text-[#F8FAFC] hover:bg-[#1C202B] cursor-pointer"
          >
            <FilePlus className="h-3.5 w-3.5 text-[#0EA5E9]" />
            Agregar Archivos
          </button>
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#151821] px-3 py-1.5 font-semibold text-[#F8FAFC] hover:bg-[#1C202B] cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5 text-[#F59E0B]" />
            Agregar Carpeta
          </button>
          {filtered.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddToQueue(filtered)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#151821] px-3 py-1.5 font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Todo a Cola ({filtered.length})
            </button>
          ) : null}
        </div>
      </div>

      {folders.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[#64748B]">Carpetas:</span>
          {folders.map((folder) => {
            const label = folder.split(/[/\\]/).filter(Boolean).pop() ?? folder;
            return (
              <span
                key={folder}
                title={folder}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#08090C] px-2 py-0.5 text-[#94A3B8]"
              >
                <span className="max-w-44 truncate">{label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFolder(folder)}
                  aria-label={`Quitar carpeta ${label}`}
                  className="text-[#64748B] hover:text-[#EF4444] cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#08090C] divide-y divide-white/[0.05]">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-[#64748B]">
            <p className="font-medium text-[#94A3B8]">Sin medios locales aún</p>
            <p>
              Agrega videos (.mp4, .webm, .mkv) o canciones (.mp3, .wav, .flac, .m4a) de tu PC para mezclar e intercalar con YouTube.
            </p>
          </div>
        ) : (
          filtered.map((track) => {
            const wasPlayed = playedVideoIds.includes(track.videoId);
            const isPreviewing = previewingVideoId === track.videoId;
            return (
              <div
                key={track.localFilePath ?? track.videoId}
                className="group flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#151821]/70"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-[#151821]">
                    {track.mediaKind === 'audio' ? (
                      <Music className="h-4 w-4 text-[#CBD5E1]" />
                    ) : (
                      <Film className="h-4 w-4 text-[#0EA5E9]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-[#F8FAFC]">{track.title}</p>
                      <span className="shrink-0 rounded border border-white/[0.08] bg-[#151821] px-1.5 py-0.2 text-[10px] font-semibold uppercase text-[#94A3B8]">
                        {track.mediaKind === 'audio' ? 'Audio' : 'Video'}
                      </span>
                      {wasPlayed ? (
                        <span className="shrink-0 rounded border border-white/[0.1] bg-[#151821] px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-[#94A3B8]">
                          REPRODUCIDA
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[#94A3B8]">{track.channel}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
                  {onCuePreview ? (
                    <button
                      type="button"
                      onClick={() => onCuePreview(track)}
                      title="Pre-escucha rápida solo en audífonos (PFL)"
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold cursor-pointer ${
                        isPreviewing
                          ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#10B981]'
                          : 'border-white/[0.08] bg-[#151821] text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {isPreviewing && previewLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Headphones className="h-3.5 w-3.5" />
                      )}
                      CUE
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onPlayNextInQueue(track)}
                    className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-[#151821] px-2 py-1 text-xs font-medium text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                    title="Poner como siguiente canción en Cola"
                  >
                    <ArrowUpToLine className="h-3 w-3" />
                    Siguiente
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToQueue([track])}
                    className="rounded border border-white/[0.08] bg-[#151821] px-2 py-1 text-xs font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                  >
                    + Cola
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('A', track)}
                    className="rounded border border-[#0EA5E9]/45 bg-[#0EA5E9]/10 px-2.5 py-1 text-xs font-semibold text-[#0EA5E9] hover:bg-[#0EA5E9]/20 cursor-pointer"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('B', track)}
                    className="rounded border border-[#F59E0B]/45 bg-[#F59E0B]/10 px-2.5 py-1 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/20 cursor-pointer"
                  >
                    B
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
