import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { RotateCw, Wifi, WifiOff } from 'lucide-react';
import type { NetworkStatus } from '../../shared/types';

const ONLINE: NetworkStatus = { online: true, checkedAtMs: null, offlineSinceMs: null };

/**
 * Internet status from the main-process probe, sped up by the OS online/offline events.
 * `onChange` fires once per transition (false = connection lost, true = back).
 */
export function useNetworkStatus(onChange?: (online: boolean) => void): {
  status: NetworkStatus;
  recheck: () => void;
} {
  const [status, setStatus] = useState<NetworkStatus>(ONLINE);
  const lastOnline = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback((next: NetworkStatus) => {
    setStatus(next);
    if (next.online !== lastOnline.current) {
      lastOnline.current = next.online;
      onChangeRef.current?.(next.online);
    }
  }, []);

  const recheck = useCallback(() => {
    void window.tubedeckAPI?.checkNetwork?.().then((res) => res.success && apply(res.data));
  }, [apply]);

  useEffect(() => {
    const api = window.tubedeckAPI;
    if (!api?.getNetworkStatus) return;
    void api.getNetworkStatus().then((res) => res.success && apply(res.data));
    const unsub = api.onNetworkStatus((s) => apply(s));
    const onOffline = (): void =>
      apply({ online: false, checkedAtMs: Date.now(), offlineSinceMs: Date.now() });
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', recheck);
    return () => {
      unsub();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', recheck);
    };
  }, [apply, recheck]);

  return { status, recheck };
}

function sinceLabel(fromMs: number | null, nowMs: number): string {
  if (!fromMs) return '';
  const sec = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  return sec < 60 ? `hace ${sec} s` : `hace ${Math.floor(sec / 60)} min`;
}

/** Tells the DJ the problem is the connection, not Proyecta, and that Automix will resume. */
export function NetworkBanner({ status, onRecheck }: { status: NetworkStatus; onRecheck: () => void }): ReactElement | null {
  const [now, setNow] = useState(() => Date.now());
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!status.online) {
      wasOffline.current = true;
      setRestoredAt(null);
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setRestoredAt(Date.now());
      const id = setTimeout(() => setRestoredAt(null), 5000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [status.online]);

  if (status.online && restoredAt) {
    return (
      <div role="status" className="flex shrink-0 items-center gap-2 rounded-lg border border-live/40 bg-live/10 px-3 py-1.5 text-xs">
        <Wifi className="h-4 w-4 shrink-0 text-live" />
        <span className="font-semibold text-ink">Conexión restablecida.</span>
        <span className="text-muted">El automix retoma y los decks con error se recargan.</span>
      </div>
    );
  }
  if (status.online) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 rounded-lg border border-danger/50 bg-danger/15 px-3 py-2 text-xs">
      <WifiOff className="h-4 w-4 shrink-0 text-danger-soft" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">
          Sin conexión a internet <span className="font-normal text-muted">{sinceLabel(status.offlineSinceMs, now)}</span>
        </p>
        <p className="text-muted">
          Es la red, no Proyecta. Lo que ya está cargado sigue sonando y la música local funciona. El automix espera
          y retoma solo cuando vuelva la conexión.
        </p>
      </div>
      <button
        type="button"
        onClick={onRecheck}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.14] px-2.5 py-1.5 font-semibold text-ink-soft hover:text-ink cursor-pointer"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Comprobar
      </button>
    </div>
  );
}
