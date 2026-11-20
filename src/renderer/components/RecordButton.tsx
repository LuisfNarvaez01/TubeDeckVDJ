import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Circle, Square, FolderOpen, X } from 'lucide-react';
import type { MixRecordingKind } from '../audio/MixRecorder';

interface RecordButtonProps {
  recording: boolean;
  getElapsedSec: () => number;
  onStart: (kind: MixRecordingKind) => void;
  onStop: () => void;
  lastSavedPath: string | null;
  onReveal: (filePath: string) => void;
  onDismissSaved: () => void;
  error: string | null;
}

function formatClock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Top-bar mix recorder: pick audio or audio+video, then a live REC clock. */
export function RecordButton({
  recording,
  getElapsedSec,
  onStart,
  onStop,
  lastSavedPath,
  onReveal,
  onDismissSaved,
  error
}: RecordButtonProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsed(getElapsedSec()), 500);
    return () => window.clearInterval(t);
  }, [recording, getElapsedSec]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const savedName = lastSavedPath?.split(/[\\/]/).pop() ?? '';

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      {recording ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Detener grabación de la mezcla"
          title="Detener y guardar la grabación"
          className="inline-flex items-center gap-1.5 rounded border border-danger/60 bg-danger/15 px-2 py-1 font-semibold text-danger-soft cursor-pointer"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
          <span className="font-mono-tabular">REC {formatClock(elapsed)}</span>
          <Square className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Grabar la mezcla"
          className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-ground px-2 py-1 font-semibold text-ink-soft hover:text-ink cursor-pointer"
        >
          <Circle className="h-3 w-3 fill-danger text-danger" />
          Grabar
        </button>
      )}

      {menuOpen && !recording ? (
        <div
          role="menu"
          aria-label="Tipo de grabación"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-white/[0.1] bg-raised p-1 shadow-[0_16px_32px_-12px_rgba(0,0,0,0.9)]"
        >
          {(
            [
              ['audio', 'Solo audio', 'La mezcla del master, ideal para subir o escuchar.'],
              ['video', 'Audio + video', 'Lo que sale por Pantalla 2, con transiciones y marcos.']
            ] as const
          ).map(([kind, label, hint]) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setElapsed(0);
                onStart(kind);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-raised-2 cursor-pointer"
            >
              <span className="block text-xs font-semibold text-ink">{label}</span>
              <span className="block text-[11px] text-muted">{hint}</span>
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] text-faint">Se guarda en Música › TubeDeck Grabaciones</p>
        </div>
      ) : null}

      {!recording && (lastSavedPath || error) ? (
        <div
          role="status"
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
            error ? 'border-danger/50 text-danger-soft' : 'border-white/[0.1] text-ink-soft'
          }`}
        >
          <span className="max-w-48 truncate" title={error ?? lastSavedPath ?? undefined}>
            {error ? error : `Guardada: ${savedName}`}
          </span>
          {lastSavedPath && !error ? (
            <button
              type="button"
              onClick={() => onReveal(lastSavedPath)}
              aria-label="Mostrar la grabación en su carpeta"
              className="text-muted hover:text-ink cursor-pointer"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismissSaved}
            aria-label="Cerrar aviso de grabación"
            className="text-muted hover:text-ink cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
