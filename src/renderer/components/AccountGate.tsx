import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LogIn, MonitorSmartphone, X } from 'lucide-react';
import type { AccountStatus } from '../../shared/types';
import { useAccountStore } from '../store/useAccountStore';

const field =
  'mt-1 block h-10 w-full rounded-lg border border-white/[0.08] bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-deck-a/60 focus:outline-none';

/**
 * Sign-in with the business's Lantify account: business code, username and password (the
 * same ones as Lantify POS), or "Entrar con Lantify POS de este computador". A business
 * that only wants Proyecta creates its account on lantifypos.com.
 */
export function AccountSignIn({
  status,
  onSignedIn,
  compact = false
}: {
  status: AccountStatus | null;
  onSignedIn: (s: AccountStatus) => void;
  compact?: boolean;
}): ReactElement {
  const [tenantCode, setTenantCode] = useState(() => {
    try {
      return localStorage.getItem('proyecta.lastBusinessCode') ?? '';
    } catch {
      return '';
    }
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'form' | 'pos' | null>(null);
  const [error, setError] = useState<string | null>(status?.error ?? null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy('form');
    setError(null);
    const res = await window.tubedeckAPI.signIn({ tenantCode, username, password });
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    try {
      localStorage.setItem('proyecta.lastBusinessCode', tenantCode.trim().toUpperCase());
    } catch {
      // sin almacenamiento: se vuelve a escribir la próxima vez
    }
    setPassword('');
    onSignedIn(res.data);
  };

  const viaPos = async (): Promise<void> => {
    if (busy) return;
    setBusy('pos');
    setError(null);
    const res = await window.tubedeckAPI.signInWithLocalPos();
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    onSignedIn(res.data);
  };

  return (
    <div className={`w-full rounded-2xl border border-white/[0.07] bg-surface/90 ${compact ? 'p-4' : 'p-5'} text-left shadow-2xl backdrop-blur`}>
      <p className="text-sm font-semibold text-ink">Entra con tu cuenta de Lantify</p>
      <p className="mt-1 text-[12px] leading-snug text-muted">El mismo código del negocio, usuario y contraseña de Lantify POS.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3" noValidate>
        <label className="text-[12px] font-medium text-ink-soft">
          Código del negocio
          <input
            value={tenantCode}
            onChange={(e) => setTenantCode(e.target.value.toUpperCase())}
            placeholder="BAR-AB12"
            autoComplete="organization"
            spellCheck={false}
            maxLength={40}
            className={`${field} font-mono-tabular uppercase tracking-wide`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-ink-soft">
            Usuario
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              maxLength={64}
              className={field}
            />
          </label>
          <label className="relative text-[12px] font-medium text-ink-soft">
            Contraseña
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={256}
              className={`${field} pr-9`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded text-muted hover:text-ink cursor-pointer"
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </label>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] leading-snug text-danger-soft">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!!busy || !tenantCode.trim() || !username.trim() || !password}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-deck-a text-sm font-bold text-ground disabled:opacity-40 cursor-pointer"
        >
          {busy === 'form' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Entrar
          {busy === 'form' ? null : <ArrowRight className="h-4 w-4" />}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void viaPos()}
        disabled={!!busy}
        className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-raised text-[13px] font-semibold text-ink-soft hover:border-white/20 hover:text-ink disabled:opacity-40 cursor-pointer"
      >
        {busy === 'pos' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorSmartphone className="h-4 w-4" />}
        Entrar con Lantify POS de este computador
      </button>
      <p className="mt-4 border-t border-white/[0.06] pt-3 text-[12px] text-muted">
        ¿Solo necesitas Proyecta?{' '}
        <button
          type="button"
          onClick={() => void window.tubedeckAPI.openProyectaSignup()}
          className="font-semibold text-deck-b underline decoration-deck-b/40 underline-offset-2 hover:decoration-deck-b cursor-pointer"
        >
          Crea tu cuenta de Proyecta
        </button>
      </p>
    </div>
  );
}

/**
 * The licence was revoked or ran out while Proyecta was open: the music never stops for it.
 * A header notice opens the sign-in card on top of the app.
 */
export function AccountWarning(): ReactElement | null {
  const status = useAccountStore((s) => s.status);
  const setStatus = useAccountStore((s) => s.setStatus);
  const [open, setOpen] = useState(false);
  if (!status || status.state !== 'signed-out') return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-deck-b/40 bg-deck-b/10 px-2 text-[11px] font-semibold text-deck-b cursor-pointer"
        title={status.error ?? 'Entra de nuevo con tu cuenta de Lantify'}
      >
        <LogIn className="h-3.5 w-3.5" />
        Entrar a Lantify
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div role="dialog" aria-label="Entrar con tu cuenta de Lantify" className="relative w-full max-w-md">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-md text-muted hover:text-ink cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <AccountSignIn
              compact
              status={status}
              onSignedIn={(s) => {
                setStatus(s);
                setOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
