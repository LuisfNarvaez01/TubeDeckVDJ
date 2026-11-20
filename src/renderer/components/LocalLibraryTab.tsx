import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  FolderPlus,
  FilePlus,
  Folder,
  FolderOpen,
  HardDrive,
  Usb,
  Disc3,
  Network,
  Library,
  Search,
  Film,
  Music,
  ListPlus,
  ArrowUpToLine,
  CornerLeftUp,
  RefreshCw,
  BookmarkPlus,
  X,
  Headphones,
  Loader2,
  ChevronRight
} from 'lucide-react';
import type { DeckId, LocalDirListing, LocalPlace, YouTubeTrack } from '../../shared/types';
import { useLibraryStore } from '../store/useLibraryStore';

interface LocalLibraryTabProps {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onRemoveFolder: (folderPath: string) => void;
  /** Save a browsed folder into "Mi biblioteca". */
  onSaveFolder?: (folderPath: string) => void;
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue: (track: YouTubeTrack) => void;
  onCuePreview?: (track: YouTubeTrack) => void;
}

const LAST_DIR_KEY = 'tubedeck.localLastDir';
const RECURSIVE_KEY = 'tubedeck.localRecursive';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: preference is just not remembered
  }
}

/** "D:\Música\Salsa" → [{ "D:", "D:\" }, { "Música", "D:\Música" }, { "Salsa", ... }] */
export function pathCrumbs(fullPath: string): { label: string; path: string }[] {
  const sep = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let acc = fullPath.startsWith('/') ? '/' : '';
  parts.forEach((part, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(part)) acc = `${part}${sep}`;
    else acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc });
  });
  return crumbs;
}

function PlaceIcon({ kind }: { kind: LocalPlace['kind'] }): ReactElement {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (kind === 'removable') return <Usb className={`${cls} text-deck-a`} />;
  if (kind === 'optical') return <Disc3 className={cls} />;
  if (kind === 'network') return <Network className={cls} />;
  if (kind === 'drive') return <HardDrive className={cls} />;
  if (kind === 'library') return <Library className={`${cls} text-deck-b`} />;
  return <Folder className={cls} />;
}

export function LocalLibraryTab({
  onPickFiles,
  onPickFolder,
  onRemoveFolder,
  onSaveFolder,
  onLoadToDeck,
  onAddToQueue,
  onPlayNextInQueue,
  onCuePreview
}: LocalLibraryTabProps): ReactElement {
  const savedFolders = useLibraryStore((s) => s.localFolders);
  const libraryTracks = useLibraryStore((s) => s.localTracks);
  const playedVideoIds = useLibraryStore((s) => s.playedVideoIds);
  const previewingVideoId = useLibraryStore((s) => s.previewingVideoId);
  const previewLoading = useLibraryStore((s) => s.previewLoading);

  const [filter, setFilter] = useState('');
  const [places, setPlaces] = useState<LocalPlace[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [dirPath, setDirPath] = useState<string | null>(() => readPref(LAST_DIR_KEY));
  const [recursive, setRecursive] = useState(() => readPref(RECURSIVE_KEY) === '1');
  const [listing, setListing] = useState<LocalDirListing | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refreshPlaces = useCallback(async () => {
    if (!window.tubedeckAPI?.listLocalPlaces) return;
    setPlacesLoading(true);
    const res = await window.tubedeckAPI.listLocalPlaces();
    if (res.success) setPlaces(res.data);
    setPlacesLoading(false);
  }, []);

  useEffect(() => {
    void refreshPlaces();
  }, [refreshPlaces, savedFolders]);

  useEffect(() => {
    writePref(LAST_DIR_KEY, dirPath);
    if (!dirPath || !window.tubedeckAPI?.browseLocalDir) {
      setListing(null);
      setDirError(null);
      return;
    }
    let cancelled = false;
    setDirLoading(true);
    setDirError(null);
    void window.tubedeckAPI.browseLocalDir(dirPath, recursive).then((res) => {
      if (cancelled) return;
      setDirLoading(false);
      if (res.success) setListing(res.data);
      else {
        setListing(null);
        setDirError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dirPath, recursive, reloadToken]);

  const openDir = (path: string | null) => {
    setFilter('');
    setDirPath(path);
  };

  const sourceTracks = dirPath ? (listing?.tracks ?? []) : libraryTracks;
  const q = filter.trim().toLowerCase();
  const filteredTracks = useMemo(() => {
    if (!q) return sourceTracks;
    return sourceTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.channel.toLowerCase().includes(q) ||
        (t.localFilePath?.toLowerCase().includes(q) ?? false)
    );
  }, [sourceTracks, q]);
  const filteredFolders = useMemo(() => {
    const list = dirPath ? (listing?.folders ?? []) : [];
    return q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list;
  }, [dirPath, listing, q]);

  const isSaved =
    dirPath !== null && savedFolders.some((f) => f.toLowerCase() === dirPath.toLowerCase());
  const savedPlaces = places.filter((p) => p.kind === 'library');
  const quickPlaces = places.filter((p) => p.kind === 'folder');
  const drivePlaces = places.filter(
    (p) => p.kind === 'drive' || p.kind === 'removable' || p.kind === 'optical' || p.kind === 'network'
  );

  const placeButton = (place: LocalPlace, removable = false) => {
    const active = dirPath !== null && dirPath.toLowerCase() === place.path.toLowerCase();
    return (
      <li key={`${place.kind}:${place.path}`} className="group/place flex items-center">
        <button
          type="button"
          onClick={() => openDir(place.path)}
          title={place.detail ?? place.path}
          aria-current={active ? 'location' : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors duration-150 cursor-pointer ${
            active ? 'bg-raised-2 text-ink' : 'text-ink-soft hover:bg-raised hover:text-ink'
          }`}
        >
          <PlaceIcon kind={place.kind} />
          <span className="truncate">{place.label}</span>
        </button>
        {removable ? (
          <button
            type="button"
            onClick={() => onRemoveFolder(place.path)}
            aria-label={`Quitar ${place.label} de Mi biblioteca`}
            title="Quitar de Mi biblioteca (no borra archivos)"
            className="rounded p-1 text-faint opacity-0 transition-opacity duration-150 group-hover/place:opacity-100 focus-visible:opacity-100 hover:text-danger cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </li>
    );
  };

  const sectionTitle = (label: string, extra?: ReactElement) => (
    <div className="mb-1 mt-3 flex items-center justify-between px-2 first:mt-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
      {extra}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 gap-2">
      <nav
        aria-label="Lugares"
        className="hidden w-48 shrink-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-ground p-1.5 md:block"
      >
        {sectionTitle('Biblioteca')}
        <ul className="space-y-px">
          <li>
            <button
              type="button"
              onClick={() => openDir(null)}
              aria-current={dirPath === null ? 'location' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors duration-150 cursor-pointer ${
                dirPath === null ? 'bg-raised-2 text-ink' : 'text-ink-soft hover:bg-raised hover:text-ink'
              }`}
            >
              <Library className="h-3.5 w-3.5 shrink-0 text-deck-b" />
              <span className="truncate">Mi biblioteca</span>
              <span className="ml-auto font-mono-tabular text-[10px] text-faint">{libraryTracks.length}</span>
            </button>
          </li>
          {savedPlaces.map((p) => placeButton(p, true))}
        </ul>

        {quickPlaces.length > 0 ? (
          <>
            {sectionTitle('Accesos')}
            <ul className="space-y-px">{quickPlaces.map((p) => placeButton(p))}</ul>
          </>
        ) : null}

        {sectionTitle(
          'Unidades',
          <button
            type="button"
            onClick={() => void refreshPlaces()}
            aria-label="Actualizar unidades (USB conectada)"
            title="Actualizar unidades: úsalo después de conectar una USB"
            className="rounded p-0.5 text-faint hover:text-ink cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${placesLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
        <ul className="space-y-px">
          {drivePlaces.map((p) => placeButton(p))}
          {drivePlaces.length === 0 && !placesLoading ? (
            <li className="px-2 py-1 text-[11px] text-faint">Sin unidades detectadas</li>
          ) : null}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {dirPath ? (
            <button
              type="button"
              onClick={() => openDir(listing?.parent ?? null)}
              aria-label="Subir a la carpeta superior"
              title="Carpeta superior"
              className="rounded-md border border-white/[0.08] bg-raised p-1.5 text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer"
            >
              <CornerLeftUp className="h-3.5 w-3.5" />
            </button>
          ) : null}

          <ol aria-label="Ruta" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs">
            {dirPath ? (
              pathCrumbs(dirPath).map((c, i, arr) => (
                <li key={c.path} className="flex shrink-0 items-center gap-0.5">
                  {i > 0 ? <ChevronRight className="h-3 w-3 text-faint" /> : null}
                  <button
                    type="button"
                    onClick={() => openDir(c.path)}
                    aria-current={i === arr.length - 1 ? 'page' : undefined}
                    className={`max-w-48 truncate rounded px-1.5 py-0.5 cursor-pointer ${
                      i === arr.length - 1 ? 'font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                    }`}
                  >
                    {c.label}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-1.5 font-semibold text-ink">Mi biblioteca</li>
            )}
          </ol>

          <div className="flex min-w-40 max-w-72 flex-1 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ground px-2.5 py-1 focus-within:border-white/25">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={dirPath ? 'Filtrar en esta carpeta…' : 'Filtrar mi biblioteca…'}
              aria-label="Filtrar archivos locales"
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
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {dirPath ? (
            <>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-2.5 py-1 text-ink-soft hover:text-ink">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => {
                    setRecursive(e.target.checked);
                    writePref(RECURSIVE_KEY, e.target.checked ? '1' : '0');
                  }}
                  className="accent-[var(--color-deck-a)]"
                />
                Incluir subcarpetas
              </label>
              {onSaveFolder && !isSaved ? (
                <button
                  type="button"
                  onClick={() => onSaveFolder(dirPath)}
                  title="Guardar esta carpeta en Mi biblioteca"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-2.5 py-1 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
                >
                  <BookmarkPlus className="h-3.5 w-3.5 text-deck-b" />
                  Guardar en biblioteca
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onPickFiles}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-2.5 py-1 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
              >
                <FilePlus className="h-3.5 w-3.5 text-deck-a" />
                Agregar archivos
              </button>
              <button
                type="button"
                onClick={onPickFolder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-2.5 py-1 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5 text-deck-b" />
                Agregar carpeta
              </button>
            </>
          )}
          {filteredTracks.length > 0 ? (
            <button
              type="button"
              onClick={() => onAddToQueue(filteredTracks)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-raised px-2.5 py-1 font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Todo a cola ({filteredTracks.length})
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-faint" aria-live="polite">
            {dirLoading
              ? 'Leyendo carpeta…'
              : dirPath && listing
                ? `${listing.folders.length} carpetas · ${listing.tracks.length} archivos${listing.truncated ? ' (límite alcanzado)' : ''}`
                : null}
          </span>
        </div>

        {/* Places as chips when the sidebar is hidden (narrow window) */}
        <div className="flex gap-1 overflow-x-auto md:hidden">
          {[...savedPlaces, ...quickPlaces, ...drivePlaces].map((p) => (
            <button
              key={`chip:${p.kind}:${p.path}`}
              type="button"
              onClick={() => openDir(p.path)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-raised px-2 py-1 text-[11px] text-ink-soft cursor-pointer"
            >
              <PlaceIcon kind={p.kind} />
              {p.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-ground divide-y divide-white/[0.05]">
          {dirError ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
              <p className="font-medium text-ink">No se pudo abrir esta carpeta</p>
              <p className="max-w-md text-muted">
                {dirError}. Si era una USB, revisa que siga conectada.
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setReloadToken((n) => n + 1)}
                  className="rounded-lg border border-white/[0.1] bg-raised px-3 py-1 font-semibold text-ink hover:bg-raised-2 cursor-pointer"
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => openDir(null)}
                  className="rounded-lg px-3 py-1 text-muted hover:text-ink cursor-pointer"
                >
                  Ir a Mi biblioteca
                </button>
              </div>
            </div>
          ) : null}

          {!dirError &&
            filteredFolders.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => openDir(f.path)}
                className="group flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-raised/70 cursor-pointer"
              >
                <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-raised">
                  <Folder className="h-4 w-4 text-ink-soft group-hover:hidden" />
                  <FolderOpen className="hidden h-4 w-4 text-ink group-hover:block" />
                </span>
                <span className="truncate text-sm text-ink">{f.name}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-faint" />
              </button>
            ))}

          {!dirError && filteredTracks.length === 0 && filteredFolders.length === 0 && !dirLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-faint">
              {dirPath ? (
                <>
                  <p className="font-medium text-muted">
                    {q ? 'Nada coincide con el filtro' : 'Esta carpeta no tiene videos ni música'}
                  </p>
                  {!recursive && !q ? <p>Activa “Incluir subcarpetas” para buscar más adentro.</p> : null}
                </>
              ) : (
                <>
                  <p className="font-medium text-muted">Tu biblioteca local está vacía</p>
                  <p className="max-w-md">
                    Abre un disco, una USB o una carpeta desde Lugares y pulsa “Guardar en biblioteca”, o agrega
                    archivos sueltos. Se aceptan .mp4 .webm .mkv .mov .mp3 .wav .flac .m4a .ogg .aac.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {!dirError &&
            filteredTracks.map((track) => {
              const wasPlayed = playedVideoIds.includes(track.videoId);
              const isPreviewing = previewingVideoId === track.videoId;
              return (
                <div
                  key={track.localFilePath ?? track.videoId}
                  className="group flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-raised/70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-raised">
                      {track.mediaKind === 'audio' ? (
                        <Music className="h-4 w-4 text-ink-soft" />
                      ) : (
                        <Film className="h-4 w-4 text-deck-a" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-ink" title={track.localFilePath}>
                          {track.title}
                        </p>
                        <span className="shrink-0 rounded border border-white/[0.08] bg-raised px-1.5 text-[10px] font-semibold uppercase text-muted">
                          {track.mediaKind === 'audio' ? 'Audio' : 'Video'}
                        </span>
                        {wasPlayed ? (
                          <span className="shrink-0 rounded border border-white/[0.1] bg-raised px-1.5 text-[10px] font-bold tracking-wider text-muted">
                            SONÓ
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
                        title="Pre-escucha solo en audífonos (PFL)"
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
                      title="Poner como siguiente canción en la cola"
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
                      aria-label={`Cargar ${track.title} en el deck A`}
                      className="rounded border border-deck-a/45 bg-deck-a/10 px-2.5 py-1 text-xs font-semibold text-deck-a hover:bg-deck-a/20 cursor-pointer"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('B', track)}
                      aria-label={`Cargar ${track.title} en el deck B`}
                      className="rounded border border-deck-b/45 bg-deck-b/10 px-2.5 py-1 text-xs font-semibold text-deck-b hover:bg-deck-b/20 cursor-pointer"
                    >
                      B
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
