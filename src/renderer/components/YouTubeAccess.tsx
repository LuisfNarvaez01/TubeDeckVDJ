import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ShieldAlert, LogIn, LogOut, RotateCw, X, Loader2, CheckCircle2 } from 'lucide-react';
import type { YouTubeAccessStatus } from '../../shared/types';

const INITIAL: YouTubeAccessStatus = { state: 'unknown', connected: false, checkedAtMs: null, detail: null };

export function isBotCheckMessage(message: string | null | undefined): boolean {
  return Boolean(message && /YOUTUBE_BOT_CHECK|not a bot|LOGIN_REQUIRED/i.test(message));
}

/** Shared YouTube access state: startup probe result, sign-in status and actions. */
export function useYouTubeAccess(): {
  status: YouTubeAccessStatus;
  busy: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  recheck: () => Promise<void>;
} {
  const [status, setStatus] = useState<YouTubeAccessStatus>(INITIAL);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = window.tubedeckAPI;
    if (!api?.getYouTubeAccess) return;
    void api.getYouTubeAccess().then((res) => res.success && setStatus(res.data));
    return api.onYouTubeAccess((s) => setStatus(s));
  }, []);

  const run = useCallback(async (fn: () => Promise<{ success: boolean; data?: YouTubeAccessStatus }>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.success && res.data) setStatus(res.data);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    busy,
    connect: () => run(() => window.tubedeckAPI.connectYouTube()),
    disconnect: () => run(() => window.tubedeckAPI.disconnectYouTube()),
    recheck: () => run(() => window.tubedeckAPI.checkYouTubeAccess())
  };
}

/** Shown under the top bar only while YouTube is blocking playback from this connection. */
export function YouTubeBlockedBanner({
  status,
  busy,
  onConnect,
  onRecheck
}: {
  status: YouTubeAccessStatus;
  busy: boolean;
  onConnect: () => void;
  onRecheck: () => void;
}): ReactElement | null {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (status.state !== 'blocked' || (dismissedAt !== null && dismissedAt === status.checkedAtMs)) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-danger-soft" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">YouTube pidió confirmar que no eres un robot</p>
        <p className="text-muted">
          {status.connected
            ? 'Ya conectaste tu cuenta y YouTube sigue bloqueando. Espera unos minutos y reintenta, o prueba otra red (datos del celular).'
            : 'Mientras tanto no deja reproducir videos desde esta conexión. Inicia sesión en YouTube para confirmarlo (mejor con una cuenta secundaria), o espera, reinicia el módem o usa otra red.'}
        </p>
      </div>
      {!status.connected ? (
        <button
          type="button"
          disabled={busy}
          onClick={onConnect}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 font-semibold text-ground hover:bg-ink-2 disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
          Conectar YouTube
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onRecheck}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.14] px-2.5 py-1.5 font-semibold text-ink-soft hover:text-ink disabled:opacity-50 cursor-pointer"
      >
        <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        Reintentar
      </button>
      <button
        type="button"
        aria-label="Ocultar aviso de YouTube"
        onClick={() => setDismissedAt(status.checkedAtMs)}
        className="shrink-0 rounded p-1 text-muted hover:text-ink cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Settings card: optional YouTube sign-in used only to get past the bot check. */
export function YouTubeAccountCard(): ReactElement {
  const { status, busy, connect, disconnect, recheck } = useYouTubeAccess();
  const stateLabel =
    status.state === 'ok'
      ? 'YouTube responde con normalidad'
      : status.state === 'blocked'
        ? 'YouTube está bloqueando esta conexión'
        : status.state === 'checking'
          ? 'Comprobando…'
          : status.state === 'offline'
            ? 'No se pudo contactar a YouTube'
            : 'Sin comprobar';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <ShieldAlert className="h-4 w-4 text-muted" />
          Cuenta de YouTube (opcional)
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
            status.connected ? 'border-live/40 text-live' : 'border-white/[0.08] text-muted'
          }`}
        >
          {status.connected ? <CheckCircle2 className="h-3 w-3" /> : null}
          {status.connected ? 'Conectada' : 'Sin conectar'}
        </span>
      </div>
      <p className="text-[11px] text-muted">
        Solo hace falta si YouTube pide confirmar que no eres un robot. Inicias sesión tú mismo en una ventana de
        YouTube; Proyecta no ve tu contraseña. Recomendado: una cuenta secundaria.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={status.state === 'blocked' ? 'text-danger-soft' : 'text-ink-soft'}>{stateLabel}</span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void recheck()}
            className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2.5 py-1 font-semibold text-ink-soft hover:text-ink disabled:opacity-50 cursor-pointer"
          >
            <RotateCw className="h-3 w-3" />
            Comprobar
          </button>
          {status.connected ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2.5 py-1 font-semibold text-ink-soft hover:text-danger-soft disabled:opacity-50 cursor-pointer"
            >
              <LogOut className="h-3 w-3" />
              Desconectar
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void connect()}
              className="inline-flex items-center gap-1 rounded bg-ink px-2.5 py-1 font-semibold text-ground hover:bg-ink-2 disabled:opacity-50 cursor-pointer"
            >
              <LogIn className="h-3 w-3" />
              Conectar YouTube
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
