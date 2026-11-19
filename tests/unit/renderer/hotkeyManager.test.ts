import { describe, it, expect } from 'vitest';
import { HotkeyManager } from '../../../src/renderer/controllers/HotkeyManager';

describe('HotkeyManager', () => {
  it('maps DJ keyboard shortcuts and ignores events inside text inputs', () => {
    const manager = new HotkeyManager();
    const divTarget = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;

    expect(
      manager.handleKeyEvent({
        code: 'Space',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        target: divTarget
      })
    ).toBe('deckA.playPause');

    expect(
      manager.handleKeyEvent({
        code: 'Space',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        target: divTarget
      })
    ).toBe('deckB.playPause');

    expect(
      manager.handleKeyEvent({
        code: 'Digit1',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        target: divTarget
      })
    ).toBe('deckA.hotCue.1');

    expect(
      manager.handleKeyEvent({
        code: 'KeyV',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        target: divTarget
      })
    ).toBe('video.autoTransition');

    const inputTarget = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
    expect(
      manager.handleKeyEvent({
        code: 'Space',
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        target: inputTarget
      })
    ).toBeNull();
  });
});

