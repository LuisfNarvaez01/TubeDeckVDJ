import type { ReactElement } from 'react';
import { ArrowLeftRight, Link2, Sparkles } from 'lucide-react';
import type { DeckId } from '../../shared/types';
import type { CrossfaderCurve, EqBand } from '../audio/AudioDspEngine';
import { useMixerStore } from '../store/useMixerStore';
import { LedVuMeter } from './ui/LedVuMeter';
import { RotaryKnob } from './ui/RotaryKnob';

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
  getVuLevel?: (target: DeckId | 'MASTER') => number;
  onAutoMixSwitch?: () => void;
  onToggleAutoGain?: (enabled: boolean) => void;
  videoLinked?: boolean;
  onToggleVideoLinked?: (linked: boolean) => void;
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
  onCueGainChange,
  getVuLevel = () => 0,
  onAutoMixSwitch,
  onToggleAutoGain,
  videoLinked = true,
  onToggleVideoLinked
}: MixerCenterProps): ReactElement {
  const mixer = useMixerStore();
  const nextAutoTarget: DeckId = mixer.crossfader <= 0.5 ? 'B' : 'A';

  const renderChannel = (deck: DeckId) => {
    const ch = mixer.channels[deck];
    const accent = deck === 'A' ? '#0EA5E9' : '#F59E0B';
    return (
      <div
        key={deck}
        className="flex flex-col gap-2 rounded-lg border border-[#262F3F] bg-[#0B0D11] p-2"
      >
        <div className="flex items-center justify-between text-[11px] font-semibold">
          <span style={{ color: accent }}>CANAL {deck}</span>
          <span className="font-mono-tabular text-[#94A3B8]">{Math.round(ch.fader * 100)}%</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 gap-1.5">
            <RotaryKnob
              label="TRIM"
              value={ch.trim}
              min={0}
              max={2}
              defaultValue={1}
              accentColor="#10B981"
              size={38}
              onChange={(v) => onTrimChange(deck, v)}
            />
            <RotaryKnob
              label="FILTER"
              value={ch.colorFilter}
              min={-1}
              max={1}
              defaultValue={0}
              bipolar
              accentColor="#8B5CF6"
              size={38}
              onChange={(v) => onColorFilterChange(deck, v)}
            />
            {BANDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <RotaryKnob
                  label={label}
                  value={ch.eq[key]}
                  min={-26}
                  max={12}
                  defaultValue={0}
                  bipolar
                  accentColor={accent}
                  size={36}
                  onChange={(v) => onEqChange(deck, key, v)}
                />
                <button
                  type="button"
                  onClick={() => onEqKillToggle(deck, key, !ch.eqKill[key])}
                  className={`rounded border px-1.5 text-[9px] font-bold cursor-pointer ${
                    ch.eqKill[key]
                      ? 'border-[#EF4444] bg-[#EF4444]/25 text-[#FCA5A5]'
                      : 'border-[#1F2735] text-[#64748B] hover:text-white'
                  }`}
                >
                  KILL
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pl-1">
            <LedVuMeter getLevel={() => getVuLevel(deck)} label={deck} height={138} />
            <div className="flex flex-col items-center gap-1">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ch.fader}
                onChange={(e) => onFaderChange(deck, Number(e.target.value))}
                className="h-32 w-5 accent-[#F1F5F9] [writing-mode:vertical-lr] [direction:rtl] cursor-pointer"
                aria-label={`Fader Canal ${deck}`}
              />
              <span className="text-[9px] text-[#94A3B8]">VOL</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section
      className="flex flex-wrap items-center justify-center gap-2.5 rounded-xl border border-[#262F3F] bg-[#141820] p-2.5"
      aria-label="Mixer Central"
    >
      <div className="flex items-center gap-2.5">
        {renderChannel('A')}

        {/* Master + Cue Center Strip */}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-[#262F3F] bg-[#0B0D11] px-3 py-2">
          <div className="flex items-center gap-3">
            <RotaryKnob
              label="MASTER"
              value={mixer.masterGain}
              min={0}
              max={1.5}
              defaultValue={1}
              accentColor="#10B981"
              size={40}
              onChange={onMasterGainChange}
            />
            <LedVuMeter getLevel={() => getVuLevel('MASTER')} label="MST" height={56} segments={10} />
            <RotaryKnob
              label="CUE VOL"
              value={mixer.cueGain}
              min={0}
              max={1.5}
              defaultValue={1}
              accentColor="#8B5CF6"
              size={38}
              onChange={onCueGainChange}
            />
            <RotaryKnob
              label="CUE/MST"
              value={mixer.cueMix}
              min={0}
              max={1}
              defaultValue={0}
              accentColor="#8B5CF6"
              size={38}
              onChange={onCueMixChange}
            />
          </div>

          <div className="flex w-full items-center gap-1.5">
            {onAutoMixSwitch ? (
              <button
                type="button"
                onClick={onAutoMixSwitch}
                aria-label="Auto Mix A B"
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                  mixer.autoFadeActive
                    ? 'border-[#10B981] bg-[#10B981]/25 text-[#6EE7B7]'
                    : 'border-[#00D4FF]/50 bg-[#00D4FF]/15 text-[#00D4FF] hover:bg-[#00D4FF]/25'
                }`}
                title="Mezcla automática suave de audio y video entre Deck A y Deck B"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {mixer.autoFadeActive
                  ? `FADE → ${mixer.autoFadeTarget ?? nextAutoTarget}`
                  : `AUTO MIX → ${nextAutoTarget}`}
              </button>
            ) : null}

            {onToggleVideoLinked ? (
              <button
                type="button"
                onClick={() => onToggleVideoLinked(!videoLinked)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold cursor-pointer ${
                  videoLinked
                    ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#6EE7B7]'
                    : 'border-[#1F2937] bg-[#0F141D] text-[#94A3B8]'
                }`}
                title="Enlazar crossfader de audio con transición de video"
              >
                <Link2 className="h-3 w-3" />
                A+V
              </button>
            ) : null}

            {onToggleAutoGain ? (
              <button
                type="button"
                onClick={() => onToggleAutoGain(!mixer.autoGainEnabled)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold cursor-pointer ${
                  mixer.autoGainEnabled
                    ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/20 text-[#DDD6FE]'
                    : 'border-[#1F2937] bg-[#0F141D] text-[#94A3B8]'
                }`}
                title="Nivelación automática de volumen entre canciones (Auto-Gain)"
              >
                <Sparkles className="h-3 w-3" />
                AutoGain
              </button>
            ) : null}
          </div>

          <div className="flex w-full items-center gap-2 pt-0.5">
            <span className="text-[11px] font-bold text-[#00D4FF]">A</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.crossfader}
              onChange={(e) => onCrossfaderChange(Number(e.target.value), mixer.crossfaderCurve)}
              onDoubleClick={() => onCrossfaderChange(0.5, mixer.crossfaderCurve)}
              className="w-48 accent-[#F1F5F9] cursor-pointer"
              aria-label="Crossfader"
            />
            <span className="text-[11px] font-bold text-[#FF8A00]">B</span>
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            {(['equal-power', 'linear', 'scratch'] as CrossfaderCurve[]).map((curve) => (
              <button
                key={curve}
                type="button"
                onClick={() => onCrossfaderChange(mixer.crossfader, curve)}
                className={`rounded border px-2 py-0.5 cursor-pointer ${
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

        {renderChannel('B')}
      </div>
    </section>
  );
}
