import type { YouTubeAccessStatus } from '../../shared/types';
import { BOT_CHECK_CODE, isBotCheckError } from './YouTubeAuthService';

export type { YouTubeAccessStatus };


/** "Me at the zoo": tiny, permanent, never age-restricted — a cheap playability probe. */
export const PROBE_VIDEO_ID = 'jNQXAC9IVRw';

/**
 * Checks once at startup (and after sign-in) whether YouTube lets this connection play
 * videos, so the DJ learns about a "not a bot" block before the first song fails.
 */
export class YouTubeAccessMonitor {
  private status: YouTubeAccessStatus;
  private probing: Promise<YouTubeAccessStatus> | null = null;

  constructor(
    private readonly probe: (videoId: string) => Promise<unknown>,
    private readonly isConnected: () => boolean,
    private readonly onChange: (status: YouTubeAccessStatus) => void = () => {}
  ) {
    this.status = { state: 'unknown', connected: isConnected(), checkedAtMs: null, detail: null };
  }

  getStatus(): YouTubeAccessStatus {
    return { ...this.status, connected: this.isConnected() };
  }

  /** A real playback failure tells us more than any probe. */
  reportPlaybackError(message: string): void {
    if (message.includes(BOT_CHECK_CODE) || isBotCheckError(message)) {
      this.set({ state: 'blocked', checkedAtMs: Date.now(), detail: null });
    }
  }

  reportPlaybackOk(): void {
    if (this.status.state !== 'ok') this.set({ state: 'ok', checkedAtMs: Date.now(), detail: null });
  }

  check(): Promise<YouTubeAccessStatus> {
    if (this.probing) return this.probing;
    this.set({ state: 'checking', detail: null });
    this.probing = this.probe(PROBE_VIDEO_ID)
      .then(() => this.set({ state: 'ok', checkedAtMs: Date.now(), detail: null }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        const blocked = isBotCheckError(msg) || msg.includes(BOT_CHECK_CODE);
        return this.set({
          state: blocked ? 'blocked' : 'offline',
          checkedAtMs: Date.now(),
          detail: blocked ? null : msg.slice(0, 200)
        });
      })
      .finally(() => {
        this.probing = null;
      });
    return this.probing;
  }

  private set(patch: Partial<YouTubeAccessStatus>): YouTubeAccessStatus {
    this.status = { ...this.status, ...patch, connected: this.isConnected() };
    this.onChange(this.getStatus());
    return this.getStatus();
  }
}
