import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import type { DeckId, YouTubeTrack } from '../../shared/types';

interface RundownColumnProps {
  title: string;
  /** Shown when there is nothing to list. */
  emptyText: string;
  tracks: YouTubeTrack[];
  /** "Siguientes" counts down from the next song; "Anteriores" counts back. */
  numbering?: 'next' | 'previous';
  onLoadToDeck: (deck: DeckId, track: YouTubeTrack) => void;
  onRemove?: (track: YouTubeTrack, index: number) => void;
  align?: 'start' | 'end';
}

/**
 * The broadcast rundown beside the program monitor: the two songs that just played
 * (left) and the two coming up (right), each loadable on either deck.
 */
export function RundownColumn({
  title,
  emptyText,
  tracks,
  numbering = 'next',
  onLoadToDeck,
  onRemove,
  align = 'start'
}: RundownColumnProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={title}>
      <span
        className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-faint ${
          align === 'end' ? 'text-right' : ''
        }`}
      >
        {title}
      </span>
      {tracks.length === 0 ? (
        <p className={`text-[11px] text-faint ${align === 'end' ? 'text-right' : ''}`}>{emptyText}</p>
      ) : (
        tracks.map((t, i) => (
          <div
            key={`${t.videoId}-${i}`}
            className="group flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-ground p-1.5"
          >
            <div className="relative aspect-video w-[clamp(64px,7vw,104px)] shrink-0 overflow-hidden rounded bg-raised">
              {t.thumbnailUrl ? <img src={t.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
              <span className="absolute left-0.5 top-0.5 rounded bg-black/75 px-1 font-mono-tabular text-[10px] text-ink-soft">
                {numbering === 'next' ? `+${i + 1}` : `−${i + 1}`}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink" title={t.title}>
                {t.title}
              </p>
              <p className="truncate text-[11px] text-muted">{t.channel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {(['A', 'B'] as DeckId[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onLoadToDeck(d, t)}
                  aria-label={`Cargar ${t.title} en el deck ${d}`}
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                    d === 'A'
                      ? 'border-deck-a/45 text-deck-a hover:bg-deck-a/15'
                      : 'border-deck-b/45 text-deck-b hover:bg-deck-b/15'
                  }`}
                >
                  {d}
                </button>
              ))}
              {onRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(t, i)}
                  aria-label={`Quitar ${t.title} de la cola`}
                  title="Quitar de la cola (no volverá a sugerirse hoy)"
                  className="rounded p-0.5 text-faint hover:text-danger-soft cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
