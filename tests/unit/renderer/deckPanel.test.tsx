import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeckPanel } from '../../../src/renderer/components/DeckPanel';

describe('DeckPanel (Full DJ Controls)', () => {
  it('renders 8 Hot Cues, Auto-Loop buttons, Sync, Tap, Key Lock and Pitch slider', () => {
    const onHotCueTrigger = vi.fn();
    const onSync = vi.fn();
    const onTapBpm = vi.fn();
    const onAutoLoop = vi.fn();

    render(
      <DeckPanel
        deckId="A"
        onTogglePlay={vi.fn()}
        onSeek={vi.fn()}
        onToggleCueMonitor={vi.fn()}
        onPitchChange={vi.fn()}
        onHotCueTrigger={onHotCueTrigger}
        onHotCueClear={vi.fn()}
        onAutoLoop={onAutoLoop}
        onToggleLoopExit={vi.fn()}
        onLoopIn={vi.fn()}
        onLoopOut={vi.fn()}
        onTapBpm={onTapBpm}
        onAdjustBpmHalfDouble={vi.fn()}
        onSync={onSync}
      />
    );

    for (let slot = 1; slot <= 8; slot += 1) {
      expect(screen.getByRole('button', { name: `Hot Cue ${slot}` })).toBeTruthy();
    }
    for (const beats of [1, 2, 4, 8]) {
      expect(screen.getByRole('button', { name: `Loop ${beats}` })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Hot Cue 1' }));
    expect(onHotCueTrigger).toHaveBeenCalledWith('A', 1);

    fireEvent.click(screen.getByRole('button', { name: 'SYNC' }));
    expect(onSync).toHaveBeenCalledWith('A');

    fireEvent.click(screen.getByRole('button', { name: 'TAP' }));
    expect(onTapBpm).toHaveBeenCalledWith('A');

    fireEvent.click(screen.getByRole('button', { name: 'Loop 4' }));
    expect(onAutoLoop).toHaveBeenCalledWith('A', 4);
  });
});

