import type { ReactElement } from 'react';

export function App(): ReactElement {
  return (
    <div className="min-h-screen w-screen bg-[#0B0E14] text-[#F1F5F9] flex items-center justify-center">
      <div className="rounded-xl border border-[#1F2735] bg-[#131822] px-6 py-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-[#00D4FF]">TubeDeck VDJ</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">Cabina de mezcla audiovisual lista para inicializar.</p>
      </div>
    </div>
  );
}
