import { useState, type ReactElement, type ReactNode } from 'react';
import { Bot, Headphones, ImagePlus, Link2, LogOut, MonitorSmartphone, Trash2, UserRound, UserRoundX } from 'lucide-react';
import { useAccountStore } from '../store/useAccountStore';
import { useSongRequestStore } from '../store/useSongRequestStore';

const card = 'flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-ground p-4';
const btn =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised px-3 text-[12px] font-semibold text-ink-soft hover:border-white/20 hover:text-ink disabled:opacity-40 cursor-pointer';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-white/[0.05] pt-2 first:border-t-0 first:pt-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12px] font-medium text-ink">{children}</dd>
    </div>
  );
}

const SUBSCRIPTION: Record<string, string> = {
  TRIAL: 'Prueba gratuita',
  ACTIVE: 'Al día',
  PAST_DUE: 'Pago pendiente',
  GRACE: 'En gracia: revisa el pago',
  SUSPENDED: 'Suspendida'
};

/** Settings → Cuenta: who Proyecta is signed in as, and sign out. */
export function AccountCard(): ReactElement {
  const status = useAccountStore((s) => s.status);
  const setStatus = useAccountStore((s) => s.setStatus);
  const [confirm, setConfirm] = useState(false);

  if (!status || status.state !== 'signed-in' || !status.business || !status.user) {
    return (
      <section className={card}>
        <p className="text-[13px] font-semibold text-ink">Sin sesión de Lantify</p>
        <p className="text-[12px] leading-snug text-muted">
          {status?.error ?? 'Usa «Entrar a Lantify» en la barra de arriba. La música sigue sonando mientras tanto.'}
        </p>
      </section>
    );
  }

  return (
    <section className={card} aria-label="Cuenta de Lantify">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-deck-a/12 text-deck-a">
          <UserRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">{status.business.name}</p>
          <p className="truncate text-[12px] text-muted">
            {status.user.name} · @{status.user.username}
          </p>
        </div>
      </div>
      <dl className="grid gap-2 rounded-lg bg-surface p-3">
        <Row label="Código del negocio">
          <span className="font-mono-tabular">{status.business.code}</span>
        </Row>
        <Row label="Plan">{status.plan === 'proyecta' ? 'Proyecta' : 'Lantify POS (Proyecta incluido)'}</Row>
        <Row label="Suscripción">{status.subscription ? (SUBSCRIPTION[status.subscription] ?? status.subscription) : '—'}</Row>
        <Row label="Sin internet funciona hasta">
          {status.offlineUntil ? new Date(status.offlineUntil).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
        </Row>
        {status.viaPos ? (
          <Row label="Entró con">
            <span className="inline-flex items-center gap-1">
              <MonitorSmartphone className="h-3.5 w-3.5 text-deck-a" /> Lantify POS de este computador
            </span>
          </Row>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-[12px] text-ink-soft">¿Cerrar la sesión? La música no se detiene.</span>
            <button
              type="button"
              onClick={() =>
                void window.tubedeckAPI.signOut().then((r) => {
                  if (r.success) setStatus(r.data);
                  setConfirm(false);
                })
              }
              className={`${btn} border-danger/40 text-danger-soft`}
            >
              <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={btn}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className={btn}>
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Settings → Cabina y pedidos: is a DJ in the booth? Without one, Lantify POS decides the
 * pending requests (or its autopilot does) and hears about songs that fail to load.
 * Signed in with Lantify, Lantify Música links to the business without a code.
 */
export function BoothCard(): ReactElement {
  const snapshot = useSongRequestStore((s) => s.snapshot);
  const setSnapshot = useSongRequestStore((s) => s.setSnapshot);
  const account = useAccountStore((s) => s.status);
  const { desk, cloud, mode } = snapshot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = mode === 'cloud' && Boolean(cloud.business);
  const canLink = account?.state === 'signed-in' && !linked;

  const setPresent = async (present: boolean): Promise<void> => {
    const r = await window.tubedeckAPI.setDjPresent(present);
    if (r.success) setSnapshot(r.data);
  };

  const linkWithAccount = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    if (mode !== 'cloud') {
      const m = await window.tubedeckAPI.setRequestMode('cloud');
      if (!m.success) {
        setBusy(false);
        setError(m.error);
        return;
      }
    }
    const r = await window.tubedeckAPI.linkCloudRequestsWithAccount();
    setBusy(false);
    if (!r.success) setError(r.error);
    else setSnapshot(r.data);
  };

  return (
    <section className={card} aria-label="La cabina">
      <div>
        <p className="text-[13px] font-semibold text-ink">¿Quién decide los pedidos?</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          Con DJ en cabina decides tú y la caja no recibe avisos. Sin DJ, la caja de Lantify POS aprueba o rechaza, o lo deja a su piloto automático.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1" role="radiogroup" aria-label="¿Hay DJ en cabina?">
        {[
          { v: true, label: 'DJ en cabina', icon: Headphones },
          { v: false, label: 'Sin DJ', icon: UserRoundX }
        ].map(({ v, label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={desk.djPresent === v}
            onClick={() => void setPresent(v)}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold cursor-pointer ${
              desk.djPresent === v ? (v ? 'bg-deck-a/15 text-deck-a' : 'bg-deck-b/15 text-deck-b') : 'text-muted hover:text-ink'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {!desk.djPresent ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface p-3 text-[12px] leading-snug text-ink-soft">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-deck-b" />
          {!linked
            ? 'Vincula Proyecta con Lantify POS para que la caja decida cuando no hay DJ. Mientras tanto, los pedidos esperan aquí.'
            : desk.autopilot.enabled
              ? `Piloto automático de la caja: aprueba hasta ${desk.autopilot.maxPerHour} canciones por hora y ${desk.autopilot.maxPerTable} por mesa${desk.autopilot.skipOnLoadError ? ', y salta las que no cargan' : ''}. Se configura en Lantify POS → Proyecta.`
              : 'La caja aprueba o rechaza los pedidos desde Lantify POS. El piloto automático se activa allí, en Proyecta · música.'}
        </p>
      ) : null}
      {canLink ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
          <button type="button" disabled={busy} onClick={() => void linkWithAccount()} className={btn}>
            <Link2 className="h-3.5 w-3.5" />
            Vincular los pedidos con {account?.business?.name ?? 'mi negocio'}
          </button>
          <span className="text-[11px] text-muted">Sin código: usa tu cuenta de Lantify.</span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-danger-soft">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Settings → Cabina y pedidos: the venue's logo on the Screen 2 QR card (or its name). */
export function VenueBrandCard(): ReactElement {
  const page = useSongRequestStore((s) => s.snapshot.page);
  const business = useSongRequestStore((s) => s.snapshot.cloud.business);
  const setSnapshot = useSongRequestStore((s) => s.setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const name = page.venueName || business?.name || '';

  const pick = async (): Promise<void> => {
    setError(null);
    const r = await window.tubedeckAPI.pickVenueLogo();
    if (!r.success) setError(r.error);
    else setSnapshot(r.data);
  };
  const remove = async (): Promise<void> => {
    const r = await window.tubedeckAPI.setGuestPageSettings({ logoDataUrl: '' });
    if (r.success) setSnapshot(r.data);
  };

  return (
    <section className={card} aria-label="Logo en Pantalla 2">
      <div>
        <p className="text-[13px] font-semibold text-ink">Tu marca en el QR de Pantalla 2</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          Arriba del QR va el logo del local; sin logo, su nombre. Abajo, una firma pequeña de Proyecta y Lantify.
        </p>
      </div>
      <div className="flex items-center gap-4">
        {/* Vista previa de la tarjeta */}
        <div className="flex w-32 shrink-0 flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-center">
          {page.logoDataUrl ? (
            <img src={page.logoDataUrl} alt="Logo del local" className="h-8 max-w-full object-contain" />
          ) : (
            <span className="max-w-full truncate text-[11px] font-extrabold text-[#0b0b0d]">{name || 'Tu local'}</span>
          )}
          <span className="grid aspect-square w-full place-items-center rounded bg-[repeating-linear-gradient(45deg,#e5e5e8_0_4px,#fff_4px_8px)] text-[9px] font-bold text-[#6b6b76]">
            QR
          </span>
          <span className="text-[10px] font-bold text-[#0b0b0d]">Pide tu canción</span>
          <span className="text-[8px] font-semibold text-[#6b6b76]">Proyecta · by Lantify</span>
        </div>
        <div className="flex flex-col items-start gap-2">
          <button type="button" onClick={() => void pick()} className={btn}>
            <ImagePlus className="h-3.5 w-3.5" />
            {page.logoDataUrl ? 'Cambiar logo' : 'Elegir logo'}
          </button>
          {page.logoDataUrl ? (
            <button type="button" onClick={() => void remove()} className={btn}>
              <Trash2 className="h-3.5 w-3.5" /> Quitar logo y usar el nombre
            </button>
          ) : null}
          <p className="text-[11px] text-muted">PNG, JPG o WebP de hasta 400 KB. Mejor con fondo transparente.</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-soft">
          {error}
        </p>
      ) : null}
    </section>
  );
}
