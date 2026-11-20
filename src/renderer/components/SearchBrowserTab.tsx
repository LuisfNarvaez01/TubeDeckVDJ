import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Search,
  Loader2,
  ListPlus,
  ArrowUpToLine,
  X,
  Headphones,
  Clock
} from 'lucide-react';
import type { Crate, DeckId, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface SearchBrowserTabProps {
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue?: (track: YouTubeTrack) => void;
  onCuePreview?: (track: YouTubeTrack) => void;
  crates?: Crate[];
  onAddToCrate?: (crateId: string, track: YouTubeTrack) => void;
}

type SearchQuickFilter = 'all' | 'karaoke' | 'remix';
type DurationFilter = 'all' | 'short' | 'long';

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
  onCuePreview,
  crates = [],
  onAddToCrate
}: SearchBrowserTabProps): ReactElement {
  const [targetCrateId, setTargetCrateId] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<SearchQuickFilter>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all');

  const query = useLibraryStore((s) => s.searchInput);
  const setQuery = useLibraryStore((s) => s.setSearchInput);
  const results = useLibraryStore((s) => s.searchResults);
  const setResults = useLibraryStore((s) => s.setSearchResults);
  const playedVideoIds = useLibraryStore((s) => s.playedVideoIds);
  const previewingVideoId = useLibraryStore((s) => s.previewingVideoId);
  const previewLoading = useLibraryStore((s) => s.previewLoading);

  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredResults = useMemo(() => {
    return results.filter((t) => {
      const titleLower = t.title.toLowerCase();
      if (quickFilter === 'karaoke' && !titleLower.includes('karaoke')) return false;
      if (quickFilter === 'remix' && !titleLower.includes('remix')) return false;
      if (durationFilter === 'short' && t.durationSec > 300) return false;
      if (durationFilter === 'long' && t.durationSec <= 300) return false;
      return true;
    });
  }, [results, quickFilter, durationFilter]);

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

  const cycleDurationFilter = () => {
    setDurationFilter((cur) => (cur === 'all' ? 'short' : cur === 'short' ? 'long' : 'all'));
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Unified Search Container + Quick Filter Pills */}
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2"
      >
        <div className="flex min-w-64 flex-1 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#08090C] px-2.5 py-1 focus-within:border-white/25">
          <Search className="h-4 w-4 shrink-0 text-[#64748B]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción, karaoke o pegar URL de playlist de YouTube..."
            className="min-w-0 flex-1 bg-transparent py-1 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery('')}
              className="rounded p-0.5 text-[#64748B] hover:text-[#F8FAFC] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.12] bg-[#151821] px-3 py-1 text-xs font-semibold text-[#F8FAFC] hover:bg-[#1C202B] disabled:opacity-50 cursor-pointer"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Buscar
          </button>
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          {(
            [
              ['all', 'Todo'],
              ['karaoke', 'Karaoke'],
              ['remix', 'Remix']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setQuickFilter(id)}
              className={`rounded-md border px-2 py-1 font-medium cursor-pointer ${
                quickFilter === id
                  ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                  : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={cycleDurationFilter}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono-tabular font-medium cursor-pointer ${
              durationFilter !== 'all'
                ? 'border-white/25 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#151821] text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
            title="Filtrar resultados por duración"
          >
            <Clock className="h-3 w-3" />
            {durationFilter === 'all'
              ? 'Duración'
              : durationFilter === 'short'
                ? '≤ 5m'
                : '> 5m'}
          </button>
        </div>

        {filteredResults.length > 0 ? (
          <button
            type="button"
            onClick={() => onAddToQueue(filteredResults)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#151821] px-3 py-1.5 text-xs font-semibold text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
          >
            <ListPlus className="h-3.5 w-3.5" />
            Todo a Cola
          </button>
        ) : null}
      </form>

      {error ? (
        <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#08090C] divide-y divide-white/[0.05]">
        {filteredResults.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-[#64748B]">
            {results.length === 0
              ? 'Escribe una canción, artista o pega una playlist de YouTube para cargar en RAM sin descargar archivos.'
              : 'Ningún resultado coincide con los filtros rápidos activos.'}
          </div>
        ) : (
          filteredResults.map((track) => {
            const wasPlayed = playedVideoIds.includes(track.videoId);
            const isPreviewing = previewingVideoId === track.videoId;
            return (
              <div
                key={track.videoId}
                className="group flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#151821]/70"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {/* 16:9 Thumbnail with Duration Overlay */}
                  <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-[#151821]">
                    <img
                      src={track.thumbnailUrl}
                      alt={track.title}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.2 font-mono-tabular text-[10px] font-semibold text-[#F8FAFC]">
                      {formatTrackDuration(track.durationSec)}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-[#F8FAFC]">{track.title}</p>
                      {wasPlayed ? (
                        <span className="shrink-0 rounded border border-white/[0.1] bg-[#151821] px-1.5 py-0.2 text-[9px] font-bold tracking-wider text-[#94A3B8]">
                          REPRODUCIDA
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[#94A3B8]">
                      {track.channel}
                      {track.viewsText ? ` • ${track.viewsText}` : ''}
                      {track.publishedText ? ` • ${track.publishedText}` : ''}
                    </p>
                  </div>
                </div>

                {/* Hover-emphasized Quick Action Bar */}
                <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
                  {onCuePreview ? (
                    <button
                      type="button"
                      onClick={() => onCuePreview(track)}
                      aria-label={`Pre-escucha CUE ${track.title}`}
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

                  {crates.length > 0 && onAddToCrate ? (
                    <div className="hidden items-center gap-1 xl:flex">
                      <select
                        value={targetCrateId || crates[0].id}
                        onChange={(e) => setTargetCrateId(e.target.value)}
                        className="max-w-20 rounded border border-white/[0.06] bg-[#151821] px-1 py-1 text-[10px] text-[#F8FAFC]"
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
                        className="rounded border border-white/[0.06] bg-[#151821] px-1.5 py-1 text-[11px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                      >
                        + Crate
                      </button>
                    </div>
                  ) : null}

                  {onPlayNextInQueue ? (
                    <button
                      type="button"
                      onClick={() => onPlayNextInQueue(track)}
                      className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-[#151821] px-2 py-1 text-xs font-medium text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
                      title="Poner como siguiente canción a sonar"
                    >
                      <ArrowUpToLine className="h-3 w-3" />
                      Siguiente
                    </button>
                  ) : null}

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
                    Cargar A
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToDeck('B', track)}
                    className="rounded border border-[#F59E0B]/45 bg-[#F59E0B]/10 px-2.5 py-1 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/20 cursor-pointer"
                  >
                    Cargar B
                  </button>
                </div>
              </div>
            );
          })
        )}

        {hasMore ? (
          <div className="p-2 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={searching}
              className="rounded border border-white/[0.08] bg-[#151821] px-4 py-1 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
            >
              Cargar más resultados
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
