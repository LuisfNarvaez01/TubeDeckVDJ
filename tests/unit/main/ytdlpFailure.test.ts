import { describe, expect, it } from 'vitest';
import { describeYtDlpFailure, YTDLP_TIMEOUT_MS } from '../../../src/main/services/StreamResolverService';

describe('yt-dlp failures', () => {
  it('says when yt-dlp was stopped for taking too long', () => {
    expect(describeYtDlpFailure({ killed: true, signal: 'SIGTERM' }).message).toContain(`${YTDLP_TIMEOUT_MS / 1000} s`);
  });
  it('keeps the ERROR line instead of the whole command', () => {
    const err = { code: 1, stderr: 'WARNING: x\r\nERROR: [youtube] abc: Video unavailable\r\n' };
    expect(describeYtDlpFailure(err).message).toBe('yt-dlp: ERROR: [youtube] abc: Video unavailable');
  });
});
