import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Check, Loader2, Plus, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import type { TasteSeedTrack, TasteSummary, YouTubeTrack } from '../../shared/types';
import { formatTrackDuration } from './SearchBrowserTab';

const MAX_SEEDS = 10;
const QUICK_GENRES = [
  'Reggaetón',
  'Salsa',
  'Bachata',
  'Merengue',
  'Vallenato',
  'Cumbia',
  'Pop en español',
  'Rock en español',
  'Electrónica',
  'Crossover 80s 90s',
  'Champeta',
  'Karaoke'
];

interface TasteSetupModalProps {
  open: boolean;
  /** First run shows a welcome message and a "skip" action. */
  firstRun: boolean;
  onClose: () => void;
  onSaved: (seeds: TasteSeedTrack[]) => void;
}

function toSeed(track: YouTubeTrack): TasteSeedTrack {
  return {
    videoId: track.videoId,
    title: track.title,
    channel: track.channel,
    durationSec: track.durationSec,
    thumbnailUrl: track.thumbnailUrl
  };
}

export function TasteSetupModal({ open, firstRun, onClose, onSaved }: TasteSetupModalProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<TasteSeedTrack[]>([]);
  const [summary, setSummary] = useState<TasteSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshSummary = useCallback(async () => {
    const res = await window.tubedeckAPI?.getTasteSummary?.();
    if (res?.success) setSummary(res.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void window.tubedeckAPI?.getTasteSeeds?.().then((res) => {
      if (res?.success) setSeeds(res.data);
    });
    void refreshSummary();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, refreshSummary]);

  const runSearch = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || !window.tubedeckAPI) return;
    setSearching(true);
    setError(null);
    try {
      // Reference songs must be single tracks: drop 1–3 h mixes and compilations.
      const isSingleSong = (t: YouTubeTrack): boolean =>
        t.durationSec >= 60 && t.durationSec <= 600 && !/\b(mix\d*|mezcla|enganchado|megamix|lo mejor|grandes [eé]xitos)\b/i.test(t.title);
      const res = await window.tubedeckAPI.searchYouTube(q);
      if (!res.success) {
        setError(res.error);
        return;
      }
      let songs = res.data.items.filter(isSingleSong);
      let hasMore = res.data.hasMore;
      for (let page = 0; songs.length < 12 && hasMore && page < 2; page += 1) {
        const next = await window.tubedeckAPI.searchYouTubeNext();
        if (!next.success) break;
        songs = [...songs, ...next.data.items.filter(isSingleSong)];
        hasMore = next.data.hasMore;
      }
      setResults(songs.slice(0, 24));
    } finally {
      setSearching(false);
    }
  }, []);

  if (!open) return null;

  const selectedIds = new Set(seeds.map((s) => s.videoId));
  const full = seeds.length >= MAX_SEEDS;

  const toggle = (track: YouTubeTrack): void => {
    if (selectedIds.has(track.videoId)) {
      setSeeds((prev) => prev.filter((s) => s.videoId !== track.videoId));
    } else if (!full) {
      setSeeds((prev) => [...prev, toSeed(track)]);
    }
  };

  const save = async (): Promise<void> => {
    if (!window.tubedeckAPI?.setTasteSeeds) return;
    setSaving(true);
    try {
      const res = await window.tubedeckAPI.setTasteSeeds(seeds);
      if (res.success) {
        onSaved(res.data);
        onClose();
      } else {
        setError(res.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void runSearch(query);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Ajustar mi radio"
      onClick={onClose}
    >
      <div
        className="animate-modal-in flex max-h-[88vh] w-full max-w-5xl flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#0F1117] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#F8FAFC]">
              {firstRun ? 'Enséñale a la radio lo que pones' : 'Ajustar mi radio'}
            </h2>
            <p className="max-w-2xl text-xs text-[#94A3B8]">
              Elige hasta {MAX_SEEDS} canciones que pongas seguido. La radio las usa como punto de partida y
              aprende de tus Me gusta, No me gusta y de las canciones que saltas. Todo se guarda solo en este equipo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg border border-white/[0.06] bg-[#151821] p-1.5 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[1fr_320px]">
          {/* Search column */}
          <div className="flex min-h-0 flex-col gap-2">
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#08090C] px-2.5 py-1 focus-within:border-white/25">
                <Search className="h-4 w-4 shrink-0 text-[#64748B]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Busca una canción o artista que pongas…"
                  className="min-w-0 flex-1 bg-transparent py-1 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.12] bg-[#151821] px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:bg-[#1C202B] disabled:opacity-50 cursor-pointer"
              >
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Buscar
              </button>
            </form>

            <div className="flex flex-wrap gap-1">
              {QUICK_GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setQuery(g);
                    void runSearch(`${g} canciones`);
                  }}
                  className="rounded-full border border-white/[0.08] bg-[#151821] px-2.5 py-0.5 text-[11px] text-[#CBD5E1] hover:border-white/20 hover:text-[#F8FAFC] cursor-pointer"
                >
                  {g}
                </button>
              ))}
            </div>

            {error ? (
              <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
                {error}
              </div>
            ) : null}

            <div className="min-h-[240px] flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#08090C]">
              {results.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[#64748B]">
                  {searching ? 'Buscando…' : 'Busca canciones o toca un género para empezar.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-2 lg:grid-cols-3">
                  {results.map((t) => {
                    const selected = selectedIds.has(t.videoId);
                    return (
                      <button
                        key={t.videoId}
                        type="button"
                        onClick={() => toggle(t)}
                        disabled={!selected && full}
                        className={`group flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors duration-150 disabled:opacity-40 cursor-pointer ${
                          selected
                            ? 'border-[#10B981]/60 bg-[#10B981]/10'
                            : 'border-transparent hover:border-white/[0.1] hover:bg-[#151821]'
                        }`}
                      >
                        <div className="relative aspect-video w-full overflow-hidden rounded bg-[#151821]">
                          <img src={t.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 font-mono-tabular text-[10px] text-[#F8FAFC]">
                            {formatTrackDuration(t.durationSec)}
                          </span>
                          <span
                            className={`absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full ${
                              selected ? 'bg-[#10B981] text-[#08090C]' : 'bg-black/70 text-[#F8FAFC]'
                            }`}
                          >
                            {selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs font-medium leading-snug text-[#F8FAFC]">{t.title}</p>
                        <p className="truncate text-[11px] text-[#94A3B8]">{t.channel}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Selection + learned profile column */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="rounded-lg border border-white/[0.06] bg-[#08090C] p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F8FAFC]">Tus canciones de referencia</span>
                <span className="font-mono-tabular text-[#94A3B8]">
                  {seeds.length}/{MAX_SEEDS}
                </span>
              </div>
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#151821]">
                <div
                  className="h-full rounded-full bg-[#10B981] transition-[width] duration-200"
                  style={{ width: `${(seeds.length / MAX_SEEDS) * 100}%` }}
                />
              </div>
              {seeds.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-[#64748B]">Aún no eliges ninguna.</p>
              ) : (
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                  {seeds.map((s, i) => (
                    <li key={s.videoId} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-[#151821]">
                      <span className="w-4 text-center font-mono-tabular text-[10px] text-[#64748B]">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-[#F8FAFC]">{s.title}</p>
                        <p className="truncate text-[10px] text-[#94A3B8]">{s.channel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSeeds((prev) => prev.filter((x) => x.videoId !== s.videoId))}
                        aria-label={`Quitar ${s.title}`}
                        className="rounded p-0.5 text-[#64748B] hover:text-[#F8FAFC] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {summary && (summary.likes > 0 || summary.dislikes > 0 || summary.blockedChannels.length > 0 || summary.topArtists.length > 0) ? (
              <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#08090C] p-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[#F8FAFC]">
                  <Sparkles className="h-3.5 w-3.5 text-[#10B981]" />
                  Lo que la radio aprendió
                </div>
                <p className="font-mono-tabular text-[11px] text-[#94A3B8]">
                  {summary.likes} Me gusta · {summary.dislikes} No me gusta
                </p>
                {summary.topArtists.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {summary.topArtists.map((a) => (
                      <span
                        key={a.name}
                        className="rounded-full border border-white/[0.08] bg-[#151821] px-2 py-0.5 text-[10px] capitalize text-[#CBD5E1]"
                      >
                        {a.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {summary.blockedChannels.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-[#94A3B8]">Canales bloqueados</span>
                    <div className="flex flex-wrap gap-1">
                      {summary.blockedChannels.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={async () => {
                            await window.tubedeckAPI?.unblockChannel?.(name);
                            void refreshSummary();
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-[#EF4444]/30 bg-[#EF4444]/10 px-2 py-0.5 text-[10px] text-[#FCA5A5] hover:bg-[#EF4444]/20 cursor-pointer"
                          title="Desbloquear"
                        >
                          {name}
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('¿Borrar todos los Me gusta, No me gusta y canales bloqueados? Esto no se puede deshacer.')) return;
                    await window.tubedeckAPI?.resetTasteFeedback?.();
                    void refreshSummary();
                  }}
                  className="inline-flex items-center gap-1 self-start rounded-md border border-white/[0.08] bg-[#151821] px-2 py-1 text-[11px] text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reiniciar aprendizaje
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
          <p className="text-[11px] text-[#64748B]">
            {seeds.length < MAX_SEEDS
              ? `Recomendado: ${MAX_SEEDS} canciones de estilos que realmente pones.`
              : 'Listo. Puedes cambiarlas cuando quieras desde Cola → Ajustar mi radio.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/[0.08] bg-[#151821] px-3 py-1.5 text-xs text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
            >
              {firstRun ? 'Omitir por ahora' : 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#10B981]/60 bg-[#10B981]/15 px-3 py-1.5 text-xs font-semibold text-[#10B981] hover:bg-[#10B981]/25 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Guardar referencias
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
