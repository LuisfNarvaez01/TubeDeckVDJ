export type HotkeyAction =
  | 'deckA.playPause'
  | 'deckB.playPause'
  | 'deckA.cue'
  | 'deckB.cue'
  | 'deckA.sync'
  | 'deckB.sync'
  | 'crossfader.left'
  | 'crossfader.right'
  | 'crossfader.center'
  | 'video.autoTransition'
  | `deckA.hotCue.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | `deckB.hotCue.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export const DEFAULT_HOTKEY_BINDINGS: Record<string, HotkeyAction> = {
  Space: 'deckA.playPause',
  'Shift+Space': 'deckB.playPause',
  KeyQ: 'deckA.cue',
  KeyW: 'deckB.cue',
  KeyS: 'deckA.sync',
  'Shift+KeyS': 'deckB.sync',
  ArrowLeft: 'crossfader.left',
  ArrowRight: 'crossfader.right',
  KeyC: 'crossfader.center',
  KeyV: 'video.autoTransition',
  Digit1: 'deckA.hotCue.1',
  Digit2: 'deckA.hotCue.2',
  Digit3: 'deckA.hotCue.3',
  Digit4: 'deckA.hotCue.4',
  Digit5: 'deckA.hotCue.5',
  Digit6: 'deckA.hotCue.6',
  Digit7: 'deckA.hotCue.7',
  Digit8: 'deckA.hotCue.8',
  'Shift+Digit1': 'deckB.hotCue.1',
  'Shift+Digit2': 'deckB.hotCue.2',
  'Shift+Digit3': 'deckB.hotCue.3',
  'Shift+Digit4': 'deckB.hotCue.4',
  'Shift+Digit5': 'deckB.hotCue.5',
  'Shift+Digit6': 'deckB.hotCue.6',
  'Shift+Digit7': 'deckB.hotCue.7',
  'Shift+Digit8': 'deckB.hotCue.8'
};

export function formatKeyCombo(
  e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey'>
): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class HotkeyManager {
  private bindings: Record<string, HotkeyAction>;

  constructor(bindings?: Partial<Record<string, HotkeyAction>>) {
    const clean: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEY_BINDINGS };
    if (bindings) {
      for (const [k, v] of Object.entries(bindings)) {
        if (v) clean[k] = v;
      }
    }
    this.bindings = clean;
  }

  setBindings(bindings: Record<string, HotkeyAction>): void {
    this.bindings = { ...bindings };
  }

  getBindings(): Record<string, HotkeyAction> {
    return { ...this.bindings };
  }

  resetDefaults(): Record<string, HotkeyAction> {
    this.bindings = { ...DEFAULT_HOTKEY_BINDINGS };
    return this.getBindings();
  }

  handleKeyEvent(
    e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'target'>
  ): HotkeyAction | null {
    if (isEditableTarget(e.target)) {
      return null;
    }
    const combo = formatKeyCombo(e);
    return this.bindings[combo] ?? null;
  }
}

