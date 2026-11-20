import { describe, expect, it, vi } from 'vitest';
import { buildYtDlpArgs, StreamResolverService } from '../../../src/main/services/StreamResolverService';
import { YouTubeAccessMonitor } from '../../../src/main/services/YouTubeAccessMonitor';
import {
  BOT_CHECK_CODE,
  hasYouTubeLogin,
  isBotCheckError,
  toNetscapeCookieFile
} from '../../../src/main/services/YouTubeAuthService';

const BOT_MSG = "ERROR: [youtube] abc: Sign in to confirm you're not a bot. This helps protect our community.";

describe('YouTube bot check', () => {
  it('recognises the wall from yt-dlp and Innertube', () => {
    expect(isBotCheckError(BOT_MSG)).toBe(true);
    expect(isBotCheckError('LOGIN_REQUIRED Sign in to confirm you’re not a bot')).toBe(true);
    expect(isBotCheckError('Video unavailable')).toBe(false);
  });

  it('turns it into a coded, Spanish error the UI can act on', async () => {
    const svc = new StreamResolverService(
      async () => {
        throw new Error(BOT_MSG);
      },
      async () => {
        throw new Error('LOGIN_REQUIRED');
      }
    );
    await expect(svc.resolve('evuMjOhcSlU')).rejects.toThrow(`${BOT_CHECK_CODE}: YouTube pidió confirmar`);
  });
});

describe('yt-dlp arguments', () => {
  it('adds the app Node runtime and cookies only when available', () => {
    expect(buildYtDlpArgs('evuMjOhcSlU')).toEqual([
      '-J',
      '--no-playlist',
      '--no-warnings',
      'https://www.youtube.com/watch?v=evuMjOhcSlU'
    ]);
    const args = buildYtDlpArgs('evuMjOhcSlU', { nodeRuntimePath: 'C:\P\Proyecta.exe', cookieFile: 'c.txt' });
    expect(args).toContain('--js-runtimes');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:C:\P\Proyecta.exe');
    expect(args[args.indexOf('--cookies') + 1]).toBe('c.txt');
  });
});

describe('cookies export', () => {
  const cookies = [
    { domain: '.youtube.com', name: 'LOGIN_INFO', value: 'abc', path: '/', secure: true, expirationDate: 2e9 },
    { domain: 'www.youtube.com', hostOnly: true, name: 'PREF', value: 'f1=1', path: '/' }
  ];

  it('writes Netscape cookies.txt lines', () => {
    const txt = toNetscapeCookieFile(cookies);
    expect(txt.startsWith('# Netscape HTTP Cookie File')).toBe(true);
    expect(txt).toContain('.youtube.com\tTRUE\t/\tTRUE\t2000000000\tLOGIN_INFO\tabc');
    expect(txt).toContain('www.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf1=1');
  });

  it('only counts a real YouTube login', () => {
    expect(hasYouTubeLogin(cookies)).toBe(true);
    expect(hasYouTubeLogin([{ domain: '.youtube.com', name: 'PREF', value: 'x' }])).toBe(false);
  });
});

describe('YouTubeAccessMonitor', () => {
  it('reports ok, blocked and offline from the probe', async () => {
    const onChange = vi.fn();
    const ok = new YouTubeAccessMonitor(async () => ({}), () => false, onChange);
    expect((await ok.check()).state).toBe('ok');
    const blocked = new YouTubeAccessMonitor(async () => Promise.reject(new Error(BOT_MSG)), () => true);
    const s = await blocked.check();
    expect(s).toMatchObject({ state: 'blocked', connected: true });
    const offline = new YouTubeAccessMonitor(async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')), () => false);
    expect((await offline.check()).state).toBe('offline');
    expect(onChange).toHaveBeenCalled();
  });

  it('learns from real playback failures', () => {
    const m = new YouTubeAccessMonitor(async () => ({}), () => false);
    m.reportPlaybackError(`${BOT_CHECK_CODE}: bloqueado`);
    expect(m.getStatus().state).toBe('blocked');
    m.reportPlaybackOk();
    expect(m.getStatus().state).toBe('ok');
  });
});
