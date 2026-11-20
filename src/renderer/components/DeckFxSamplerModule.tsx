import { useState, type ReactElement } from 'react';
import { Sparkles, Disc3 } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { AudioFxId, FxBeatDivision, SamplerPadId } from '../audio/AudioDspEngine';
import { useDeckStore } from '../store/useDeckStore';
import { RotaryKnob } from './ui/RotaryKnob';

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

const BEAT_DIVS: FxBeatDivision[] = ['1/4', '1/2', '3/4', '1/1'];

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
  const accent = deckId === 'A' ? '#10D9A0' : '#F5C542';

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

      {/* 3 Hardware Audio FX Slots */}
      <div className="grid grid-cols-3 gap-1.5">
        {FX_SLOTS.map(({ id, label }) => {
          const st = audioFx[id];
          return (
            <div
              key={id}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-white/[0.06] bg-ground p-1.5"
            >
              <button
                type="button"
                aria-label={`${label} Deck ${deckId}`}
                onClick={() => onDeckFxChange(deckId, id, !st.enabled, st.wet, st.beatDiv)}
                className={`w-full rounded border py-0.5 text-[10px] font-bold tracking-wide cursor-pointer ${
                  st.enabled
                    ? 'border-live/60 bg-live/15 text-live'
                    : 'border-white/[0.06] bg-raised text-muted hover:bg-raised-2 hover:text-ink'
                }`}
              >
                {label}
              </button>

              <RotaryKnob
                label="DRY/WET"
                value={st.wet}
                min={0}
                max={1}
                defaultValue={0.45}
                accentColor={st.enabled ? accent : '#E4E7E1'}
                size={34}
                formatValue={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onDeckFxChange(deckId, id, st.enabled, v, st.beatDiv)}
              />

              <div className="grid w-full grid-cols-4 gap-0.5">
                {BEAT_DIVS.map((div) => (
                  <button
                    key={div}
                    type="button"
                    onClick={() => onDeckFxChange(deckId, id, st.enabled, st.wet, div)}
                    className={`rounded py-0.5 font-mono-tabular text-[10px] cursor-pointer ${
                      st.beatDiv === div
                        ? 'bg-raised-2 text-ink ring-1 ring-white/[0.14]'
                        : 'bg-raised text-faint hover:text-muted'
                    }`}
                  >
                    {div}
                  </button>
                ))}
              </div>
            </div>
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

