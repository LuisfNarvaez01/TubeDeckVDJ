import type { NetworkStatus } from '../../shared/types';

/** Resolves true when the internet answered. Must never throw. */
export type NetworkProbe = () => Promise<boolean>;

const PROBE_URLS = ['https://www.gstatic.com/generate_204', 'https://www.youtube.com/generate_204'];

/** Default probe: any answer from either endpoint within 5 s counts as online. */
export function createFetchProbe(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): NetworkProbe {
  return async () => {
    for (const url of PROBE_URLS) {
      try {
        const res = await fetchImpl(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (res.status < 500) return true;
      } catch {
        // try the next endpoint
      }
    }
    return false;
  };
}

/**
 * Watches the internet connection so the DJ knows when a failure is the network and not the
 * app. Two failed probes in a row are needed to call it offline (one lost packet is not an
 * outage); while offline it probes more often so the recovery is noticed quickly.
 */
export class NetworkMonitor {
  private status: NetworkStatus = { online: true, checkedAtMs: null, offlineSinceMs: null };
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight: Promise<NetworkStatus> | null = null;

  constructor(
    private readonly probe: NetworkProbe,
    private readonly onChange: (status: NetworkStatus) => void,
    private readonly intervals = { onlineMs: 15_000, offlineMs: 4_000 },
    private readonly now: () => number = Date.now
  ) {}

  getStatus(): NetworkStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.check();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Something (a failed stream, the OS) hinted the link changed: probe now. */
  check(): Promise<NetworkStatus> {
    if (!this.inFlight) {
      this.inFlight = this.runProbe().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async runProbe(): Promise<NetworkStatus> {
    const ok = await this.probe().catch(() => false);
    const at = this.now();
    this.failures = ok ? 0 : this.failures + 1;
    const online = ok || (this.status.online && this.failures < 2);
    const changed = online !== this.status.online;
    this.status = {
      online,
      checkedAtMs: at,
      offlineSinceMs: online ? null : (this.status.offlineSinceMs ?? at)
    };
    if (changed) this.onChange(this.getStatus());
    this.schedule();
    return this.getStatus();
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.status.online && this.failures === 0 ? this.intervals.onlineMs : this.intervals.offlineMs;
    this.timer = setTimeout(() => void this.check(), delay);
  }
}
