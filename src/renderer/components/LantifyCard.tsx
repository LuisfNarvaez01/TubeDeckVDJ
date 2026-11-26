import { useState, type ReactElement } from 'react';
import { Link2, LoaderCircle, QrCode, Unlink } from 'lucide-react';
import type { LantifyPrefs } from '../../shared/types';
import { useLantifyStore } from '../store/useLantifyStore';

const controlBtn =
  'inline-flex items-center justify-center gap-1 rounded border border-white/[0.06] bg-raised px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink disabled:opacity-40 cursor-pointer';

/** Ajustes → Lantify: pairing with Lantify POS and how table requests are handled. */
export function LantifyCard(): ReactElement {
  const status = useLantifyStore((s) => s.status);
  const setStatus = useLantifyStore((s) => s.setStatus);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async (): Promise<void> => {
    if (!window.tubedeckAPI || busy) return;
    setBusy(true);
    setError(null);
    const res = await window.tubedeckAPI.lantifyPair(code);
    setBusy(false);
    if (res.success) {
      setStatus(res.data);
      setCode('');
    } else {
      setError(res.error);
    }
  };

  const unpair = async (): Promise<void> => {
    const res = await window.tubedeckAPI?.lantifyUnpair();
    if (res?.success) setStatus(res.data);
  };

  const setPref = async (patch: Partial<LantifyPrefs>): Promise<void> => {
    const res = await window.tubedeckAPI?.lantifySetPrefs(patch);
    if (res?.success) setStatus(res.data);
  };

  const prefs = status.prefs;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3">
      <h3 className="inline-flex items-center gap-1.5 font-semibold text-ink">
        <QrCode className="h-4 w-4 text-muted" />
        Lantify (pedidos desde las mesas)
      </h3>

      {status.paired ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-ink-soft">
            Vinculado a <span className="font-semibold text-ink">«{status.business?.name ?? 'tu negocio'}»</span>
            {status.connection === 'retrying' ? <span className="text-muted"> · sin conexión</span> : null}
          </p>
          <button type="button" onClick={() => void unpair()} className={`${controlBtn} hover:text-danger-soft`}>
            <Unlink className="h-3 w-3" />
            Desvincular
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void pair();
          }}
        >
          <p className="text-[11px] leading-snug text-muted">
            {status.connection === 'revoked'
              ? `Lantify desvinculó Proyecta${status.business ? ` de «${status.business.name}»` : ''}. Vincula de nuevo con un código nuevo.`
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
              className="min-w-0 flex-1 rounded border border-white/[0.08] bg-raised px-2 py-1 font-mono-tabular tracking-widest text-ink caret-deck-a placeholder:tracking-normal placeholder:text-faint focus:border-white/25 focus:outline-none"
            />
            <button type="submit" disabled={busy || code.replace(/[\s-]/g, '').length !== 8} className={controlBtn}>
              {busy ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Link2 className="h-3 w-3" />}
              {status.connection === 'revoked' ? 'Vincula de nuevo' : 'Vincular'}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-[11px] text-danger-soft">
              {error}
            </p>
          ) : null}
        </form>
      )}

      <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.autoApprove}
          onChange={(e) => void setPref({ autoApprove: e.target.checked })}
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
              if (n >= 1 && n <= 30) void setPref({ maxPerTable: n });
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
              if (n >= 1 && n <= 120) void setPref({ maxPerHour: n });
            }}
            className="rounded border border-white/[0.06] bg-raised px-2 py-1 font-mono-tabular text-ink"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.overlayEnabled}
          onChange={(e) => void setPref({ overlayEnabled: e.target.checked })}
          className="accent-ink-2"
        />
        Mostrar «Pedida por la mesa N» en Pantalla 2 (primeros 10 s)
      </label>
    </div>
  );
}
