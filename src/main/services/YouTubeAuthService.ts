import fs from 'fs';
import path from 'path';

/** Minimal shape of an Electron cookie (kept local so this file stays testable). */
export interface CookieLike {
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  expirationDate?: number;
  name: string;
  value: string;
}

/** YouTube's "confirm you're not a bot" wall, as yt-dlp and Innertube report it. */
export function isBotCheckError(message: string): boolean {
  return /not a bot|confirm you.?re not a bot|LOGIN_REQUIRED|Sign in to confirm/i.test(message);
}

export const BOT_CHECK_CODE = 'YOUTUBE_BOT_CHECK';

const AUTH_COOKIE_NAMES = ['SAPISID', '__Secure-3PAPISID', 'LOGIN_INFO', 'SID'];

/** Netscape cookies.txt, the format yt-dlp's --cookies reads. */
export function toNetscapeCookieFile(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Written by Proyecta for yt-dlp. Do not share.', ''];
  for (const c of cookies) {
    if (!c.domain || /[\t\n]/.test(c.value)) continue;
    const domain = c.hostOnly || c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    lines.push(
      [
        domain,
        domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path ?? '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(Math.floor(c.expirationDate ?? 0)),
        c.name,
        c.value
      ].join('\t')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function hasYouTubeLogin(cookies: CookieLike[]): boolean {
  return cookies.some(
    (c) => AUTH_COOKIE_NAMES.includes(c.name) && /(^|\.)youtube\.com$/.test((c.domain ?? '').replace(/^\./, ''))
  );
}

export interface CookieStoreLike {
  get(filter: { domain?: string }): Promise<CookieLike[]>;
}

/**
 * Optional YouTube sign-in, only used to get past "confirm you're not a bot".
 * The user signs in themselves inside an isolated window (its own session partition);
 * Proyecta never sees the password, only exports that session's cookies for yt-dlp.
 */
export class YouTubeAuthService {
  constructor(
    private readonly cookieFilePath: string,
    private readonly getCookieStore: () => CookieStoreLike
  ) {}

  getCookieFilePath(): string | null {
    return fs.existsSync(this.cookieFilePath) ? this.cookieFilePath : null;
  }

  /** Re-exports the sign-in window's cookies. Returns true when a YouTube login is present. */
  async syncCookies(): Promise<boolean> {
    const store = this.getCookieStore();
    const all = [...(await store.get({ domain: 'youtube.com' })), ...(await store.get({ domain: 'google.com' }))];
    if (!hasYouTubeLogin(all)) {
      fs.rmSync(this.cookieFilePath, { force: true });
      return false;
    }
    fs.mkdirSync(path.dirname(this.cookieFilePath), { recursive: true });
    fs.writeFileSync(this.cookieFilePath, toNetscapeCookieFile(all), { mode: 0o600 });
    return true;
  }

  isConnected(): boolean {
    return this.getCookieFilePath() !== null;
  }

  disconnectFile(): void {
    fs.rmSync(this.cookieFilePath, { force: true });
  }
}
