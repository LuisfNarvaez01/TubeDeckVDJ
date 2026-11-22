import { useEffect, useState, type ReactElement } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import type { MediaCacheSettings, MediaCacheUsage } from '../../shared/types';

const SIZES_GB = [2, 5, 10, 20];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Settings card for the disk cache of YouTube songs (instant reloads, offline backup). */
export function MediaCacheCard(): ReactElement {
  const [usage, setUsage] = useState<MediaCacheUsage | null>(null);
  const [settings, setSettings] = useState<MediaCacheSettings>({ maxGb: 5, saveVideo: true });
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const api = window.tubedeckAPI;
    const refresh = (): void => {
      void api?.getMediaCacheUsage?.().then((res) => res?.success && setUsage(res.data));
    };
    refresh();
    void api?.getMediaCacheSettings?.().then((res) => res?.success && res.data && setSettings(res.data));
    return api?.onMediaCacheChanged?.(refresh);
  }, []);

  const apply = (next: MediaCacheSettings): void => {
    setSettings(next);
    void window.tubedeckAPI?.configureMediaCache?.(next).then((res) => res?.success && setUsage(res.data));
  };

  const pct = usage && usage.maxBytes > 0 ? Math.min(100, (usage.bytes / usage.maxBytes) * 100) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-ground p-3 text-[11px]">
      <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
        <HardDrive className="h-4 w-4 text-muted" />
        Canciones guardadas
      </h3>
      <p className="text-muted">
        Las canciones de YouTube que suenan se guardan en este PC: la próxima vez cargan al instante y el
        automix las usa si se va el internet.
      </p>
      <div className="flex items-center justify-between font-mono-tabular text-ink-soft">
        <span>
          {usage ? `${usage.songs} canciones (${usage.withVideo} con video)` : '—'}
        </span>
        <span>
          {usage ? `${formatBytes(usage.bytes)} de ${formatBytes(usage.maxBytes)}` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden>
        <div className="h-full bg-live" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-muted">
          Espacio máximo
          <select
            value={settings.maxGb}
            onChange={(e) => apply({ ...settings, maxGb: Number(e.target.value) })}
            className="rounded border border-white/[0.06] bg-raised px-1.5 py-0.5 text-ink cursor-pointer"
          >
            {SIZES_GB.map((gb) => (
              <option key={gb} value={gb}>
                {gb} GB
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={settings.saveVideo}
            onChange={(e) => apply({ ...settings, saveVideo: e.target.checked })}
            className="accent-[var(--color-live)]"
          />
          Guardar también el video
        </label>
        {confirmClear ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-danger-soft">¿Borrar todas?</span>
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                void window.tubedeckAPI?.clearMediaCache?.().then((res) => res?.success && setUsage(res.data));
              }}
              className="rounded border border-danger/50 bg-danger/15 px-2 py-0.5 font-semibold text-danger-soft cursor-pointer"
            >
              Sí, borrar
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded border border-white/[0.1] bg-raised px-2 py-0.5 text-ink-soft cursor-pointer"
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={!usage || usage.songs === 0}
            className="ml-auto inline-flex items-center gap-1 rounded border border-white/[0.1] bg-raised px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
            Liberar espacio
          </button>
        )}
      </div>
    </div>
  );
}
