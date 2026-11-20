import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  ArrowUpToLine,
  Clock,
  FolderPlus,
  Headphones,
  LayoutGrid,
  List,
  ListPlus,
  Loader2,
  Search,
  X
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
type ResultsViewMode = 'grid' | 'list';

const VIEW_MODE_STORAGE_KEY = 'tubedeck.searchViewMode';
const iconBtn =
  'rounded p-1 text-muted transition-colors duration-150 hover:bg-raised-2 hover:text-ink cursor-pointer';

function readViewMode(): ResultsViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
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
  onCuePreview,
  crates = [],
  onAddToCrate
}: SearchBrowserTabProps): ReactElement {
  const [targetCrateId, setTargetCrateId] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<SearchQuickFilter>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all');
  const [viewMode, setViewMode] = useState<ResultsViewMode>(readViewMode);
  const resultsAreaRef = useRef<HTMLDivElement | null>(null);
  const [resultsAreaHeight, setResultsAreaHeight] = useState(400);

  useEffect(() => {
    const el = resultsAreaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setResultsAreaHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // In a short dock the card grid becomes one horizontally scrolling shelf, sized to the height.
  const effectiveViewMode: ResultsViewMode = viewMode;
  const shelf = viewMode === 'grid' && resultsAreaHeight < 250;
  const shelfCardWidth = Math.round(Math.min(220, Math.max(128, ((resultsAreaHeight - 56) * 16) / 9)));

  const changeViewMode = (mode: ResultsViewMode): void => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // storage unavailable: keep the choice for this session only
    }
  };

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

  const runSearch = async () => {
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  const handleLoadMore = async () => {
    setSearching(true);
    setError(null);
    try {
      const res = await window.tubedeckAPI.searchYouTubeNext();
      if (res.success) {
        setResults([...results, ...res.data.items]);
        setHasMore(res.data.hasMore);
      } else {
        setError(res.error);
      }
    } finally {
      setSearching(false);
    }
  };

  const cycleDurationFilter = () => {
    setDurationFilter((cur) => (cur === 'all' ? 'short' : cur === 'short' ? 'long' : 'all'));
  };

  const viewToggle = (
    <div
      role="group"
      aria-label="Vista de resultados"
      className="flex items-center rounded-md border border-white/[0.06] bg-ground p-0.5"
    >
      {(
        [
          ['grid', LayoutGrid, 'Cuadrícula'],
          ['list', List, 'Lista']
        ] as const
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => changeViewMode(mode)}
          aria-pressed={viewMode === mode}
          aria-label={`Vista ${label}`}
          title={
            mode === 'grid' && shelf
              ? 'Cuadrícula (una fila con scroll horizontal hasta que el navegador tenga más alto)'
              : `Vista ${label}`
          }
          className={`rounded p-1 transition-colors duration-150 cursor-pointer ${
            viewMode === mode ? 'bg-raised-2 text-ink' : 'text-faint hover:text-ink-soft'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );

  const crateId = targetCrateId || crates[0]?.id || '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Search + filters toolbar */}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1 items-center gap-1.5 rounded-full border border-white/[0.08] bg-ground py-1 pl-3 pr-1 focus-within:border-white/25">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción, karaoke o pegar URL de playlist de YouTube..."
            aria-label="Buscar en YouTube"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-ink placeholder-faint focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery('')}
              className="rounded p-0.5 text-faint hover:text-ink cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-1 rounded-full bg-raised-2 px-3 py-1 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-raised-3 disabled:opacity-50 cursor-pointer"
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
              aria-pressed={quickFilter === id}
              className={`rounded-full px-2.5 py-1 font-medium transition-colors duration-150 cursor-pointer ${
                quickFilter === id
                  ? 'bg-ink text-ground'
                  : 'bg-raised text-ink-soft hover:bg-raised-2 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={cycleDurationFilter}
            aria-pressed={durationFilter !== 'all'}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono-tabular font-medium transition-colors duration-150 cursor-pointer ${
              durationFilter !== 'all'
                ? 'bg-ink text-ground'
                : 'bg-raised text-ink-soft hover:bg-raised-2 hover:text-ink'
            }`}
            title="Filtrar resultados por duración"
          >
            <Clock className="h-3 w-3" />
            {durationFilter === 'all' ? 'Duración' : durationFilter === 'short' ? '≤ 5 min' : '> 5 min'}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {crates.length > 0 && onAddToCrate ? (
            <select
              aria-label="Crate destino"
              title="Crate donde se agregan las canciones con el botón Crate"
              value={crateId}
              onChange={(e) => setTargetCrateId(e.target.value)}
              className="max-w-32 rounded-md border border-white/[0.06] bg-raised px-1.5 py-1 text-[11px] text-ink"
            >
              {crates.map((c) => (
                <option key={c.id} value={c.id}>
                  Crate: {c.name}
                </option>
              ))}
            </select>
          ) : null}
          {filteredResults.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddToQueue(filteredResults)}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Todo a Cola
            </button>
          ) : null}
          {viewToggle}
        </div>
      </form>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger-soft"
        >
          <span className="min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.1] bg-raised px-2.5 py-1 font-semibold text-ink hover:bg-raised-2 disabled:opacity-50 cursor-pointer"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Reintentar
          </button>
        </div>
      ) : null}

      <div
        ref={resultsAreaRef}
        className={`min-h-0 flex-1 pr-1 ${shelf && filteredResults.length > 0 ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto'}`}
      >
        {filteredResults.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <Search className="h-5 w-5 text-faint-2" />
            <p className="text-xs text-muted">
              {searching
                ? 'Buscando…'
                : results.length === 0
                  ? 'Busca una canción o artista, o pega una playlist de YouTube.'
                  : 'Ningún resultado coincide con los filtros activos.'}
            </p>
            {results.length === 0 && !searching ? (
              <p className="text-[11px] text-faint">Se reproduce en RAM, sin descargar archivos.</p>
            ) : null}
          </div>
        ) : effectiveViewMode === 'grid' ? (
          <ul
            style={shelf ? { gridAutoColumns: `${shelfCardWidth}px` } : undefined}
            className={`grid gap-x-3 gap-y-4 ${
              shelf
                ? 'grid-flow-col snap-x snap-mandatory pb-1 [&>li]:snap-start'
                : 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'
            } [&>li]:transition-opacity [&>li]:duration-200 [&:has(>li:hover)>li:not(:hover)]:opacity-55 [&:has(>li:focus-within)>li:not(:focus-within)]:opacity-55`}
          >
            {filteredResults.map((track) => {
              const wasPlayed = playedVideoIds.includes(track.videoId);
              const isPreviewing = previewingVideoId === track.videoId;
              return (
                <li key={track.videoId} className="group flex min-w-0 flex-col gap-1.5">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-raised ring-0 ring-live/70 transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_32px_-14px_rgba(0,0,0,0.85)] group-hover:ring-2 group-focus-within:-translate-y-0.5 group-focus-within:ring-2">
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] ${
                        wasPlayed ? 'opacity-60' : ''
                      }`}
                    />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1 font-mono-tabular text-[11px] font-semibold text-ink">
                      {formatTrackDuration(track.durationSec)}
                    </span>
                    {wasPlayed ? (
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                        Ya sonó
                      </span>
                    ) : null}
                    {/* Hover / focus actions over the thumbnail */}
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onLoadToDeck('A', track)}
                        aria-label={`Cargar en Deck A: ${track.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-deck-a text-sm font-extrabold text-ground transition-transform duration-150 hover:scale-105 active:scale-[0.97] cursor-pointer"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={() => onLoadToDeck('B', track)}
                        aria-label={`Cargar en Deck B: ${track.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-deck-b text-sm font-extrabold text-ground transition-transform duration-150 hover:scale-105 active:scale-[0.97] cursor-pointer"
                      >
                        B
                      </button>
                      {onCuePreview ? (
                        <button
                          type="button"
                          onClick={() => onCuePreview(track)}
                          aria-label={`Pre-escucha CUE ${track.title}`}
                          title="Pre-escucha solo en audífonos (PFL)"
                          className={`flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105 active:scale-[0.97] cursor-pointer ${
                            isPreviewing ? 'bg-live text-ground' : 'bg-white/90 text-ground'
                          }`}
                        >
                          {isPreviewing && previewLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Headphones className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                    </div>
                    {isPreviewing ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-live" aria-hidden="true" />
                    ) : null}
                  </div>

                  <div className="flex min-w-0 gap-1">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`${shelf ? 'line-clamp-1' : 'line-clamp-2'} text-[13px] font-semibold leading-snug text-ink`}
                        title={track.title}
                      >
                        {track.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">{track.channel}</p>
                      {!shelf && (track.viewsText || track.publishedText) ? (
                        <p className="truncate text-[11px] text-faint">
                          {[track.viewsText, track.publishedText].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      {onPlayNextInQueue ? (
                        <button
                          type="button"
                          onClick={() => onPlayNextInQueue(track)}
                          aria-label={`Poner como siguiente: ${track.title}`}
                          title="Poner como siguiente"
                          className={iconBtn}
                        >
                          <ArrowUpToLine className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onAddToQueue([track])}
                        aria-label={`Agregar a la cola: ${track.title}`}
                        title="Agregar al final de la cola"
                        className={iconBtn}
                      >
                        <ListPlus className="h-3.5 w-3.5" />
                      </button>
                      {crates.length > 0 && onAddToCrate ? (
                        <button
                          type="button"
                          onClick={() => onAddToCrate(crateId, track)}
                          aria-label={`Agregar al crate: ${track.title}`}
                          title="Agregar al crate seleccionado"
                          className={iconBtn}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="flex flex-col">
            {filteredResults.map((track) => {
              const wasPlayed = playedVideoIds.includes(track.videoId);
              const isPreviewing = previewingVideoId === track.videoId;
              return (
                <li
                  key={track.videoId}
                  className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-raised focus-within:bg-raised"
                >
                  <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-raised">
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover ${wasPlayed ? 'opacity-60' : ''}`}
                    />
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[10px] font-semibold text-ink">
                      {formatTrackDuration(track.durationSec)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink" title={track.title}>
                      {track.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[track.channel, track.viewsText, track.publishedText].filter(Boolean).join(' · ')}
                      {wasPlayed ? ' · Ya sonó' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    {onCuePreview ? (
                      <button
                        type="button"
                        onClick={() => onCuePreview(track)}
                        aria-label={`Pre-escucha CUE ${track.title}`}
                        title="Pre-escucha solo en audífonos (PFL)"
                        className={`${iconBtn} ${isPreviewing ? 'text-live hover:text-live' : ''}`}
                      >
                        {isPreviewing && previewLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Headphones className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                    {onPlayNextInQueue ? (
                      <button
                        type="button"
                        onClick={() => onPlayNextInQueue(track)}
                        aria-label={`Poner como siguiente: ${track.title}`}
                        title="Poner como siguiente"
                        className={iconBtn}
                      >
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onAddToQueue([track])}
                      aria-label={`Agregar a la cola: ${track.title}`}
                      title="Agregar al final de la cola"
                      className={iconBtn}
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                    </button>
                    {crates.length > 0 && onAddToCrate ? (
                      <button
                        type="button"
                        onClick={() => onAddToCrate(crateId, track)}
                        aria-label={`Agregar al crate: ${track.title}`}
                        title="Agregar al crate seleccionado"
                        className={iconBtn}
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('A', track)}
                      aria-label={`Cargar en Deck A: ${track.title}`}
                      className="ml-1 rounded-md border border-deck-a/45 px-2 py-0.5 text-[11px] font-bold text-deck-a transition-colors duration-150 hover:bg-deck-a/15 cursor-pointer"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('B', track)}
                      aria-label={`Cargar en Deck B: ${track.title}`}
                      className="rounded-md border border-deck-b/45 px-2 py-0.5 text-[11px] font-bold text-deck-b transition-colors duration-150 hover:bg-deck-b/15 cursor-pointer"
                    >
                      B
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && filteredResults.length > 0 ? (
          <div className="py-3 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={searching}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-raised px-4 py-1.5 text-xs text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-50 cursor-pointer"
            >
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Cargar más resultados
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
