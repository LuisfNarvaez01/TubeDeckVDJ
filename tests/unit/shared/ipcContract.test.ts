import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipcChannels';

describe('IPC_CHANNELS', () => {
  it('exposes unique channel names for all core namespaces', () => {
    const values = Object.values(IPC_CHANNELS);
    expect(values.length).toBeGreaterThanOrEqual(12);
    expect(new Set(values).size).toBe(values.length);
  });
});
