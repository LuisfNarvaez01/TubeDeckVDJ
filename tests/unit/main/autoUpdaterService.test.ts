import { describe, it, expect, vi } from 'vitest';
import {
  AutoUpdaterService,
  type UpdaterDriverLike
} from '../../../src/main/services/AutoUpdaterService';
import type { UpdateStatus } from '../../../src/shared/types';

function createMockDriver() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const driver: UpdaterDriverLike = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
      const arr = listeners.get(evt) ?? [];
      arr.push(fn);
      listeners.set(evt, arr);
    }),
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn()
  };

  const trigger = (evt: string, payload?: unknown) => {
    for (const fn of listeners.get(evt) ?? []) {
      fn(payload);
    }
  };

  return { driver, trigger };
}

describe('AutoUpdaterService', () => {
  it('stays safely in dev-mode without hitting network when unpackaged', async () => {
    const mock = createMockDriver();
    const factory = vi.fn(async () => mock.driver);
    const updater = new AutoUpdaterService({
      currentVersion: '2.0.0',
      isPackaged: false,
      driverFactory: factory
    });

    expect(updater.getStatus().state).toBe('dev-mode');
    const res = await updater.checkForUpdates();
    expect(res.state).toBe('dev-mode');
    expect(factory).not.toHaveBeenCalled();
    expect(updater.quitAndInstall()).toBe(false);
  });

  it('tracks update-available -> downloading progress -> downloaded -> quitAndInstall', async () => {
    const mock = createMockDriver();
    const events: UpdateStatus[] = [];

    const updater = new AutoUpdaterService({
      currentVersion: '2.0.0',
      isPackaged: true,
      driverFactory: async () => mock.driver,
      onStatusChange: (s) => events.push(s)
    });

    await updater.checkForUpdates();
    mock.trigger('update-available', { version: '2.1.0', releaseNotes: 'Audio FX + Auto-Radio' });
    expect(updater.getStatus()).toMatchObject({
      state: 'available',
      availableVersion: '2.1.0',
      releaseNotes: 'Audio FX + Auto-Radio'
    });

    await updater.downloadUpdate();
    mock.trigger('download-progress', { percent: 42.34 });
    expect(updater.getStatus()).toMatchObject({
      state: 'downloading',
      progressPercent: 42.3
    });

    mock.trigger('update-downloaded', { version: '2.1.0' });
    expect(updater.getStatus()).toMatchObject({
      state: 'downloaded',
      progressPercent: 100
    });

    expect(updater.quitAndInstall()).toBe(true);
    expect(mock.driver.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
