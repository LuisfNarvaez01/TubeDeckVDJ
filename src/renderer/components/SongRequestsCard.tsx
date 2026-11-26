import { useEffect, useState, type ReactElement } from 'react';
import { Globe, Link2, LoaderCircle, Printer, QrCode, RotateCcw, Unlink, Wifi } from 'lucide-react';
import type { GuestPageSettings, Result, SongRequestMode, SongRequestPrefs, SongRequestsSnapshot } from '../../shared/types';
import { activeQr, useSongRequestStore } from '../store/useSongRequestStore';

const controlBtn =
  'inline-flex items-center justify-center gap-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer';
const textInput =
  'min-w-0 rounded border border-white/[0.08] bg-raised px-2 py-1 text-ink caret-deck-a placeholder:text-faint focus:border-white/25 focus:outline-none';

const MODES: Array<{ id: SongRequestMode; label: string; hint: string }> = [
  { id: 'off', label: 'Desactivado', hint: 'Nadie puede pedir canciones.' },
  {
    id: 'cloud',
    label: 'Por internet',
    hint: 'El QR funciona desde cualquier red (datos o WiFi). Úsalo solo o vinculado a Lantify POS.'
  },
  {
    id: 'local',
    label: 'Solo red del local',
    hint: 'Sin internet: el QR solo abre en celulares conectados al WiFi del local.'
  }
];

const CONNECTION_TEXT: Record<SongRequestsSnapshot['cloud']['connection'], string> = {
  unregistered: 'Sin activar',
  connecting: 'Conectando…',
  online: 'Conectado: recibe pedidos',
  offline: 'Sin conexión: reintentando',
  revoked: 'Desconectado por Lantify'
};

/**
 * Ajustes → Pedidos de canciones: choose how phones reach Proyecta (internet relay, alone
 * or linked to Lantify POS, or the venue WiFi only), see the QR, and set the rules.
 */
export function SongRequestsCard(): ReactElement {
  const snapshot = useSongRequestStore((s) => s.snapshot);
  const setSnapshot = useSongRequestStore((s) => s.setSnapshot);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState(10);
  const { mode, prefs, page, cloud, local } = snapshot;
  const [venueName, setVenueName] = useState(page.venueName);
  const [wifiName, setWifiName] = useState(page.wifiName);
  const qr = activeQr(snapshot);

  useEffect(() => setVenueName(page.venueName), [page.venueName]);
  useEffect(() => setWifiName(page.wifiName), [page.wifiName]);

  const run = async (fn: () => Promise<Result<SongRequestsSnapshot>> | undefined): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res) return;
    if (res.success) setSnapshot(res.data);
    else setError(res.error);
  };
  const api = window.tubedeckAPI;
  const setPref = (patch: Partial<SongRequestPrefs>): void => void run(() => api?.setRequestPrefs(patch));
  const setPage = (patch: Partial<GuestPageSettings>): void => void run(() => api?.setGuestPageSettings(patch));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3 sm:col-span-2">
      <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
        <QrCode className="h-4 w-4 text-muted" />
        Pedidos de canciones
      </h3>

      <div role="radiogroup" aria-label="Cómo llegan los pedidos" className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            disabled={busy}
            onClick={() => void run(() => api?.setRequestMode(m.id))}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
              mode === m.id
                ? 'border-live/50 bg-live/12 text-live'
                : 'border-white/[0.06] bg-raised text-ink-soft hover:bg-raised-2 hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted">{MODES.find((m) => m.id === mode)?.hint}</p>

      {mode !== 'off' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-muted">
            Nombre del local
            <input
              value={venueName}
              maxLength={60}
              onChange={(e) => setVenueName(e.target.value)}
              onBlur={() => venueName !== page.venueName && setPage({ venueName })}
              placeholder="Se ve en el celular y en el QR"
              className={textInput}
            />
          </label>
          {mode === 'local' ? (
            <label className="flex flex-col gap-1 text-muted">
              WiFi para clientes
              <input
                value={wifiName}
                maxLength={60}
                onChange={(e) => setWifiName(e.target.value)}
                onBlur={() => wifiName !== page.wifiName && setPage({ wifiName })}
                placeholder="Se imprime junto al QR"
                className={textInput}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {mode === 'cloud' && !cloud.registered ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded border border-white/[0.06] bg-surface p-2">
            <p className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Globe className="h-3.5 w-3.5 text-muted" />
              Usar Proyecta solo
            </p>
            <p className="text-[11px] leading-snug text-muted">
              Proyecta crea su propio QR en musica.lantifypos.com. No necesitas Lantify POS.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api?.registerCloudRequests())}
              className={`${controlBtn} self-start`}
            >
              {busy ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <QrCode className="h-3 w-3" />}
              Activar pedidos por internet
            </button>
          </div>
          <form
            className="flex flex-col gap-1.5 rounded border border-white/[0.06] bg-surface p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const res = await api?.linkCloudRequests(code);
                if (res?.success) setCode('');
                return res;
              });
            }}
          >
            <p className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <Link2 className="h-3.5 w-3.5 text-muted" />
              Vincular con Lantify POS
            </p>
            <p className="text-[11px] leading-snug text-muted">
              Código de Lantify → Proyecta · música. La página usa los colores del negocio y el chat con la caja.
            </p>
            <div className="flex items-center gap-1.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={12}
                placeholder="Código de 8 caracteres"
                aria-label="Código de vinculación de Lantify POS"
                autoComplete="off"
                spellCheck={false}
                className={`${textInput} flex-1 font-mono-tabular tracking-widest placeholder:tracking-normal`}
              />
              <button type="submit" disabled={busy || code.replace(/[\s-]/g, '').length !== 8} className={controlBtn}>
                Vincular
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {mode !== 'off' && (mode === 'local' || cloud.registered) ? (
        <div className="flex gap-3">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded bg-raised">
            {qr?.svg ? (
              <img src={qr.svg} alt="QR para pedir canciones" className="h-full w-full rounded bg-ink p-1" />
            ) : (
              <LoaderCircle className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none" aria-hidden="true" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {mode === 'cloud' ? (
              <>
                <p className="text-[11px] text-ink-soft">
                  {cloud.business ? (
                    <>
                      Vinculado a <span className="font-semibold text-ink">«{cloud.business.name}»</span> ·{' '}
                    </>
                  ) : (
                    'Módulo independiente · '
                  )}
                  <span className={cloud.connection === 'online' ? 'text-live' : 'text-muted'}>
                    {CONNECTION_TEXT[cloud.connection]}
                  </span>
                </p>
                {cloud.url ? <p className="break-all font-mono-tabular text-[10px] text-faint">{cloud.url}</p> : null}
              </>
            ) : (
              <>
                {local.url ? (
                  <p className="text-[11px] leading-snug text-ink-soft">
                    Activo en <span className="break-all font-mono-tabular text-ink">{local.url.split('/?')[0]}</span>
                  </p>
                ) : null}
                <p className="text-[11px] leading-snug text-muted">
                  Si Windows pregunta, permite el acceso en redes privadas. En redes de invitados que aíslan los
                  celulares, el QR no abre.
                </p>
                {local.addresses.length > 1 ? (
                  <label className="flex items-center gap-1.5 text-muted">
                    <Wifi className="h-3 w-3" />
                    <select
                      value={local.settings.address}
                      onChange={(e) => void run(() => api?.setLocalRequestSettings({ address: e.target.value }))}
                      className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink"
                      aria-label="Red del local"
                    >
                      <option value="">Automática ({local.addresses[0]})</option>
                      {local.addresses.map((ip) => (
                        <option key={ip} value={ip}>
                          {ip}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}
            {(mode === 'cloud' ? cloud.error : local.error) ? (
              <p role="alert" className="text-[11px] text-danger-soft">
                {mode === 'cloud' ? cloud.error : local.error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === 'cloud' && !cloud.registered && cloud.error ? (
        <p role="alert" className="text-[11px] text-danger-soft">
          {cloud.error}
        </p>
      ) : null}

      {qr ? (
        <>
          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={page.qrOnScreen}
              onChange={(e) => setPage({ qrOnScreen: e.target.checked })}
              className="accent-ink-2"
            />
            Mostrar el QR en una esquina de Pantalla 2
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-muted">
              Mesas
              <input
                type="number"
                min={0}
                max={100}
                value={tables}
                onChange={(e) => setTables(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
                className="w-16 rounded border border-white/[0.06] bg-raised px-2 py-1 font-mono-tabular text-ink"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setError(null);
                const res = await api?.printRequestSheet(tables);
                if (res && !res.success) setError(res.error);
              }}
              title="Abre una hoja con un QR general y uno por mesa, lista para imprimir"
              className={controlBtn}
            >
              <Printer className="h-3 w-3" />
              Hoja de QR para imprimir
            </button>
            {mode === 'local' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Los QR impresos o mostrados dejarán de funcionar. ¿Generar un código nuevo?')) {
                    void run(() => api?.rotateLocalRequestKey());
                  }
                }}
                title="Invalida los QR anteriores"
                className={`${controlBtn} hover:text-danger-soft`}
              >
                <RotateCcw className="h-3 w-3" />
                Cambiar QR
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const msg = cloud.business
                    ? `¿Desvincular de «${cloud.business.name}»? Los QR impresos dejarán de funcionar.`
                    : '¿Dejar de usar este QR? Los QR impresos dejarán de funcionar.';
                  if (window.confirm(msg)) void run(() => api?.unregisterCloudRequests());
                }}
                className={`${controlBtn} hover:text-danger-soft`}
              >
                <Unlink className="h-3 w-3" />
                {cloud.business ? 'Desvincular' : 'Dejar de usar este QR'}
              </button>
            )}
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11px] text-danger-soft">
          {error}
        </p>
      ) : null}

      {mode !== 'off' ? (
        <>
          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.autoApprove}
              onChange={(e) => setPref({ autoApprove: e.target.checked })}
              className="accent-ink-2"
            />
            Aprobar automáticamente (solo los que pasan los filtros)
          </label>

          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.autoPlay}
              onChange={(e) => setPref({ autoPlay: e.target.checked })}
              className="accent-ink-2"
            />
            Poner los pedidos aprobados aunque Automix esté apagado (van primero en la cola)
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-muted">
              Máximo por mesa (por hora)
              <input
                type="number"
                min={1}
                max={30}
                value={prefs.maxPerTable}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (n >= 1 && n <= 30) setPref({ maxPerTable: n });
                }}
                className="rounded border border-white/[0.06] bg-raised px-2 py-1 font-mono-tabular text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-muted">
              Máximo automático por hora
              <input
                type="number"
                min={1}
                max={120}
                value={prefs.maxPerHour}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (n >= 1 && n <= 120) setPref({ maxPerHour: n });
                }}
                className="rounded border border-white/[0.06] bg-raised px-2 py-1 font-mono-tabular text-ink"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.overlayEnabled}
              onChange={(e) => setPref({ overlayEnabled: e.target.checked })}
              className="accent-ink-2"
            />
            Mostrar «Pedida por la mesa N» en Pantalla 2 (primeros 10 s)
          </label>
        </>
      ) : null}
    </div>
  );
}
