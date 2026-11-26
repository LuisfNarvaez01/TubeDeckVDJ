import { useEffect, useState, type ReactElement } from 'react';
import { Check, Film, Inbox, LoaderCircle, QrCode, RefreshCw, Settings2, X } from 'lucide-react';
import type { LantifySongRequest } from '../../shared/types';
import { currentCandidate } from '../dj/LantifyRequestBridge';
import { useLantifyStore } from '../store/useLantifyStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { formatTrackDuration } from './SearchBrowserTab';

interface RequestsTabProps {
  onApprove: (req: LantifySongRequest) => void;
  onNextVersion: (req: LantifySongRequest) => void;
  onReject: (req: LantifySongRequest, reason: string) => void;
  /** "Ya está en la cola" / "Sonó hace menos de 1 h", or null. */
  conflictFor: (req: LantifySongRequest) => string | null;
  /** Requests approved for this table in the last hour. */
  tableCountFor: (table: string) => number;
  onToggleAutoApprove: (enabled: boolean) => void;
  onOpenSettings: () => void;
}

const controlBtn =
  'inline-flex items-center justify-center gap-1 rounded-md border border-white/[0.06] bg-raised px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:bg-raised-2 hover:text-ink active:scale-[0.97] disabled:opacity-40 cursor-pointer';

const REJECT_LABELS: Record<string, string> = {
  NO_MATCH: 'No se encontró una canción válida',
  ALREADY_PLAYED: 'Ya sonó o ya estaba en la cola',
  DJ_DECLINED: 'Rechazada por el DJ'
};

function agoText(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

function tableLabel(table: string): string {
  return /^\d+$/.test(table) ? `Mesa ${table}` : table;
}

/** "Pedidos" column: guests' song requests from the table QR, one card each. */
export function RequestsTab({
  onApprove,
  onNextVersion,
  onReject,
  conflictFor,
  tableCountFor,
  onToggleAutoApprove,
  onOpenSettings
}: RequestsTabProps): ReactElement {
  const status = useLantifyStore((s) => s.status);
  const requests = useLantifyStore((s) => s.requests);
  const note = useLantifyStore((s) => s.note);
  // Re-render when the queue changes: the "ya está en la cola" hints depend on it.
  useLibraryStore((s) => s.queue);
  const [now, setNow] = useState(() => Date.now());
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const open = requests.filter((r) => r.state === 'pending' || r.state === 'searching');
  const handled = requests
    .filter((r) => r.state !== 'pending' && r.state !== 'searching')
    .slice(-12)
    .reverse();

  if (!status.paired) {
    return (
      <div className="flex h-full min-h-0 flex-col items-start gap-2 rounded-lg bg-surface p-3">
        <QrCode className="h-5 w-5 text-muted" aria-hidden="true" />
        <p className="text-xs font-medium text-ink">
          {status.connection === 'revoked' ? 'Lantify desvinculó Proyecta' : 'Pedidos desde el QR de las mesas'}
        </p>
        <p className="text-[11px] leading-snug text-muted">
          {status.connection === 'revoked'
            ? 'Vincula de nuevo con un código nuevo de Lantify → Mi página → Pedir canciones.'
            : 'Vincula Lantify POS para que los clientes pidan canciones y tú las apruebes aquí.'}
        </p>
        <button type="button" onClick={onOpenSettings} className={controlBtn}>
          <Settings2 className="h-3 w-3" />
          {status.connection === 'revoked' ? 'Vincula de nuevo' : 'Vincular en Ajustes'}
        </button>
      </div>
    );
  }

  const runBusy = async (id: string, fn: () => void | Promise<void>): Promise<void> => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-muted">
          {status.business?.name ?? 'Lantify'}
          {status.connection === 'retrying' ? (
            <span className="text-ink-soft">
              {' '}
              · sin conexión, reintenta en {Math.round(status.pollDelayMs / 1000)} s
            </span>
          ) : (
            <span className="text-faint"> · conectado</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => onToggleAutoApprove(!status.prefs.autoApprove)}
          aria-pressed={status.prefs.autoApprove}
          title={`Aprueba solo los pedidos que pasan los filtros, hasta ${status.prefs.maxPerHour} por hora y ${status.prefs.maxPerTable} por mesa`}
          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
            status.prefs.autoApprove
              ? 'border-live/50 bg-live/12 text-live'
              : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
          }`}
        >
          <Check className="h-3 w-3" />
          Aprobar automáticamente
        </button>
      </div>

      {note ? (
        <p role="status" className="truncate text-[11px] text-ink-soft">
          {note}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {open.length === 0 ? (
          <div className="flex flex-col items-start gap-1 rounded-lg bg-surface p-3">
            <Inbox className="h-4 w-4 text-faint" aria-hidden="true" />
            <p className="text-[11px] text-muted">Sin pedidos por ahora. Llegan solos desde el QR de cada mesa.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label="Pedidos por aprobar">
            {open.map((req) => {
              const cand = currentCandidate(req);
              const conflict = req.state === 'pending' ? conflictFor(req) : null;
              const tableCount = tableCountFor(req.table);
              const isRejecting = rejecting === req.id;
              const isBusy = busy === req.id;
              return (
                <li key={req.id} className="rounded-lg border border-white/[0.06] bg-surface p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-xs">
                      <span className="font-semibold text-ink">{tableLabel(req.table)}</span>
                      {req.guest ? <span className="text-muted"> · {req.guest}</span> : null}
                    </p>
                    <span className="shrink-0 font-mono-tabular text-[10px] text-faint">
                      {agoText(req.receivedAtMs, now)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-soft" title={req.query}>
                    Pidió: <span className="text-ink">{req.query}</span>
                  </p>

                  {req.state === 'searching' || !cand ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                      Buscando en YouTube…
                    </p>
                  ) : (
                    <div className="mt-1.5 flex gap-2">
                      <div className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded bg-raised">
                        {cand.thumbnailUrl ? (
                          <img src={cand.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Film className="h-4 w-4 text-muted" />
                          </div>
                        )}
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 font-mono-tabular text-[10px] text-ink">
                          {formatTrackDuration(cand.durationSec)}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="line-clamp-2 text-xs font-medium leading-snug text-ink" title={cand.title}>
                          {cand.title}
                        </p>
                        <p className="truncate text-[11px] text-muted">{cand.channel}</p>
                        {req.candidates.length > 1 ? (
                          <p className="font-mono-tabular text-[10px] text-faint">
                            Versión {req.candidateIndex + 1} de {req.candidates.length}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {conflict ? <p className="mt-1 text-[10px] font-semibold text-ink-soft">{conflict}</p> : null}
                  {tableCount >= status.prefs.maxPerTable ? (
                    <p className="mt-1 text-[10px] text-faint">
                      {tableLabel(req.table)} ya tiene {tableCount} aprobadas esta hora
                    </p>
                  ) : null}

                  {isRejecting ? (
                    <form
                      className="mt-1.5 flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const text = reason;
                        setRejecting(null);
                        setReason('');
                        void runBusy(req.id, () => onReject(req, text));
                      }}
                    >
                      <input
                        autoFocus
                        value={reason}
                        maxLength={80}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRejecting(null);
                        }}
                        placeholder="Motivo (opcional)"
                        aria-label="Motivo del rechazo (opcional)"
                        className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-ground px-2 py-1 text-[11px] text-ink caret-deck-a placeholder:text-faint focus:border-white/25 focus:outline-none"
                      />
                      <button type="submit" className={`${controlBtn} hover:text-danger-soft`}>
                        Rechazar
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(null)}
                        aria-label="Cancelar rechazo"
                        className={controlBtn}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </form>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!cand || req.state !== 'pending' || isBusy}
                        onClick={() => void runBusy(req.id, () => onApprove(req))}
                        className="inline-flex items-center justify-center gap-1 rounded-md bg-live px-2.5 py-1 text-[11px] font-semibold text-ground transition-transform duration-150 hover:bg-ink active:scale-[0.97] disabled:opacity-40 cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                        Aprobar
                      </button>
                      <button
                        type="button"
                        disabled={req.candidates.length < 2 || isBusy}
                        onClick={() => void runBusy(req.id, () => onNextVersion(req))}
                        title="Mostrar el siguiente resultado de YouTube"
                        className={controlBtn}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Otra versión
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setReason('');
                          setRejecting(req.id);
                        }}
                        className={`${controlBtn} ml-auto hover:text-danger-soft`}
                      >
                        <X className="h-3 w-3" />
                        Rechazar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {handled.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Atendidos</p>
            <ul className="flex flex-col">
              {handled.map((req) => (
                <li key={req.id} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                  <span className="w-14 shrink-0 truncate text-ink-soft">{tableLabel(req.table)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title={req.query}>
                    {req.query}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] ${
                      req.state === 'playing' ? 'font-semibold text-live' : 'text-faint'
                    }`}
                    title={req.state === 'rejected' ? (REJECT_LABELS[req.rejectReason ?? ''] ?? req.rejectReason) : undefined}
                  >
                    {req.state === 'queued'
                      ? 'En cola'
                      : req.state === 'playing'
                        ? 'Sonando'
                        : req.state === 'played'
                          ? 'Sonó'
                          : 'Rechazado'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
