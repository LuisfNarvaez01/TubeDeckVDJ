import { describe, it, expect, vi } from 'vitest';
import { NetworkMonitor } from '../../../src/main/services/NetworkMonitor';
import { buildBatchRuntimeArgs, parseDownloadPercent } from '../../../src/main/services/BatchDownloadService';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {}, shell: {}, BrowserWindow: {} }));

describe('NetworkMonitor', () => {
  it('needs two failed probes in a row before calling it offline, and reports recovery', async () => {
    const results = [false, false, true];
    const onChange = vi.fn();
    const mon = new NetworkMonitor(async () => results.shift() ?? true, onChange);
    expect((await mon.check()).online).toBe(true);
    const off = await mon.check();
    expect(off.online).toBe(false);
    expect(off.offlineSinceMs).not.toBeNull();
    expect((await mon.check()).online).toBe(true);
    expect(onChange.mock.calls.map((c) => c[0].online)).toEqual([false, true]);
  });

  it('treats a throwing probe as a failure', async () => {
    const mon = new NetworkMonitor(async () => {
      throw new Error('boom');
    }, vi.fn());
    await mon.check();
    expect((await mon.check()).online).toBe(false);
  });
});

describe('batch downloads', () => {
  it('passes the JS runtime, cookies and line progress to yt-dlp', () => {
    const args = buildBatchRuntimeArgs({ nodeRuntimePath: 'C:/app/Proyecta.exe', getCookieFile: () => 'C:/c.txt' });
    expect(args).toContain('--newline');
    expect(args.join(' ')).toContain('--js-runtimes node:C:/app/Proyecta.exe');
    expect(args.join(' ')).toContain('--cookies C:/c.txt');
    expect(buildBatchRuntimeArgs({}).includes('--cookies')).toBe(false);
  });

  it('reads the percentage from yt-dlp progress lines', () => {
    expect(parseDownloadPercent('[download]  42.3% of   12.00MiB at  1.2MiB/s ETA 00:05')).toBeCloseTo(42.3);
    expect(parseDownloadPercent('[download] Destination: x.mp4')).toBeNull();
  });
});

describe('recommendation exclude ids', () => {
  it('drops local-file ids instead of rejecting the request', async () => {
    const { parseExcludeIds } = await import('../../../src/main/ipc/registerHandlers');
    expect(parseExcludeIds(['abcdefghijk', 'local_abcdef123456', 42, 'abcdefghijk'])).toEqual(['abcdefghijk']);
    const many = Array.from({ length: 500 }, (_, i) => `id${String(i).padStart(9, '0')}`);
    const out = parseExcludeIds(many);
    expect(out).toHaveLength(400);
    expect(out[out.length - 1]).toBe(many[499]);
  });
});
