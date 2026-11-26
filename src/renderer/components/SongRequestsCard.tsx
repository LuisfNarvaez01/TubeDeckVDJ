import { useEffect, useState, type ReactElement } from 'react';
import { Link2, LoaderCircle, Printer, QrCode, RotateCcw, Unlink } from 'lucide-react';
import type { LocalRequestSettings, Result, SongRequestMode, SongRequestPrefs, SongRequestsSnapshot } from '../../shared/types';
import { useSongRequestStore } from '../store/useSongRequestStore';

const controlBtn =
  'inline-flex items-center justify-center gap-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer';
const textInput =
  'min-w-0 rounded border border-white/[0.08] bg-raised px-2 py-1 text-ink caret-deck-a placeholder:text-faint focus:border-white/25 focus:outline-none';

const MODES: Array<{ id: SongRequestMode; label: string; hint: string }> = [
  { id: 'off', label: 'Desactivado', hint: 'Nadie puede pedir canciones.' },
  { id: 'lantify', label: 'Lantify POS', hint: 'El negocio usa Lantify: los clientes piden desde el QR de su mesa.' },
  {
    id: 'local',
    label: 'QR propio',
    hint: 'Sin Lantify: Proyecta genera su QR. Los clientes deben estar en el WiFi del local.'
  }
];

/**
 * Ajustes → Pedidos de canciones: choose the source (Lantify POS table QR or Proyecta's
 * own QR on the venue WiFi), pair or configure it, and set how requests are handled.
 */
export function SongRequestsCard(): ReactElement {
  const snapshot = useSongRequestStore((s) => s.snapshot);
  const setSnapshot = useSongRequestStore((s) => s.setSnapshot);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState(10);
  const { mode, prefs, lantify, local } = snapshot;
  const [venueName, setVenueName] = useState(local.settings.venueName);
  const [wifiName, setWifiName] = useState(local.settings.wifiName);

  useEffect(() => setVenueName(local.settings.venueName), [local.settings.venueName]);
  useEffect(() => setWifiName(local.settings.wifiName), [local.settings.wifiName]);

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
  const setLocal = (patch: Partial<LocalRequestSettings>): void => void run(() => api?.setLocalRequestSettings(patch));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3 sm:col-span-2">
      <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
        <QrCode className="h-4 w-4 text-muted" />
        Pedidos de canciones
      </h3>

      <div role="radiogroup" aria-label="De dónde llegan los pedidos" className="flex flex-wrap gap-1">
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

      {mode === 'lantify' ? (
        lantify.paired ? (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-ink-soft">
              Vinculado a <span className="font-semibold text-ink">«{lantify.business?.name ?? 'tu negocio'}»</span>
              {lantify.connection === 'retrying' ? <span className="text-muted"> · sin conexión</span> : null}
            </p>
            <button
              type="button"
              onClick={() => void run(() => api?.lantifyUnpair())}
              className={`${controlBtn} hover:text-danger-soft`}
            >
              <Unlink className="h-3 w-3" />
              Desvincular
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const res = await api?.lantifyPair(code);
                if (res?.success) setCode('');
                return res;
              });
            }}
          >
            <p className="text-[11px] leading-snug text-muted">
              {lantify.connection === 'revoked'
                ? `Lantify desvinculó Proyecta${lantify.business ? ` de «${lantify.business.name}»` : ''}. Vincula de nuevo con un código nuevo.`
                : 'Sin vincular. El código de 8 caracteres está en Lantify → Mi página → Pedir canciones.'}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={12}
                placeholder="Código de 8 caracteres"
                aria-label="Código de vinculación de Lantify"
                autoComplete="off"
                spellCheck={false}
                className={`${textInput} flex-1 font-mono-tabular tracking-widest placeholder:tracking-normal`}
              />
              <button type="submit" disabled={busy || code.replace(/[\s-]/g, '').length !== 8} className={controlBtn}>
                {busy ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Link2 className="h-3 w-3" />}
                {lantify.connection === 'revoked' ? 'Vincula de nuevo' : 'Vincular'}
              </button>
            </div>
          </form>
        )
      ) : null}

      {mode === 'local' ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-3">
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded bg-raised">
              {local.qrSvgDataUrl ? (
                <img src={local.qrSvgDataUrl} alt="QR para pedir canciones" className="h-full w-full rounded bg-ink p-1" />
              ) : (
                <LoaderCircle className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none" aria-hidden="true" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {local.url ? (
                <p className="text-[11px] leading-snug text-ink-soft">
                  Activo en <span className="break-all font-mono-tabular text-ink">{local.url.split('/?')[0]}</span>
                </p>
              ) : null}
              {local.error ? (
                <p role="alert" className="text-[11px] text-danger-soft">
                  {local.error}
                </p>
              ) : null}
              <p className="text-[11px] leading-snug text-muted">
                Si Windows pregunta, permite el acceso en redes privadas. Si el WiFi aísla a los clientes (red de invitados), el
                QR no abrirá: usa la red principal.
              </p>
              {local.addresses.length > 1 ? (
                <label className="flex items-center gap-1.5 text-muted">
                  Red
                  <select
                    value={local.settings.address}
                    onChange={(e) => setLocal({ address: e.target.value })}
                    className="rounded border border-white/[0.06] bg-raised px-2 py-1 text-ink"
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
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-muted">
              Nombre del local
              <input
                value={venueName}
                maxLength={60}
                onChange={(e) => setVenueName(e.target.value)}
                onBlur={() => venueName !== local.settings.venueName && setLocal({ venueName })}
                placeholder="Se ve en el celular y en el QR"
                className={textInput}
              />
            </label>
            <label className="flex flex-col gap-1 text-muted">
              WiFi para clientes
              <input
                value={wifiName}
                maxLength={60}
                onChange={(e) => setWifiName(e.target.value)}
                onBlur={() => wifiName !== local.settings.wifiName && setLocal({ wifiName })}
                placeholder="Se imprime junto al QR"
                className={textInput}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={local.settings.qrOnScreen}
              onChange={(e) => setLocal({ qrOnScreen: e.target.checked })}
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
              disabled={!local.url || busy}
              onClick={async () => {
                setError(null);
                const res = await api?.printLocalRequestSheet(tables);
                if (res && !res.success) setError(res.error);
              }}
              title="Abre una hoja con un QR general y uno por mesa, lista para imprimir"
              className={controlBtn}
            >
              <Printer className="h-3 w-3" />
              Hoja de QR para imprimir
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Los QR impresos o mostrados dejarán de funcionar. ¿Generar un código nuevo?')) {
                  void run(() => api?.rotateLocalRequestKey());
                }
              }}
              title="Invalida los QR anteriores (por ejemplo, si alguien pide desde fuera)"
              className={`${controlBtn} hover:text-danger-soft`}
            >
              <RotateCcw className="h-3 w-3" />
              Cambiar QR
            </button>
          </div>
        </div>
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
