import { describe, it, expect, vi } from 'vitest';
import {
  DisplayWindowManager,
  type ScreenLike,
  type OutputBrowserWindowLike
} from '../../../src/main/services/DisplayWindowManager';

describe('DisplayWindowManager', () => {
  it('picks preferred external display, relays WebRTC signals, and closes cleanly on display-removed', () => {
    const screenListeners = new Map<string, Array<(...args: unknown[]) => void>>();
    let displays = [
      { id: 1, label: 'Laptop', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, label: 'HDMI TV', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
    ];

    const screenMock: ScreenLike = {
      getPrimaryDisplay: () => displays[0],
      getAllDisplays: () => displays,
      on: (evt, cb) => {
        if (!screenListeners.has(evt)) screenListeners.set(evt, []);
        screenListeners.get(evt)!.push(cb);
      },
      removeListener: (evt, cb) => {
        const list = screenListeners.get(evt) ?? [];
        screenListeners.set(evt, list.filter((x) => x !== cb));
      }
    };

    const outputClosedHandlers: Array<() => void> = [];
    const outputSend = vi.fn();
    const outputDestroy = vi.fn();
    const outputClose = vi.fn(() => {
      for (const h of outputClosedHandlers) h();
    });

    const fakeOutputWin: OutputBrowserWindowLike = {
      isDestroyed: vi.fn(() => false),
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      loadURL: vi.fn(async () => {}),
      loadFile: vi.fn(async () => {}),
      close: outputClose,
      destroy: outputDestroy,
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: outputSend
      },
      on: (evt, cb) => {
        if (evt === 'closed') outputClosedHandlers.push(cb);
      }
    };

    const mainSend = vi.fn();
    const fakeMainWin = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: mainSend
      }
    };

    const manager = new DisplayWindowManager(screenMock, () => fakeOutputWin);
    expect(manager.getPreferredExternalDisplayId()).toBe(2);

    const onDisplaysChanged = vi.fn();
    const onOutputClosed = vi.fn();
    manager.attachMainWindow(fakeMainWin, onDisplaysChanged, onOutputClosed);

    const opened = manager.openOutputWindow(2, true);
    expect(opened).toBe(true);
    expect(manager.isOutputOpen()).toBe(true);

    // WebRTC relay works both ways while open
    expect(manager.relaySignalToOutput({ type: 'offer', sdp: 'v=0' })).toBe(true);
    expect(outputSend).toHaveBeenCalledTimes(1);
    expect(manager.relaySignalToMain({ type: 'answer', sdp: 'v=0' })).toBe(true);
    expect(mainSend).toHaveBeenCalledTimes(1);

    // Simulate live HDMI unplug (Review Focus #3)
    displays = [displays[0]];
    const removedCbs = screenListeners.get('display-removed') ?? [];
    for (const cb of removedCbs) {
      cb({}, { id: 2, label: 'HDMI TV', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } });
    }

    expect(outputClose).toHaveBeenCalledTimes(1);
    expect(manager.isOutputOpen()).toBe(false);
    expect(onDisplaysChanged).toHaveBeenCalledWith([
      {
        id: 1,
        label: 'Laptop',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true
      }
    ]);
    expect(onOutputClosed).toHaveBeenCalledTimes(1);
    expect(
      manager.relaySignalToOutput({
        type: 'ice',
        candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 }
      })
    ).toBe(false);
    expect(manager.getPreferredExternalDisplayId()).toBeNull();
  });
});
