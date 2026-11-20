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
        <div className="flex min-w-48 flex-1 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ground px-2.5 py-1 focus-within:border-white/25">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar archivos o carpetas locales por título o artista..."
            className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-ink placeholder-faint focus:outline-none"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Limpiar filtro local"
              onClick={() => setFilter('')}
              className="rounded p-0.5 text-faint hover:text-ink cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={onPickFiles}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-3 py-1.5 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
          >
            <FilePlus className="h-3.5 w-3.5 text-deck-a" />
            Agregar Archivos
          </button>
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-3 py-1.5 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5 text-deck-b" />
            Agregar Carpeta
          </button>
          {filtered.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddToQueue(filtered)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-raised px-3 py-1.5 font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Todo a Cola ({filtered.length})
            </button>
          ) : null}
        </div>
      </div>

      {folders.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-faint">Carpetas:</span>
          {folders.map((folder) => {
            const label = folder.split(/[/\\]/).filter(Boolean).pop() ?? folder;
            return (
              <span
                key={folder}
                title={folder}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-ground px-2 py-0.5 text-muted"
              >
                <span className="max-w-44 truncate">{label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFolder(folder)}
                  aria-label={`Quitar carpeta ${label}`}
                  className="text-faint hover:text-danger cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-ground divide-y divide-white/[0.05]">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-faint">
            <p className="font-medium text-muted">Sin medios locales aún</p>
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
                className="group flex items-center justify-between gap-3 px-3 py-2 hover:bg-raised/70"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-raised">
                    {track.mediaKind === 'audio' ? (
                      <Music className="h-4 w-4 text-ink-soft" />
                    ) : (
                      <Film className="h-4 w-4 text-deck-a" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-ink">{track.title}</p>
                      <span className="shrink-0 rounded border border-white/[0.08] bg-raised px-1.5 py-0.2 text-[10px] font-semibold uppercase text-muted">
                        {track.mediaKind === 'audio' ? 'Audio' : 'Video'}
                      </span>
                      {wasPlayed ? (
                        <span className="shrink-0 rounded border border-white/[0.1] bg-raised px-1.5 py-0.2 text-[10px] font-bold tracking-wider text-muted">
                          REPRODUCIDA
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted">{track.channel}</p>
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
                          ? 'border-live/60 bg-live/15 text-live'
                          : 'border-white/[0.08] bg-raised text-ink-soft hover:bg-raised-2 hover:text-ink'
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
                    className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-raised px-2 py-1 text-xs font-medium text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer"
                    title="Poner como siguiente canción en Cola"
                  >
                    <ArrowUpToLine className="h-3 w-3" />
                    Siguiente
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToQueue([track])}
                    className="rounded border border-white/[0.08] bg-raised px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer"
                  >
                    + Cola
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('A', track)}
                    className="rounded border border-deck-a/45 bg-deck-a/10 px-2.5 py-1 text-xs font-semibold text-deck-a hover:bg-deck-a/20 cursor-pointer"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('B', track)}
                    className="rounded border border-deck-b/45 bg-deck-b/10 px-2.5 py-1 text-xs font-semibold text-deck-b hover:bg-deck-b/20 cursor-pointer"
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
