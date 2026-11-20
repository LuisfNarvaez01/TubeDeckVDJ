import { useState, type FormEvent, type ReactElement } from 'react';
import { Search, Loader2, ListPlus, ArrowUpToLine } from 'lucide-react';
import type { Crate, DeckId, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface SearchBrowserTabProps {
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue?: (track: YouTubeTrack) => void;
  crates?: Crate[];
  onAddToCrate?: (crateId: string, track: YouTubeTrack) => void;
}

export function formatTrackDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SearchBrowserTab({
  onLoadToDeck,
  onAddToQueue,
  onPlayNextInQueue,
  crates = [],
  onAddToCrate
}: SearchBrowserTabProps): ReactElement {
  const [targetCrateId, setTargetCrateId] = useState<string>('');
  const query = useLibraryStore((s) => s.searchInput);
  const setQuery = useLibraryStore((s) => s.setSearchInput);
  const results = useLibraryStore((s) => s.searchResults);
  const setResults = useLibraryStore((s) => s.setSearchResults);

  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const res = trimmed.includes('list=')
        ? await window.tubedeckAPI.getPlaylistTracks(trimmed).then((r) =>
            r.success ? { success: true as const, data: { items: r.data, hasMore: false } } : r
          )
        : await window.tubedeckAPI.searchYouTube(trimmed);

      if (!res.success) {
        setError(res.error);
      } else {
        setResults(res.data.items);
        setHasMore(res.data.hasMore);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleLoadMore = async () => {
    setSearching(true);
    try {
      const res = await window.tubedeckAPI.searchYouTubeNext();
      if (res.success) {
        setResults([...results, ...res.data.items]);
        setHasMore(res.data.hasMore);
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción, karaoke o pegar URL de playlist de YouTube..."
            className="w-full rounded-lg border border-[#262F3F] bg-[#0B0D11] py-2 pl-9 pr-3 text-sm text-[#F8FAFC] placeholder-[#64748B] focus:border-[#0EA5E9] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-bold text-[#0B0D11] hover:bg-[#38BDF8] disabled:opacity-50 cursor-pointer"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Buscar
        </button>
        {results.length > 0 ? (
          <button
            type="button"
            onClick={() => onAddToQueue(results)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#10B981]/50 bg-[#10B981]/15 px-3 py-2 text-xs font-semibold text-[#10B981] hover:bg-[#10B981]/25 cursor-pointer"
          >
            <ListPlus className="h-4 w-4" />
            Todo a Cola
          </button>
        ) : null}
      </form>

      {error ? (
        <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#262F3F] bg-[#0B0D11] divide-y divide-[#1E2634]">
        {results.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            Escribe una canción, artista o pega una playlist de YouTube para cargar en RAM sin descargar archivos.
          </div>
        ) : (
          results.map((track) => (
            <div
              key={track.videoId}
              className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#141820]"
            >
              <div className="flex min-w-0 items-center gap-3">
                {/* YouTube-style 16:9 Thumbnail with Duration Overlay */}
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-[#1B212D]">
                  <img
                    src={track.thumbnailUrl}
                    alt={track.title}
                    className="h-full w-full object-cover outline-1 -outline-offset-1 outline-white/10"
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.2 font-mono-tabular text-[10px] font-semibold text-[#F8FAFC]">
                    {formatTrackDuration(track.durationSec)}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#F8FAFC]">{track.title}</p>
                  <p className="truncate text-xs text-[#94A3B8]">
                    {track.channel}
                    {track.viewsText ? ` • ${track.viewsText}` : ''}
                    {track.publishedText ? ` • ${track.publishedText}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {crates.length > 0 && onAddToCrate ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={targetCrateId || crates[0].id}
                      onChange={(e) => setTargetCrateId(e.target.value)}
                      className="max-w-24 rounded border border-[#262F3F] bg-[#141820] px-1 py-1 text-[11px] text-[#F8FAFC]"
                    >
                      {crates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onAddToCrate(targetCrateId || crates[0].id, track)}
                      className="rounded border border-[#262F3F] bg-[#141820] px-2 py-1 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                    >
                      + Crate
                    </button>
                  </div>
                ) : null}

                {onPlayNextInQueue ? (
                  <button
                    type="button"
                    onClick={() => onPlayNextInQueue(track)}
                    className="inline-flex items-center gap-1 rounded border border-[#6366F1]/50 bg-[#6366F1]/15 px-2 py-1 text-xs font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 cursor-pointer"
                    title="Poner como siguiente canción a sonar"
                  >
                    <ArrowUpToLine className="h-3 w-3" />
                    Siguiente
                  </button>
                ) : null}

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
                  Cargar A
                </button>
                <button
                  type="button"
                  onClick={() => onLoadToDeck('B', track)}
                  className="rounded border border-[#F59E0B]/50 bg-[#F59E0B]/10 px-2.5 py-1 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/20 cursor-pointer"
                >
                  Cargar B
                </button>
              </div>
            </div>
          ))
        )}

        {hasMore ? (
          <div className="p-2 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={searching}
              className="rounded border border-[#262F3F] bg-[#141820] px-4 py-1 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
            >
              Cargar más resultados
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
