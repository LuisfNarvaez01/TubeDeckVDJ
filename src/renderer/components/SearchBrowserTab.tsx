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
  'rounded p-1 text-[#94A3B8] transition-colors duration-150 hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer';

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

  // Cards need ~250 px of height; in a short dock fall back to the compact list automatically.
  const effectiveViewMode: ResultsViewMode =
    viewMode === 'grid' && resultsAreaHeight < 250 ? 'list' : viewMode;

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

  const viewToggle = (
    <div
      role="group"
      aria-label="Vista de resultados"
      className="flex items-center rounded-md border border-white/[0.06] bg-[#08090C] p-0.5"
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
            mode === 'grid' && viewMode === 'grid' && effectiveViewMode === 'list'
              ? 'Cuadrícula (se muestra como lista hasta que el navegador tenga más alto)'
              : `Vista ${label}`
          }
          className={`rounded p-1 transition-colors duration-150 cursor-pointer ${
            viewMode === mode ? 'bg-[#1C202B] text-[#F8FAFC]' : 'text-[#64748B] hover:text-[#CBD5E1]'
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
        <div className="flex min-w-64 flex-1 items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#08090C] py-1 pl-3 pr-1 focus-within:border-white/25">
          <Search className="h-4 w-4 shrink-0 text-[#64748B]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción, karaoke o pegar URL de playlist de YouTube..."
            aria-label="Buscar en YouTube"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
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
            className="inline-flex items-center gap-1 rounded-full bg-[#1C202B] px-3 py-1 text-xs font-semibold text-[#F8FAFC] transition-colors duration-150 hover:bg-[#262B38] disabled:opacity-50 cursor-pointer"
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
                  ? 'bg-[#F8FAFC] text-[#08090C]'
                  : 'bg-[#151821] text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC]'
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
                ? 'bg-[#F8FAFC] text-[#08090C]'
                : 'bg-[#151821] text-[#CBD5E1] hover:bg-[#1C202B] hover:text-[#F8FAFC]'
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
              className="max-w-32 rounded-md border border-white/[0.06] bg-[#151821] px-1.5 py-1 text-[11px] text-[#F8FAFC]"
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
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#151821] px-2.5 py-1 text-[11px] font-semibold text-[#CBD5E1] transition-colors duration-150 hover:bg-[#1C202B] hover:text-[#F8FAFC] cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Todo a Cola
            </button>
          ) : null}
          {viewToggle}
        </div>
      </form>

      {error ? (
        <div role="alert" className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
          {error}
        </div>
      ) : null}

      <div ref={resultsAreaRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredResults.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <Search className="h-5 w-5 text-[#334155]" />
            <p className="text-xs text-[#94A3B8]">
              {searching
                ? 'Buscando…'
                : results.length === 0
                  ? 'Busca una canción o artista, o pega una playlist de YouTube.'
                  : 'Ningún resultado coincide con los filtros activos.'}
            </p>
            {results.length === 0 && !searching ? (
              <p className="text-[11px] text-[#64748B]">Se reproduce en RAM, sin descargar archivos.</p>
            ) : null}
          </div>
        ) : effectiveViewMode === 'grid' ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-3 gap-y-4">
            {filteredResults.map((track) => {
              const wasPlayed = playedVideoIds.includes(track.videoId);
              const isPreviewing = previewingVideoId === track.videoId;
              return (
                <li key={track.videoId} className="group flex min-w-0 flex-col gap-1.5">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-[#151821]">
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] ${
                        wasPlayed ? 'opacity-60' : ''
                      }`}
                    />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1 font-mono-tabular text-[11px] font-semibold text-[#F8FAFC]">
                      {formatTrackDuration(track.durationSec)}
                    </span>
                    {wasPlayed ? (
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-[#CBD5E1]">
                        Ya sonó
                      </span>
                    ) : null}
                    {/* Hover / focus actions over the thumbnail */}
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onLoadToDeck('A', track)}
                        aria-label={`Cargar en Deck A: ${track.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0EA5E9] text-sm font-extrabold text-[#08090C] transition-transform duration-150 hover:scale-105 active:scale-[0.97] cursor-pointer"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={() => onLoadToDeck('B', track)}
                        aria-label={`Cargar en Deck B: ${track.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F59E0B] text-sm font-extrabold text-[#08090C] transition-transform duration-150 hover:scale-105 active:scale-[0.97] cursor-pointer"
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
                            isPreviewing ? 'bg-[#10B981] text-[#08090C]' : 'bg-white/90 text-[#08090C]'
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
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#10B981]" aria-hidden="true" />
                    ) : null}
                  </div>

                  <div className="flex min-w-0 gap-1">
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#F8FAFC]"
                        title={track.title}
                      >
                        {track.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#94A3B8]">{track.channel}</p>
                      {track.viewsText || track.publishedText ? (
                        <p className="truncate text-[11px] text-[#64748B]">
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
                  className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-[#151821] focus-within:bg-[#151821]"
                >
                  <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-[#151821]">
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover ${wasPlayed ? 'opacity-60' : ''}`}
                    />
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[10px] font-semibold text-[#F8FAFC]">
                      {formatTrackDuration(track.durationSec)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#F8FAFC]" title={track.title}>
                      {track.title}
                    </p>
                    <p className="truncate text-xs text-[#94A3B8]">
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
                        className={`${iconBtn} ${isPreviewing ? 'text-[#10B981] hover:text-[#10B981]' : ''}`}
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
                      className="ml-1 rounded-md border border-[#0EA5E9]/45 px-2 py-0.5 text-[11px] font-bold text-[#0EA5E9] transition-colors duration-150 hover:bg-[#0EA5E9]/15 cursor-pointer"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('B', track)}
                      aria-label={`Cargar en Deck B: ${track.title}`}
                      className="rounded-md border border-[#F59E0B]/45 px-2 py-0.5 text-[11px] font-bold text-[#F59E0B] transition-colors duration-150 hover:bg-[#F59E0B]/15 cursor-pointer"
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
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#151821] px-4 py-1.5 text-xs text-[#CBD5E1] transition-colors duration-150 hover:bg-[#1C202B] hover:text-[#F8FAFC] disabled:opacity-50 cursor-pointer"
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
