import type { ReactElement, ReactNode } from 'react';
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
  getStereoVuLevels?: (target: DeckId | 'MASTER') => [number, number];
  onAutoMixSwitch?: () => void;
  onToggleAutoGain?: (enabled: boolean) => void;
  videoLinked?: boolean;
  onToggleVideoLinked?: (linked: boolean) => void;
  showHotkeys?: boolean;
  /** Beat-match meter shown above the crossfader. */
  phaseMeter?: ReactNode;
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
  getStereoVuLevels,
  onAutoMixSwitch,
  onToggleAutoGain,
  videoLinked = true,
  onToggleVideoLinked,
  showHotkeys = false,
  phaseMeter
}: MixerCenterProps): ReactElement {
  const mixer = useMixerStore();
  const nextAutoTarget: DeckId = mixer.crossfader <= 0.5 ? 'B' : 'A';

  const renderChannel = (deck: DeckId) => {
    const ch = mixer.channels[deck];
    const accent = deck === 'A' ? '#22E1F0' : '#FF4FA8';
    return (
      <div
        key={deck}
        className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-ground p-2"
      >
        <div className="flex items-center justify-between text-[10px] font-semibold">
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
            CH {deck}
          </span>
          <span className="font-mono-tabular text-faint">{Math.round(ch.fader * 100)}%</span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="grid grid-cols-2 gap-1">
            <RotaryKnob
              label="TRIM"
              value={ch.trim}
              min={0}
              max={2}
              defaultValue={1}
              accentColor="#E6E6E9"
              size={34}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onTrimChange(deck, v)}
            />
            <RotaryKnob
              label="FILTER"
              value={ch.colorFilter}
              min={-1}
              max={1}
              defaultValue={0}
              bipolar
              accentColor="#E6E6E9"
              size={34}
              formatValue={(v) => (v === 0 ? 'OFF' : v < 0 ? `LP ${Math.round(Math.abs(v) * 100)}%` : `HP ${Math.round(v * 100)}%`)}
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
                  size={34}
                  formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
                  onChange={(v) => onEqChange(deck, key, v)}
                />
                <button
                  type="button"
                  onClick={() => onEqKillToggle(deck, key, !ch.eqKill[key])}
                  className={`rounded border px-1.5 text-[10px] font-bold tracking-wider cursor-pointer ${
                    ch.eqKill[key]
                      ? 'border-danger/60 bg-danger/20 text-danger-soft'
                      : 'border-white/[0.06] bg-raised text-faint hover:text-ink'
                  }`}
                >
                  KILL
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 pl-0.5">
            <LedVuMeter
              getLevel={() => getVuLevel(deck)}
              getStereoLevels={getStereoVuLevels ? () => getStereoVuLevels(deck) : undefined}
              stereo
              label={deck}
              segments={18}
              height={132}
            />
            <div className="flex flex-col items-center gap-1">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ch.fader}
                onChange={(e) => onFaderChange(deck, Number(e.target.value))}
                className="h-28 w-4 accent-ink-2 [writing-mode:vertical-lr] [direction:rtl] cursor-pointer"
                aria-label={`Fader Canal ${deck}`}
              />
              <span className="font-mono-tabular text-[10px] text-faint">VOL</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section
      className="flex min-w-0 items-center justify-center rounded-xl border border-white/[0.06] bg-surface p-2"
      aria-label="Mixer Central"
    >
      <div className="flex w-full items-center justify-center gap-2">
        {renderChannel('A')}

        {/* Monochrome Master + Cue + Crossfader Center Console */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-ground px-2.5 py-2">
          <div className="flex items-center gap-2">
            <RotaryKnob
              label="MASTER"
              value={mixer.masterGain}
              min={0}
              max={1.5}
              defaultValue={1}
              accentColor="#E6E6E9"
              size={36}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={onMasterGainChange}
            />
            <LedVuMeter
              getLevel={() => getVuLevel('MASTER')}
              getStereoLevels={getStereoVuLevels ? () => getStereoVuLevels('MASTER') : undefined}
              stereo
              label="MST"
              segments={16}
              height={58}
            />
            <RotaryKnob
              label="CUE VOL"
              value={mixer.cueGain}
              min={0}
              max={1.5}
              defaultValue={1}
              accentColor="#E6E6E9"
              size={34}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={onCueGainChange}
            />
            <RotaryKnob
              label="CUE/MST"
              value={mixer.cueMix}
              min={0}
              max={1}
              defaultValue={0}
              accentColor="#E6E6E9"
              size={34}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={onCueMixChange}
            />
          </div>

          <div className="flex w-full items-center gap-1">
            {onAutoMixSwitch ? (
              <button
                type="button"
                onClick={onAutoMixSwitch}
                aria-label="Auto Mix A B"
                className={`flex-1 inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold cursor-pointer ${
                  mixer.autoFadeActive
                    ? 'border-live/60 bg-live/20 text-live'
                    : 'border-white/[0.1] bg-raised text-ink hover:bg-raised-2'
                }`}
                title="Mezcla automática suave de audio y video entre Deck A y Deck B"
              >
                <ArrowLeftRight className="h-3 w-3" />
                {mixer.autoFadeActive
                  ? `FADE → ${mixer.autoFadeTarget ?? nextAutoTarget}`
                  : `AUTO MIX → ${nextAutoTarget}`}
              </button>
            ) : null}

            {onToggleVideoLinked ? (
              <button
                type="button"
                onClick={() => onToggleVideoLinked(!videoLinked)}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold cursor-pointer ${
                  videoLinked
                    ? 'border-live/50 bg-live/15 text-live'
                    : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
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
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold cursor-pointer ${
                  mixer.autoGainEnabled
                    ? 'border-white/[0.22] bg-raised-2 text-ink'
                    : 'border-white/[0.06] bg-raised text-faint hover:text-muted'
                }`}
                title="Nivelación automática de volumen entre canciones (Auto-Gain)"
              >
                <Sparkles className="h-3 w-3" />
                AutoGain
              </button>
            ) : null}
          </div>

          {phaseMeter}

          <div className="relative flex w-full items-center gap-2 pt-0.5">
            <span className="text-[10px] font-bold text-deck-a">A</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixer.crossfader}
              onChange={(e) => onCrossfaderChange(Number(e.target.value), mixer.crossfaderCurve)}
              onDoubleClick={() => onCrossfaderChange(0.5, mixer.crossfaderCurve)}
              className="w-full min-w-28 accent-ink-2 cursor-pointer"
              aria-label="Crossfader"
            />
            <span className="text-[10px] font-bold text-deck-b">B</span>
            {showHotkeys ? (
              <span className="hardware-keycap pointer-events-none absolute -top-3.5 left-1/2 -translate-x-1/2 rounded px-1 text-[10px]">
                ← / C / →
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            {(['equal-power', 'linear', 'scratch'] as CrossfaderCurve[]).map((curve) => (
              <button
                key={curve}
                type="button"
                onClick={() => onCrossfaderChange(mixer.crossfader, curve)}
                className={`rounded border px-1.5 py-0.5 cursor-pointer ${
                  mixer.crossfaderCurve === curve
                    ? 'border-white/[0.2] bg-raised-2 text-ink'
                    : 'border-white/[0.06] bg-raised text-faint hover:text-muted'
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
