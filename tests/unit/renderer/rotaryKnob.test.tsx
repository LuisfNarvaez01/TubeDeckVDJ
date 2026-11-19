import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RotaryKnob } from '../../../src/renderer/components/ui/RotaryKnob';

describe('RotaryKnob', () => {
  it('renders accessible slider, resets to defaultValue on double click, and updates on vertical drag', () => {
    const onChange = vi.fn();
    render(
      <RotaryKnob
        label="LOW"
        value={0}
        min={-26}
        max={12}
        defaultValue={0}
        bipolar
        onChange={onChange}
      />
    );

    const knob = screen.getByRole('slider', { name: 'LOW' });
    expect(knob.getAttribute('aria-valuenow')).toBe('0');
    expect(knob.getAttribute('aria-valuemin')).toBe('-26');
    expect(knob.getAttribute('aria-valuemax')).toBe('12');

    // Drag up increases value
    fireEvent.pointerDown(knob, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(knob, { clientY: 60, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBeGreaterThan(0);

    // Double click resets to defaultValue
    onChange.mockClear();
    fireEvent.doubleClick(knob);
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

