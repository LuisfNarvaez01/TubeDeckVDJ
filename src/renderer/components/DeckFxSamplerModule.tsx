import { useState, type ReactElement } from 'react';
import { Sparkles, Disc3 } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { AudioFxId, FxBeatDivision, SamplerPadId } from '../audio/AudioDspEngine';
import { useDeckStore } from '../store/useDeckStore';
import { FxRow } from './ui/FxRow';

interface DeckFxSamplerModuleProps {
  deckId: DeckId;
  onDeckFxChange: (
    deck: DeckId,
    fx: AudioFxId,
    enabled: boolean,
    wet: number,
    beatDiv: FxBeatDivision
  ) => void;
  onTriggerSample: (pad: SamplerPadId) => void;
}

const FX_SLOTS: Array<{ id: AudioFxId; label: string }> = [
  { id: 'echo', label: 'ECHO' },
  { id: 'reverb', label: 'REVERB' },
  { id: 'flanger', label: 'FLANGER' }
];


const SAMPLER_PADS: Array<{ id: SamplerPadId; label: string }> = [
  { id: 'airhorn', label: 'Airhorn' },
  { id: 'riser', label: 'Riser' },
  { id: 'sub-drop', label: 'Sub Drop' },
  { id: 'clap', label: 'Clap' },
  { id: 'laser', label: 'Laser' },
  { id: 'siren', label: 'Siren' },
  { id: 'kick', label: 'Kick' },
  { id: 'hihat', label: 'HiHat' }
];

export function DeckFxSamplerModule({
  deckId,
  onDeckFxChange,
  onTriggerSample
}: DeckFxSamplerModuleProps): ReactElement {
  const audioFx = useDeckStore((s) => s.decks[deckId].audioFx);
  const [flashingPad, setFlashingPad] = useState<string | null>(null);
  const accent = deckId === 'A' ? '#22E1F0' : '#FF4FA8';

  const flashPad = (key: string) => {
    setFlashingPad(key);
    window.setTimeout(() => {
      setFlashingPad((cur) => (cur === key ? null : cur));
    }, 180);
  };

  return (
    <section
      aria-label={`Deck ${deckId} FX y Sampler`}
      className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-white/[0.06] bg-surface p-2.5"
    >
      <header className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden="true"
          />
          <span className="font-bold tracking-wider text-ink">
            DECK {deckId} FX & SAMPLER
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-faint">
          <Sparkles className="h-3 w-3" />
          DSP Tiempo Real
        </span>
      </header>

      {/* Audio FX: on/off, amount, beat time (room size for the reverb) */}
      <div className="flex flex-col gap-1">
        {FX_SLOTS.map(({ id }) => {
          const st = audioFx[id];
          return (
            <FxRow
              key={id}
              deckId={deckId}
              fx={id}
              enabled={st.enabled}
              wet={st.wet}
              beatDiv={st.beatDiv}
              accent={accent}
              onChange={onDeckFxChange}
            />
          );
        })}
      </div>

      {/* Direct Sampler Pad Bank */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-faint">
          <span className="inline-flex items-center gap-1">
            <Disc3 className="h-2.5 w-2.5" />
            SAMPLER PADS
          </span>
          <span className="font-mono-tabular">8 SLOTS</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {SAMPLER_PADS.map((pad) => {
            const flashKey = `${deckId}-${pad.id}`;
            return (
              <button
                key={pad.id}
                type="button"
                onClick={() => {
                  flashPad(flashKey);
                  onTriggerSample(pad.id);
                }}
                className={`rounded border border-white/[0.06] bg-raised py-1 text-[10px] font-semibold text-ink-soft hover:bg-raised-2 hover:text-ink cursor-pointer ${
                  flashingPad === flashKey ? 'animate-pad-flash' : ''
                }`}
              >
                {pad.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

