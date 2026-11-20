import { useMemo, useState, type ReactElement } from 'react';
import { FolderPlus, FilePlus, Trash2, Search, Film, Music, ListPlus, ArrowUpToLine } from 'lucide-react';
import type { DeckId, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface LocalLibraryTabProps {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onRemoveFolder: (folderPath: string) => void;
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue: (track: YouTubeTrack) => void;
}

export function LocalLibraryTab({
  onPickFiles,
  onPickFolder,
  onRemoveFolder,
  onLoadToDeck,
  onAddToQueue,
  onPlayNextInQueue
}: LocalLibraryTabProps): ReactElement {
  const folders = useLibraryStore((s) => s.localFolders);
  const tracks = useLibraryStore((s) => s.localTracks);
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
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar archivos o carpetas locales por título o artista..."
            className="w-full rounded-lg border border-[#262F3F] bg-[#0B0D11] py-1.5 pl-9 pr-3 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:border-[#0EA5E9] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={onPickFiles}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#0EA5E9]/50 bg-[#0EA5E9]/15 px-3 py-1.5 font-semibold text-[#0EA5E9] hover:bg-[#0EA5E9]/25 cursor-pointer"
          >
            <FilePlus className="h-3.5 w-3.5" />
            Agregar Archivos
          </button>
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/15 px-3 py-1.5 font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/25 cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Agregar Carpeta
          </button>
          {filtered.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddToQueue(filtered)}
              className="inline-flex items-center gap-1 rounded-lg border border-[#10B981]/50 bg-[#10B981]/15 px-3 py-1.5 font-semibold text-[#10B981] hover:bg-[#10B981]/25 cursor-pointer"
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
                className="inline-flex items-center gap-1 rounded-md border border-[#262F3F] bg-[#0B0D11] px-2 py-0.5 text-[#94A3B8]"
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

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#262F3F] bg-[#0B0D11] divide-y divide-[#1E2634]">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-[#64748B]">
            <p className="font-medium text-[#94A3B8]">Sin medios locales aún</p>
            <p>
              Agrega videos (.mp4, .webm, .mkv) o canciones (.mp3, .wav, .flac, .m4a) de tu PC para mezclar e intercalar con YouTube.
            </p>
          </div>
        ) : (
          filtered.map((track) => (
            <div
              key={track.localFilePath ?? track.videoId}
              className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#141820]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-[#262F3F] bg-[#1B212D]">
                  {track.mediaKind === 'audio' ? (
                    <Music className="h-4 w-4 text-[#F59E0B]" />
                  ) : (
                    <Film className="h-4 w-4 text-[#0EA5E9]" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-[#F8FAFC]">{track.title}</p>
                    <span className="shrink-0 rounded border border-[#262F3F] bg-[#1B212D] px-1.5 py-0.2 text-[10px] font-semibold uppercase text-[#94A3B8]">
                      {track.mediaKind === 'audio' ? 'Audio' : 'Video'}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[#94A3B8]">{track.channel}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onPlayNextInQueue(track)}
                  className="inline-flex items-center gap-1 rounded border border-[#6366F1]/50 bg-[#6366F1]/15 px-2 py-1 text-xs font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 cursor-pointer"
                  title="Poner como siguiente canción en Cola"
                >
                  <ArrowUpToLine className="h-3 w-3" />
                  Siguiente
                </button>
                <button
                  type="button"
                  onClick={() => onAddToQueue([track])}
                  className="rounded border border-[#10B981]/50 bg-[#10B981]/10 px-2 py-1 text-xs font-semibold text-[#10B981] hover:bg-[#10B981]/20 cursor-pointer"
                >
                  + Cola
                </button>
                <button
                  type="button"
                  onClick={() => onLoadToDeck('A', track)}
                  className="rounded border border-[#0EA5E9]/50 bg-[#0EA5E9]/10 px-2.5 py-1 text-xs font-semibold text-[#0EA5E9] hover:bg-[#0EA5E9]/20 cursor-pointer"
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => onLoadToDeck('B', track)}
                  className="rounded border border-[#F59E0B]/50 bg-[#F59E0B]/10 px-2.5 py-1 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/20 cursor-pointer"
                >
                  B
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

