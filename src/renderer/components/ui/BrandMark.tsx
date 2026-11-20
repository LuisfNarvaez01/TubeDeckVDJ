import type { ReactElement } from 'react';

interface BrandMarkProps {
  className?: string;
  /** Draw the rounded-square app-icon ground behind the mark. */
  withGround?: boolean;
}

/**
 * TubeDeck mark: a vinyl record (gold label, Deck B) sliding out behind an emerald video
 * screen with waveform bars (Deck A). Same geometry as the app icon (build/icon.svg).
 */
export function BrandMark({ className, withGround = false }: BrandMarkProps): ReactElement {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true" focusable="false">
      {withGround ? (
        <>
          <defs>
            <linearGradient id="tdGround" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#16231E" />
              <stop offset="1" stopColor="#070B09" />
            </linearGradient>
          </defs>
          <rect width="1024" height="1024" rx="232" fill="url(#tdGround)" />
        </>
      ) : null}
      <circle cx="630" cy="420" r="282" fill="#2D3A33" />
      <circle cx="630" cy="420" r="236" fill="none" stroke="#0A0F0D" strokeWidth="10" />
      <circle cx="630" cy="420" r="190" fill="none" stroke="#0A0F0D" strokeWidth="10" />
      <circle cx="630" cy="420" r="144" fill="none" stroke="#0A0F0D" strokeWidth="10" />
      <circle cx="630" cy="420" r="96" fill="#F5C542" />
      <circle cx="630" cy="420" r="16" fill="#0A0F0D" />
      <rect x="120" y="520" width="520" height="320" rx="72" fill="#10D9A0" stroke="#0A0F0D" strokeWidth="28" />
      <g fill="#0A0F0D">
        <rect x="232" y="640" width="40" height="80" rx="20" />
        <rect x="300" y="596" width="40" height="168" rx="20" />
        <rect x="368" y="620" width="40" height="120" rx="20" />
        <rect x="436" y="572" width="40" height="216" rx="20" />
        <rect x="504" y="628" width="40" height="104" rx="20" />
      </g>
    </svg>
  );
}
