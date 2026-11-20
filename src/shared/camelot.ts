/** Camelot-wheel compatibility shared by the renderer (deck badges) and main (smart crates). */

export type HarmonicMatch = 'same' | 'compatible' | 'energy' | 'clash';

/**
 * Camelot rules: same code; ±1 on the same ring or same number on the other ring
 * mix cleanly; ±2 on the same ring is an "energy boost"; anything else clashes.
 */
export function harmonicMatch(a: string, b: string): HarmonicMatch | null {
  const ka = /^(\d{1,2})([AB])$/.exec(a);
  const kb = /^(\d{1,2})([AB])$/.exec(b);
  if (!ka || !kb) return null;
  const na = Number(ka[1]);
  const nb = Number(kb[1]);
  const dist = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  if (ka[2] === kb[2]) {
    if (dist === 0) return 'same';
    if (dist === 1) return 'compatible';
    if (dist === 2) return 'energy';
    return 'clash';
  }
  return dist === 0 ? 'compatible' : 'clash';
}

export const HARMONIC_LABEL: Record<HarmonicMatch, string> = {
  same: 'Mismo tono',
  compatible: 'Armónico',
  energy: 'Sube energía',
  clash: 'Choca'
};
