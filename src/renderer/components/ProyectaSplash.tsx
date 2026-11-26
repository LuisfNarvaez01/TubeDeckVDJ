import type { ReactElement, ReactNode } from 'react';

/**
 * Opening screen: the Proyecta mark assembles the way it sounds (the record's grooves ripple
 * out from the pink centre, the cyan screen rises and its bars move like an equaliser) and
 * two waves keep leaving the record while it loads. `children` (the sign-in card) sits
 * under the wordmark when an account is needed.
 */
export function ProyectaSplash({ status, children }: { status?: string; children?: ReactNode }): ReactElement {
  return (
    <div className="px-splash" role="presentation">
      <div className="relative flex w-full max-w-md flex-col items-center px-6">
        <div className="relative">
          <span className="px-wave" aria-hidden="true" />
          <span className="px-wave" aria-hidden="true" />
          <svg viewBox="0 0 1024 1024" className="relative h-36 w-36" aria-hidden="true" focusable="false">
            <g className="px-spin">
              <circle className="px-ring" cx="630" cy="420" r="282" fill="#2A2A31" />
              <circle className="px-ring" cx="630" cy="420" r="236" fill="none" stroke="#000" strokeWidth="10" />
              <circle className="px-ring" cx="630" cy="420" r="190" fill="none" stroke="#000" strokeWidth="10" />
              <circle className="px-ring" cx="630" cy="420" r="144" fill="none" stroke="#000" strokeWidth="10" />
              <circle className="px-core" cx="630" cy="420" r="96" fill="#FF4FA8" />
              <circle className="px-core" cx="630" cy="420" r="16" fill="#000" />
            </g>
            <g className="px-screen">
              <rect x="120" y="520" width="520" height="320" rx="72" fill="#22E1F0" stroke="#000" strokeWidth="28" />
              <g fill="#000">
                <rect className="px-bar" x="232" y="640" width="40" height="80" rx="20" />
                <rect className="px-bar" x="300" y="596" width="40" height="168" rx="20" />
                <rect className="px-bar" x="368" y="620" width="40" height="120" rx="20" />
                <rect className="px-bar" x="436" y="572" width="40" height="216" rx="20" />
                <rect className="px-bar" x="504" y="628" width="40" height="104" rx="20" />
              </g>
            </g>
          </svg>
        </div>
        <div className="px-word mt-5 text-center">
          <p className="text-[34px] font-extrabold leading-none tracking-[-0.03em] text-ink">Proyecta</p>
          <p className="mt-2 text-[13px] font-medium text-muted">La cabina del DJ · ecosistema Lantify</p>
        </div>
        {children ? (
          <div className="px-fade-in mt-8 w-full [-webkit-app-region:no-drag]">
            {children}
          </div>
        ) : (
          <p role="status" aria-live="polite" className="px-fade-in mt-8 min-h-5 text-[12px] text-faint">
            {status ?? 'Abriendo Proyecta'}
          </p>
        )}
      </div>
    </div>
  );
}
