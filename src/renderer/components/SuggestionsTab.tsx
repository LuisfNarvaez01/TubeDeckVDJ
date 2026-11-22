import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ArrowUpToLine, Clock, Headphones, HardDrive, Lightbulb, RefreshCw, Radio } from 'lucide-react';
import type { DeckId, DjSuggestion, DjSuggestionReason, YouTubeTrack } from '../../shared/types';
import { shiftCamelot } from '../dj/HarmonicKey';
import { similarityScore } from '../dj/localFallback';
import { trackDragProps } from '../dnd/trackDrag';
import { useDeckStore } from '../store/useDeckStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useMixerStore } from '../store/useMixerStore';
import { useShallow } from 'zustand/react/shallow';

const REASON_LABEL: Record<DjSuggestionReason, string> = {
  follows: 'Suele ir después',
  'this-hour': 'A esta hora',
  key: 'Tono compatible',
  bpm: 'BPM parecido',
  liked: 'Te gusta',
  favorite: 'Éxito tuyo',
  forgotten: 'Olvidada'
};

interface SuggestionsTabProps {
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onAddToQueue: (tracks: YouTubeTrack[]) => void;
  onPlayNextInQueue: (track: YouTubeTrack) => void;
  onCuePreview?: (track: YouTubeTrack) => void;
}

type Row = YouTubeTrack & { reasons?: DjSuggestionReason[]; meta?: string };

/**
 * The DJ's own suggestion module: songs from their history that fit this moment (what usually
 * follows the song on air, what they play at this hour, harmonic/BPM match), similar songs on
 * YouTube, and similar songs in the local library. All computed locally, no external AI.
 */
export function SuggestionsTab({
  onLoadToDeck,
  onAddToQueue,
  onPlayNextInQueue,
  onCuePreview
}: SuggestionsTabProps): ReactElement {
  const onAirDeck = useMixerStore((s): DeckId => (s.crossfader <= 0.5 ? 'A' : 'B'));
  // Only the fields used here (the deck's time changes many times per second).
  const onAir = useDeckStore(
    useShallow((s) => ({
      track: s.decks[onAirDeck].track,
      musicalKey: s.decks[onAirDeck].musicalKey,
      keyShiftSemitones: s.decks[onAirDeck].keyShiftSemitones,
      bpm: s.decks[onAirDeck].bpm
    }))
  );
  const queue = useLibraryStore((s) => s.queue);
  const played = useLibraryStore((s) => s.playedVideoIds);
  const localTracks = useLibraryStore((s) => s.localTracks);
  const cachedTracks = useLibraryStore((s) => s.cachedTracks);

  const [history, setHistory] = useState<DjSuggestion[]>([]);
  const [typicalBpm, setTypicalBpm] = useState<number | null>(null);
  const [historySize, setHistorySize] = useState(0);
  const [youtube, setYoutube] = useState<YouTubeTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const reqSeq = useRef(0);

  const onAirTrack = onAir.track;
  const onAirKey = onAir.musicalKey ? shiftCamelot(onAir.musicalKey, onAir.keyShiftSemitones) : null;
  const excluded = useMemo(
    () => new Set([...played, ...queue.map((q) => q.track.videoId), onAirTrack?.videoId ?? '']),
    [played, queue, onAirTrack?.videoId]
  );

  const refresh = useCallback(async () => {
    const api = window.tubedeckAPI;
    if (!api?.getDjSuggestions) return;
    const seq = (reqSeq.current += 1);
    setLoading(true);
    const exclude = Array.from(excluded).filter(Boolean);
    const [hist, yt] = await Promise.all([
      api.getDjSuggestions({
        onAirVideoId: onAirTrack?.videoId ?? null,
        onAirChannel: onAirTrack?.channel ?? null,
        onAirKey,
        onAirBpm: onAir.bpm,
        excludeVideoIds: exclude.slice(-1500)
      }),
      onAirTrack && onAirTrack.source !== 'local' && api.getRecommendedTracks
        ? api.getRecommendedTracks(
            onAirTrack.videoId,
            exclude.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)).slice(-300),
            onAirTrack.title
          )
        : Promise.resolve(null)
    ]);
    if (seq !== reqSeq.current) return;
    if (hist?.success) {
      setHistory(hist.data.suggestions);
      setTypicalBpm(hist.data.typicalBpm);
      setHistorySize(hist.data.historySize);
    }
    setYoutube(yt?.success ? yt.data.slice(0, 10) : []);
    setLoading(false);
    // Recompute when the song on air changes, not on every queue tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAirTrack?.videoId, onAirKey, onAir.bpm]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // History rows can be local files: they load through the library entry (it has the path).
  const localById = useMemo(() => new Map(localTracks.map((t) => [t.videoId, t])), [localTracks]);
  const historyRows: Row[] = useMemo(
    () =>
      history
        .filter((s) => !excluded.has(s.videoId))
        .map((s) => {
          const base = s.videoId.startsWith('local_') ? localById.get(s.videoId) : s;
          if (!base) return null;
          const meta = [s.bpm ? `${Math.round(s.bpm)} BPM` : '', s.musicalKey ?? '', `${s.playCount}×`]
            .filter(Boolean)
            .join(' · ');
          return { ...base, reasons: s.reasons, meta } as Row;
        })
        .filter((r): r is Row => r !== null)
        .slice(0, 12),
    [history, excluded, localById]
  );

  const libraryRows: Row[] = useMemo(() => {
    if (!onAirTrack) return [];
    const pool = [...localTracks, ...cachedTracks].filter((t) => !excluded.has(t.videoId));
    return pool
      .map((t) => ({ t, s: similarityScore(onAirTrack, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ t }) => ({ ...t, meta: t.source === 'local' ? 'Local' : 'Guardada' }));
  }, [onAirTrack, localTracks, cachedTracks, excluded]);

  const youtubeRows: Row[] = youtube.filter((t) => !excluded.has(t.videoId));

  const now = new Date();
  const when = now.toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

  const renderRow = (t: Row): ReactElement => (
    <li
      key={t.videoId}
      {...trackDragProps(t)}
      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-raised cursor-grab active:cursor-grabbing [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
    >
      <div className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
        {t.thumbnailUrl ? (
          <img src={t.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <HardDrive className="h-4 w-4 text-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{t.title}</p>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">{t.channel}</span>
          {t.meta ? <span className="shrink-0 font-mono-tabular text-faint">{t.meta}</span> : null}
        </div>
        {t.reasons && t.reasons.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {t.reasons.slice(0, 3).map((r) => (
              <span key={r} className="rounded border border-white/[0.08] bg-ground px-1 text-[10px] text-ink-soft">
                {REASON_LABEL[r]}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-80 group-hover:opacity-100">
        {onCuePreview ? (
          <button
            type="button"
            onClick={() => onCuePreview(t)}
            title="Pre-escucha en audífonos"
            aria-label={`Pre-escuchar ${t.title}`}
            className="rounded border border-white/[0.08] bg-raised p-1 text-ink-soft hover:text-ink cursor-pointer"
          >
            <Headphones className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onPlayNextInQueue(t)}
          title="Poner como siguiente"
          aria-label={`Poner ${t.title} como siguiente`}
          className="rounded border border-white/[0.08] bg-raised p-1 text-ink-soft hover:text-ink cursor-pointer"
        >
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onAddToQueue([t])}
          className="rounded border border-white/[0.08] bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft hover:text-ink cursor-pointer"
        >
          + Cola
        </button>
        <button
          type="button"
          onClick={() => onLoadToDeck('A', t)}
          aria-label={`Cargar ${t.title} en el deck A`}
          className="rounded border border-deck-a/45 bg-deck-a/10 px-2 py-0.5 text-[11px] font-semibold text-deck-a cursor-pointer"
        >
          A
        </button>
        <button
          type="button"
          onClick={() => onLoadToDeck('B', t)}
          aria-label={`Cargar ${t.title} en el deck B`}
          className="rounded border border-deck-b/45 bg-deck-b/10 px-2 py-0.5 text-[11px] font-semibold text-deck-b cursor-pointer"
        >
          B
        </button>
      </div>
    </li>
  );

  const section = (title: string, icon: ReactElement, rows: Row[], empty: string): ReactElement => (
    <section className="flex min-w-0 flex-col gap-1">
      <h3 className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {icon}
        {title}
      </h3>
      {rows.length > 0 ? (
        <ul className="flex flex-col">{rows.map(renderRow)}</ul>
      ) : (
        <p className="px-2 py-1 text-[11px] text-faint">{empty}</p>
      )}
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span className="capitalize">{when}</span>
          {typicalBpm ? <span>· a esta hora sueles ir a ~{typicalBpm} BPM</span> : null}
          <span className="text-faint">· {historySize} reproducciones analizadas</span>
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-raised px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
        {section(
          onAirTrack ? 'Para este momento (tu historial)' : 'Para esta hora (tu historial)',
          <Lightbulb className="h-3.5 w-3.5" />,
          historyRows,
          historySize === 0
            ? 'Aún no hay historial: las sugerencias aparecen a medida que pinchas.'
            : 'Nada nuevo por ahora: todo lo que encaja ya sonó o está en la cola.'
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {section(
            'Parecidas en YouTube',
            <Radio className="h-3.5 w-3.5" />,
            youtubeRows,
            onAirTrack ? (loading ? 'Buscando…' : 'Sin resultados (¿hay internet?).') : 'Pon una canción al aire.'
          )}
          {section(
            'De tu biblioteca y guardadas',
            <HardDrive className="h-3.5 w-3.5" />,
            libraryRows,
            onAirTrack ? 'Nada parecido en tus archivos locales.' : 'Pon una canción al aire.'
          )}
        </div>
      </div>
    </div>
  );
}
