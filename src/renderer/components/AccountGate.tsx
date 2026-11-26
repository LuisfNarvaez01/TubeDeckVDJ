import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LogIn, MonitorSmartphone, X } from 'lucide-react';
import type { AccountStatus } from '../../shared/types';
import { useAccountStore } from '../store/useAccountStore';

const field =
  'mt-1 block h-10 w-full rounded-lg border border-white/[0.08] bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-deck-a/60 focus:outline-none';

/** Business picked when the account opens several (sent on later sign-ins). */
export const LAST_BUSINESS_CODE_KEY = 'proyecta.lastBusinessCode';

function readLastCode(): string {
  try {
    return localStorage.getItem(LAST_BUSINESS_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeLastCode(code: string): void {
  try {
    if (code) localStorage.setItem(LAST_BUSINESS_CODE_KEY, code);
    else localStorage.removeItem(LAST_BUSINESS_CODE_KEY);
  } catch {
    // sin almacenamiento: se elige de nuevo la próxima vez
  }
}

/**
 * Sign-in with the business's Lantify account: username (or email) and password, the same
 * ones as Lantify POS, or "Entrar con Lantify POS de este computador". When the account
 * opens several businesses the card lists them; the one picked is remembered
 * (`proyecta.lastBusinessCode`) and sent on later sign-ins without asking again. Typing
 * the business code is an optional fallback ("Entrar con el código del negocio"). A
 * business that only wants Proyecta creates its account on lantifypos.com.
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
  const [tenantCode, setTenantCode] = useState(readLastCode);
  const [showCode, setShowCode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  /** 'form', 'pos', or the code of the business being opened from the list. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(status?.error ?? null);
  const [choices, setChoices] = useState<AccountStatus['businessChoices']>(status?.businessChoices ?? null);

  const signIn = async (code: string, fromList: boolean): Promise<void> => {
    if (busy) return;
    setBusy(fromList ? code : 'form');
    setError(null);
    const res = await window.tubedeckAPI.signIn({ tenantCode: code || undefined, username, password });
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (res.data.state !== 'signed-in' && res.data.businessChoices) {
      setChoices(res.data.businessChoices); // which business? the password stays for the retry
      return;
    }
    if (code) {
      writeLastCode(code);
      setTenantCode(code);
    }
    setChoices(null);
    setPassword('');
    onSignedIn(res.data);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    // The remembered business goes along silently; the typed one when the fallback is open
    void signIn(tenantCode.trim().toUpperCase(), false);
  };

  const dropCode = (): void => {
    setTenantCode('');
    setShowCode(false);
    writeLastCode('');
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

  const errorBox = error ? (
    <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] leading-snug text-danger-soft">
      {error}
    </p>
  ) : null;
  const card = `w-full rounded-2xl border border-white/[0.07] bg-surface/90 ${compact ? 'p-4' : 'p-5'} text-left shadow-2xl backdrop-blur`;

  if (choices && choices.length > 0) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold text-ink">¿Qué negocio vas a abrir?</p>
        <p className="mt-1 text-[12px] leading-snug text-muted">
          Tu cuenta entra a varios negocios. Elige uno: Proyecta lo recuerda para la próxima vez.
        </p>
        <div className="mt-4 grid gap-2">
          {choices.map((b) => (
            <button
              key={b.code}
              type="button"
              onClick={() => void signIn(b.code, true)}
              disabled={!!busy}
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-raised px-3 py-2 text-left hover:border-deck-a/50 disabled:opacity-40 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{b.name}</span>
                <span className="block font-mono-tabular text-[11px] uppercase tracking-wide text-muted">{b.code}</span>
              </span>
              {busy === b.code ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
              )}
            </button>
          ))}
        </div>
        {errorBox ? <div className="mt-3">{errorBox}</div> : null}
        <button
          type="button"
          onClick={() => {
            setChoices(null);
            setError(null);
          }}
          disabled={!!busy}
          className="mt-3 text-[12px] font-semibold text-muted underline decoration-white/20 underline-offset-2 hover:text-ink disabled:opacity-40 cursor-pointer"
        >
          Volver
        </button>
      </div>
    );
  }

  const remembered = !showCode && tenantCode.trim().length >= 3;

  return (
    <div className={card}>
      <p className="text-sm font-semibold text-ink">Entra con tu cuenta de Lantify</p>
      <p className="mt-1 text-[12px] leading-snug text-muted">La misma cuenta de Lantify POS (usuario o correo y contraseña).</p>
      <form onSubmit={submit} className="mt-4 grid gap-3" noValidate>
        <label className="text-[12px] font-medium text-ink-soft">
          Usuario o correo
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            spellCheck={false}
            maxLength={120}
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
        {showCode ? (
          <label className="text-[12px] font-medium text-ink-soft">
            <span className="flex items-center justify-between">
              Código del negocio <span className="font-normal text-muted">(opcional)</span>
            </span>
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
        ) : null}
        {errorBox}
        <button
          type="submit"
          disabled={!!busy || !username.trim() || !password}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-deck-a text-sm font-bold text-ground disabled:opacity-40 cursor-pointer"
        >
          {busy === 'form' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Entrar
          {busy === 'form' ? null : <ArrowRight className="h-4 w-4" />}
        </button>
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {remembered ? (
            <>
              <span>
                Negocio: <span className="font-mono-tabular uppercase text-ink-soft">{tenantCode}</span>
              </span>
              <button type="button" onClick={dropCode} className="font-semibold hover:text-ink cursor-pointer">
                Cambiar
              </button>
            </>
          ) : showCode ? (
            <button type="button" onClick={dropCode} className="font-medium underline decoration-white/20 underline-offset-2 hover:text-ink cursor-pointer">
              Entrar sin el código
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="font-medium underline decoration-white/20 underline-offset-2 hover:text-ink cursor-pointer"
            >
              Entrar con el código del negocio
            </button>
          )}
        </p>
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
