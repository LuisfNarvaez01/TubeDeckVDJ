import { useState, type FormEvent, type ReactElement } from 'react';
import { Search, Loader2, ListPlus } from 'lucide-react';
import type { Crate, DeckId, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface SearchBrowserTabProps {
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  crates?: Crate[];
  onAddToCrate?: (crateId: string, track: YouTubeTrack) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SearchBrowserTab({
  onLoadToDeck,
  onAddToQueue,
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar video en YouTube o pegar URL de playlist (sin API Key)..."
            className="w-full rounded-lg border border-[#1F2735] bg-[#0B0E14] py-2 pl-9 pr-3 text-sm text-[#F1F5F9] placeholder-[#64748B] focus:border-[#00D4FF] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#00D4FF] px-4 py-2 text-xs font-semibold text-[#0B0E14] disabled:opacity-50 cursor-pointer"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Buscar
        </button>
        {results.length > 0 ? (
          <button
            type="button"
            onClick={() => onAddToQueue(results)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#10B981]/50 bg-[#10B981]/15 px-3 py-2 text-xs font-semibold text-[#6EE7B7] cursor-pointer"
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

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#1F2735] bg-[#0B0E14] divide-y divide-[#1F2735]">
        {results.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            Escribe una canción, artista o pega una playlist de YouTube para cargar directo en RAM.
          </div>
        ) : (
          results.map((track) => (
            <div
              key={track.videoId}
              className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#131822]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={track.thumbnailUrl}
                  alt={track.title}
                  className="h-10 w-16 shrink-0 rounded object-cover bg-[#131822]"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#F1F5F9]">{track.title}</p>
                  <p className="truncate text-xs text-[#94A3B8]">
                    {track.channel} • {formatDuration(track.durationSec)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {crates.length > 0 && onAddToCrate ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={targetCrateId || crates[0].id}
                      onChange={(e) => setTargetCrateId(e.target.value)}
                      className="max-w-24 rounded border border-[#1F2735] bg-[#131822] px-1 py-1 text-[11px]"
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
                      className="rounded border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 px-2 py-1 text-xs text-[#C4B5FD] cursor-pointer"
                    >
                      + Crate
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => onAddToQueue([track])}
                  className="rounded border border-[#10B981]/40 bg-[#10B981]/10 px-2 py-1 text-xs font-semibold text-[#6EE7B7] hover:bg-[#10B981]/20 cursor-pointer"
                >
                  + Cola
                </button>
                <button
                  type="button"
                  onClick={() => onLoadToDeck('A', track)}
                  className="rounded border border-[#00D4FF]/50 bg-[#00D4FF]/10 px-2.5 py-1 text-xs font-semibold text-[#00D4FF] hover:bg-[#00D4FF]/20 cursor-pointer"
                >
                  Cargar A
                </button>
                <button
                  type="button"
                  onClick={() => onLoadToDeck('B', track)}
                  className="rounded border border-[#FF8A00]/50 bg-[#FF8A00]/10 px-2.5 py-1 text-xs font-semibold text-[#FF8A00] hover:bg-[#FF8A00]/20 cursor-pointer"
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
              className="rounded border border-[#1F2735] px-4 py-1 text-xs text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
            >
              Cargar más resultados
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
