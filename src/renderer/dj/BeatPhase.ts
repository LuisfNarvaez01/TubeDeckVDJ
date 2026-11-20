/**
 * Beat-grid anchor estimation and phase comparison between two decks.
 *
 * The anchor (first-beat offset) is found by folding onset strength (rises in the
 * low band) over the beat period and taking the circular mean: where in the bar the
 * kicks land. With BPM and anchor, a deck's beat phase at any track time is known.
 */

export interface OnsetSample {
  trackTimeSec: number;
  lowEnergy: number;
}

/** Circular mean of onset positions inside the beat → anchor offset in [0, period). */
export function estimateBeatAnchor(samples: OnsetSample[], bpm: number): number | null {
  if (!bpm || bpm <= 0 || samples.length < 40) return null;
  const period = 60 / bpm;
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const rise = samples[i].lowEnergy - samples[i - 1].lowEnergy;
    if (rise <= 0) continue;
    const dt = samples[i].trackTimeSec - samples[i - 1].trackTimeSec;
    if (dt <= 0 || dt > 0.5) continue; // seek or pause between samples
    const angle = (2 * Math.PI * (samples[i].trackTimeSec % period)) / period;
    sx += rise * Math.cos(angle);
    sy += rise * Math.sin(angle);
    total += rise;
  }
  if (total <= 0) return null;
  // Weak resultant = no clear pulse (ambient, speech): no grid.
  if (Math.hypot(sx, sy) / total < 0.12) return null;
  let angle = Math.atan2(sy, sx);
  if (angle < 0) angle += 2 * Math.PI;
  return (angle / (2 * Math.PI)) * period;
}

/** Position inside the current beat, 0..1. */
export function beatPhase(trackTimeSec: number, bpm: number, anchorSec: number): number {
  const period = 60 / bpm;
  const p = ((trackTimeSec - anchorSec) % period) / period;
  return p < 0 ? p + 1 : p;
}

/** Beat number inside a 4-beat bar, 0..3 (bar starts at the anchor). */
export function beatInBar(trackTimeSec: number, bpm: number, anchorSec: number): number {
  const period = 60 / bpm;
  const beats = Math.floor((trackTimeSec - anchorSec) / period);
  return ((beats % 4) + 4) % 4;
}

/**
 * Signed phase offset of `slave` against `master`, in beats, in (-0.5, 0.5].
 * Positive = slave is ahead (its kick lands early).
 */
export function phaseOffsetBeats(masterPhase: number, slavePhase: number): number {
  let d = slavePhase - masterPhase;
  if (d > 0.5) d -= 1;
  if (d <= -0.5) d += 1;
  return d;
}

/** Seconds to seek the slave by so its beats land on the master's. */
export function phaseCorrectionSec(offsetBeats: number, slaveBpm: number): number {
  return -offsetBeats * (60 / slaveBpm);
}
