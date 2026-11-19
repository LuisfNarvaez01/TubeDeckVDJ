import type { ReactElement } from 'react';
import type { DeckId } from '../../shared/types';
import type { CrossfaderCurve, EqBand } from '../audio/AudioDspEngine';
import { useMixerStore } from '../store/useMixerStore';

interface MixerCenterProps {
  onTrimChange: (deck: DeckId, value: number) => void;
  onEqChange: (deck: DeckId, band: EqBand, db: number) => void;
  onEqKillToggle: (deck: DeckId, band: EqBand, kill: boolean) => void;
  onColorFilterChange: (deck: DeckId, amount: number) => void;
  onFaderChange: (deck: DeckId, level: number) => void;
  onCrossfaderChange: (pos: number, curve: CrossfaderCurve) => void;
  onMasterGainChange: (level: number) => void;
  onCueMixChange: (blend: number) => void;
  onCueGainChange: (level: number) => void;
}

const BANDS: Array<{ key: EqBand; label: string }> = [
  { key: 'high', label: 'HI' },
  { key: 'mid', label: 'MID' },
  { key: 'low', label: 'LOW' }
];

export function MixerCenter({
  onTrimChange,
  onEqChange,
  onEqKillToggle,
  onColorFilterChange,
  onFaderChange,
  onCrossfaderChange,
  onMasterGainChange,
  onCueMixChange,
  onCueGainChange
}: MixerCenterProps): ReactElement {
  const mixer = useMixerStore();

  const renderChannel = (deck: DeckId) => {
    const ch = mixer.channels[deck];
    const accent = deck === 'A' ? '#00D4FF' : '#FF8A00';
    return (
      <div
        key={deck}
        className="flex flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-2.5"
      >
        <div className="flex items-center justify-between text-xs font-semibold">
          <span style={{ color: accent }}>CH {deck}</span>
          <span className="font-mono-tabular text-[11px] text-[#94A3B8]">
            {(ch.fader * 100).toFixed(0)}%
          </span>
        </div>

        <label className="flex items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
          <span>TRIM</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.02}
            value={ch.trim}
            onChange={(e) => onTrimChange(deck, Number(e.target.value))}
            onDoubleClick={() => onTrimChange(deck, 1)}
            className="w-24 accent-[#10B981]"
          />
        </label>

        {BANDS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => onEqKillToggle(deck, key, !ch.eqKill[key])}
              className={`w-9 rounded border py-0.5 font-semibold cursor-pointer ${
                ch.eqKill[key]
                  ? 'border-[#EF4444] bg-[#EF4444]/25 text-[#FCA5A5]'
                  : 'border-[#1F2735] bg-[#131822] text-[#94A3B8]'
              }`}
              title={`Kill ${label}`}
            >
              {label}
            </button>
            <input
              type="range"
              min={-26}
              max={12}
              step={0.5}
              value={ch.eq[key]}
              onChange={(e) => onEqChange(deck, key, Number(e.target.value))}
              onDoubleClick={() => onEqChange(deck, key, 0)}
              className="w-24 accent-[#00D4FF]"
              aria-label={`EQ ${label} Deck ${deck}`}
            />
          </div>
        ))}

        <label className="flex items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
          <span>FILTER</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.02}
            value={ch.colorFilter}
            onChange={(e) => onColorFilterChange(deck, Number(e.target.value))}
            onDoubleClick={() => onColorFilterChange(deck, 0)}
            className="w-24 accent-[#8B5CF6]"
          />
        </label>

        <label className="flex items-center justify-between gap-2 text-[11px] text-[#F1F5F9]">
          <span>VOL</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={ch.fader}
            onChange={(e) => onFaderChange(deck, Number(e.target.value))}
            className="w-24"
            style={{ accentColor: accent }}
            aria-label={`Fader Canal ${deck}`}
          />
        </label>
      </div>
    );
  };

  return (
    <section
      className="flex flex-col justify-between gap-3 rounded-xl border border-[#1F2735] bg-[#131822] p-3"
      aria-label="Mixer Central"
    >
      <div className="grid grid-cols-2 gap-2.5">
        {renderChannel('A')}
        {renderChannel('B')}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-[#1F2735] bg-[#0B0E14] p-2.5">
        <div className="grid grid-cols-3 gap-2 text-[11px] text-[#94A3B8]">
          <label className="flex flex-col gap-1">
            <span>MASTER ({Math.round(mixer.masterGain * 100)}%)</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.02}
              value={mixer.masterGain}
              onChange={(e) => onMasterGainChange(Number(e.target.value))}
              className="accent-[#10B981]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>CUE VOL</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.02}
              value={mixer.cueGain}
              onChange={(e) => onCueGainChange(Number(e.target.value))}
              className="accent-[#8B5CF6]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>CUE / MST</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={mixer.cueMix}
              onChange={(e) => onCueMixChange(Number(e.target.value))}
              className="accent-[#8B5CF6]"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] font-semibold text-[#00D4FF]">A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mixer.crossfader}
            onChange={(e) => onCrossfaderChange(Number(e.target.value), mixer.crossfaderCurve)}
            onDoubleClick={() => onCrossfaderChange(0.5, mixer.crossfaderCurve)}
            className="w-full accent-[#F1F5F9]"
            aria-label="Crossfader"
          />
          <span className="text-[11px] font-semibold text-[#FF8A00]">B</span>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px]">
          {(['equal-power', 'linear', 'scratch'] as CrossfaderCurve[]).map((curve) => (
            <button
              key={curve}
              type="button"
              onClick={() => onCrossfaderChange(mixer.crossfader, curve)}
              className={`rounded px-2 py-0.5 border cursor-pointer ${
                mixer.crossfaderCurve === curve
                  ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
                  : 'border-[#1F2735] text-[#94A3B8]'
              }`}
            >
              {curve}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
