import type { ReactElement } from 'react';

interface BrandMarkProps {
  className?: string;
  /** Draw the rounded-square app-icon ground behind the mark. */
  withGround?: boolean;
}

/**
 * TubeDeck mark: a vinyl record (magenta label, Deck B) sliding out behind a cyan video
 * screen with waveform bars (Deck A). Same geometry as the app icon (build/icon.svg).
 */
export function BrandMark({ className, withGround = false }: BrandMarkProps): ReactElement {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true" focusable="false">
      {withGround ? (
        <>
          <defs>
            <linearGradient id="tdGround" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1A1A1F" />
              <stop offset="1" stopColor="#000000" />
            </linearGradient>
          </defs>
          <rect width="1024" height="1024" rx="232" fill="url(#tdGround)" />
        </>
      ) : null}
      <circle cx="630" cy="420" r="282" fill="#2A2A31" />
      <circle cx="630" cy="420" r="236" fill="none" stroke="#000000" strokeWidth="10" />
      <circle cx="630" cy="420" r="190" fill="none" stroke="#000000" strokeWidth="10" />
      <circle cx="630" cy="420" r="144" fill="none" stroke="#000000" strokeWidth="10" />
      <circle cx="630" cy="420" r="96" fill="#FF4FA8" />
      <circle cx="630" cy="420" r="16" fill="#000000" />
      <rect x="120" y="520" width="520" height="320" rx="72" fill="#22E1F0" stroke="#000000" strokeWidth="28" />
      <g fill="#000000">
        <rect x="232" y="640" width="40" height="80" rx="20" />
        <rect x="300" y="596" width="40" height="168" rx="20" />
        <rect x="368" y="620" width="40" height="120" rx="20" />
        <rect x="436" y="572" width="40" height="216" rx="20" />
        <rect x="504" y="628" width="40" height="104" rx="20" />
      </g>
    </svg>
  );
}
