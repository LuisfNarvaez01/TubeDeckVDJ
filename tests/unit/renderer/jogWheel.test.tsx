import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JogWheel } from '../../../src/renderer/components/ui/JogWheel';

describe('JogWheel', () => {
  it('supports scrub when paused, pitch bend nudge while playing, and vinyl brake', () => {
    const onNudge = vi.fn();
    const onScrubDelta = vi.fn();
    const onBrake = vi.fn();

    const { rerender } = render(
      <JogWheel
        deckId="A"
        playing={false}
        currentTimeSec={12}
        durationSec={180}
        accentColor="#00D4FF"
        onNudge={onNudge}
        onScrubDelta={onScrubDelta}
        onBrake={onBrake}
      />
    );

    const platter = screen.getByRole('slider', { name: 'Jog Wheel Deck A' });
    fireEvent.pointerDown(platter, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(platter, { clientX: 70, clientY: 50 });
    fireEvent.pointerUp(platter, { clientX: 70, clientY: 50 });
    expect(onScrubDelta).toHaveBeenCalled();
    expect(onNudge).not.toHaveBeenCalled();

    rerender(
      <JogWheel
        deckId="A"
        playing={true}
        currentTimeSec={12}
        durationSec={180}
        accentColor="#00D4FF"
        onNudge={onNudge}
        onScrubDelta={onScrubDelta}
        onBrake={onBrake}
      />
    );

    fireEvent.pointerDown(platter, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(platter, { clientX: 60, clientY: 50 });
    expect(onNudge).toHaveBeenCalledWith(expect.any(Number));
    fireEvent.pointerUp(platter, { clientX: 60, clientY: 50 });
    expect(onNudge).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Brake Deck A' }));
    expect(onBrake).toHaveBeenCalledTimes(1);
  });
});

