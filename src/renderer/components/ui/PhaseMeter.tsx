import { useEffect, useState, type ReactElement } from 'react';
import type { DeckId } from '../../../shared/types';
import { beatInBar, beatPhase, phaseOffsetBeats } from '../../dj/BeatPhase';
import { useDeckStore } from '../../store/useDeckStore';

interface PhaseMeterProps {
  /** Live track time of a deck (media clock, not the 10 fps store value). */
  getTrackTime: (deck: DeckId) => number | null;
}

interface PhaseSnapshot {
  beat: Record<DeckId, number | null>;
  offsetMs: number | null;
}

const IN_PHASE_MS = 15;

/**
 * Beat-match meter: each deck's position in its 4-beat bar, and how far B's kick lands
 * from A's. Only shown as live when both decks are playing with a known grid.
 */
export function PhaseMeter({ getTrackTime }: PhaseMeterProps): ReactElement {
  const [snap, setSnap] = useState<PhaseSnapshot>({ beat: { A: null, B: null }, offsetMs: null });

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;
      const decks = useDeckStore.getState().decks;
      const beat: Record<DeckId, number | null> = { A: null, B: null };
      const phase: Record<DeckId, number | null> = { A: null, B: null };
      for (const id of ['A', 'B'] as DeckId[]) {
        const d = decks[id];
        const t = getTrackTime(id);
        if (!d.playing || !d.bpm || d.beatAnchorSec === null || t === null) continue;
        beat[id] = beatInBar(t, d.bpm, d.beatAnchorSec);
        phase[id] = beatPhase(t, d.bpm, d.beatAnchorSec);
      }
      let offsetMs: number | null = null;
      if (phase.A !== null && phase.B !== null && decks.A.bpm) {
        const effA = decks.A.bpm * (1 + decks.A.pitchPercent / 100);
        offsetMs = Math.round(phaseOffsetBeats(phase.A, phase.B) * (60000 / effA));
      }
      setSnap((prev) =>
        prev.beat.A === beat.A && prev.beat.B === beat.B && prev.offsetMs === offsetMs
          ? prev
          : { beat, offsetMs }
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTrackTime]);

  const live = snap.offsetMs !== null;
  const inPhase = live && Math.abs(snap.offsetMs as number) <= IN_PHASE_MS;
  const label = !live
    ? 'Fase —'
    : inPhase
      ? 'En fase'
      : `B ${(snap.offsetMs as number) > 0 ? 'adelantado' : 'atrasado'} ${Math.abs(snap.offsetMs as number)} ms`;

  return (
    <div
      className="flex w-full items-center gap-2"
      role="group"
      aria-label="Medidor de fase entre decks"
      title="Medidor de fase: los golpes de A y B deben caer juntos. SYNC los alinea."
    >
      <div className="grid flex-1 grid-cols-4 gap-0.5">
        {(['A', 'B'] as DeckId[]).map((id) =>
          [0, 1, 2, 3].map((i) => (
            <span
              key={`${id}${i}`}
              className={`h-1.5 rounded-sm transition-colors duration-75 ${
                snap.beat[id] === i ? (id === 'A' ? 'bg-deck-a' : 'bg-deck-b') : 'bg-raised-2'
              }`}
            />
          ))
        )}
      </div>
      <span
        aria-live="off"
        className={`w-32 shrink-0 whitespace-nowrap text-right font-mono-tabular text-[10px] ${
          inPhase ? 'text-live' : live ? 'text-ink-soft' : 'text-faint'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
