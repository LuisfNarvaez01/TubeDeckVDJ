import type { CSSProperties, ReactElement } from 'react';
import type { AudioFxId, FxBeatDivision } from '../../audio/AudioDspEngine';
import type { DeckId } from '../../../shared/types';

export const FX_LABEL: Record<AudioFxId, string> = {
  echo: 'Echo',
  reverb: 'Reverb',
  flanger: 'Flanger'
};

const FX_HINT: Record<AudioFxId, string> = {
  echo: 'Eco estéreo sincronizado al BPM. Al apagarlo, las repeticiones se desvanecen solas.',
  reverb: 'Reverberación de sala a catedral. El tiempo elige el tamaño del espacio.',
  flanger: 'Barrido tipo “jet”. El tiempo marca cuántos beats dura cada barrido.'
};

const DIVS: FxBeatDivision[] = ['1/4', '1/2', '3/4', '1/1'];
const REVERB_SIZE_LABEL: Record<FxBeatDivision, string> = { '1/4': 'S', '1/2': 'M', '3/4': 'L', '1/1': 'XL' };

interface FxRowProps {
  deckId: DeckId;
  fx: AudioFxId;
  enabled: boolean;
  wet: number;
  beatDiv: FxBeatDivision;
  accent: string;
  onChange: (deck: DeckId, fx: AudioFxId, enabled: boolean, wet: number, beatDiv: FxBeatDivision) => void;
}

/** One audio effect: on/off, amount slider (visible track + %), and beat time / room size. */
export function FxRow({ deckId, fx, enabled, wet, beatDiv, accent, onChange }: FxRowProps): ReactElement {
  const pct = Math.round(wet * 100);
  const fill: CSSProperties = {
    ['--fx-fill' as string]: `${pct}%`,
    ['--fx-accent' as string]: enabled ? accent : 'var(--color-ink-soft)'
  };
  return (
    <div className="grid h-7 grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-1.5" title={FX_HINT[fx]}>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => onChange(deckId, fx, !enabled, wet, beatDiv)}
        className={`h-full rounded-md border text-[10px] font-bold uppercase tracking-wide transition-colors duration-150 cursor-pointer ${
          enabled ? 'text-ground' : 'border-white/[0.08] bg-raised text-muted hover:text-ink'
        }`}
        style={enabled ? { backgroundColor: accent, borderColor: accent } : undefined}
      >
        {FX_LABEL[fx]}
      </button>
      <label className="relative flex h-full min-w-0 items-center">
        <span className="sr-only">{`Cantidad de ${FX_LABEL[fx]} en el deck ${deckId}`}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={wet}
          onChange={(e) => onChange(deckId, fx, enabled, Number(e.target.value), beatDiv)}
          onDoubleClick={() => onChange(deckId, fx, enabled, 0.5, beatDiv)}
          className="fx-range w-full"
          style={fill}
        />
        <span className="pointer-events-none absolute right-1.5 font-mono-tabular text-[10px] font-semibold text-ink [text-shadow:0_1px_2px_rgb(0_0_0/0.85)]">
          {pct}%
        </span>
      </label>
      <div role="radiogroup" aria-label={`Tiempo de ${FX_LABEL[fx]}`} className="flex h-full rounded-md border border-white/[0.06] bg-ground p-0.5">
        {DIVS.map((div) => (
          <button
            key={div}
            type="button"
            role="radio"
            aria-checked={beatDiv === div}
            onClick={() => onChange(deckId, fx, enabled, wet, div)}
            className={`min-w-[1.6rem] rounded px-0.5 font-mono-tabular text-[10px] cursor-pointer ${
              beatDiv === div ? 'bg-raised-2 text-ink ring-1 ring-white/[0.14]' : 'text-faint hover:text-ink-soft'
            }`}
          >
            {fx === 'reverb' ? REVERB_SIZE_LABEL[div] : div === '1/1' ? '1' : div}
          </button>
        ))}
      </div>
    </div>
  );
}
