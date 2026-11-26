import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Bot, Headphones, MessageSquare, Send, UserRoundX, X } from 'lucide-react';
import type { ChatMessage } from '../../shared/types';
import { useSongRequestStore } from '../store/useSongRequestStore';

const SEEN_KEY = 'proyecta.chatSeen';
const TOAST_MS = 7000;
const QUICK = ['Listo', 'Va en la siguiente', 'En 2 canciones', 'Ahora no se puede'];

const readSeen = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (id: string): void => {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    // sin almacenamiento: el contador vuelve a mostrarse al abrir
  }
};

const time = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * Messages with the register (Lantify POS) from anywhere in Proyecta: header button with
 * the unread count, a short notice when the POS writes, and the panel with the
 * conversation, quick replies and the booth switch ("DJ en cabina"). Without a DJ in the
 * booth, the POS decides pending requests (or its autopilot does).
 */
export function MessagesCenter(): ReactElement | null {
  const snapshot = useSongRequestStore((s) => s.snapshot);
  const setSnapshot = useSongRequestStore((s) => s.setSnapshot);
  const { mode, cloud, chat, desk } = snapshot;
  const linked = mode === 'cloud' && Boolean(cloud.business);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(readSeen);
  const [toast, setToast] = useState<ChatMessage | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const lastToastId = useRef<string | null>(null);
  const loaded = useRef(false);

  const unread = useMemo(() => {
    const i = seen ? chat.findIndex((m) => m.id === seen) : -1;
    return chat.slice(i + 1).filter((m) => m.from === 'pos').length;
  }, [chat, seen]);

  // New message from the POS: short notice while the panel is closed
  useEffect(() => {
    const last = [...chat].reverse().find((m) => m.from === 'pos');
    if (!loaded.current) {
      loaded.current = true;
      lastToastId.current = last?.id ?? null;
      return;
    }
    if (!last || last.id === lastToastId.current) return;
    lastToastId.current = last.id;
    if (open) return;
    setToast(last);
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [chat, open]);

  // Opened: everything counts as read and the list goes to the end
  useEffect(() => {
    if (!open) return;
    const last = chat[chat.length - 1];
    if (last) {
      writeSeen(last.id);
      setSeen(last.id);
    }
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [open, chat]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!linked) return null;

  const online = cloud.connection === 'online';

  const send = async (raw: string): Promise<void> => {
    const clean = raw.trim();
    if (!clean || sending) return;
    setSending(true);
    const res = await window.tubedeckAPI.sendRequestChat(clean);
    setSending(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setError(null);
    setText('');
    setSnapshot(res.data);
  };

  const setPresent = async (present: boolean): Promise<void> => {
    const res = await window.tubedeckAPI.setDjPresent(present);
    if (res.success) setSnapshot(res.data);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setToast(null);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={unread ? `Mensajes de la caja: ${unread} nuevos` : 'Mensajes de la caja'}
        title={`Mensajes con la caja de ${cloud.business?.name ?? 'Lantify POS'}`}
        className={`relative inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-semibold cursor-pointer ${
          open ? 'border-deck-a/50 bg-deck-a/10 text-ink' : 'border-white/[0.06] bg-ground text-muted hover:text-ink'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">Mensajes</span>
        {!desk.djPresent ? (
          <span className="rounded bg-deck-b/15 px-1 text-[10px] font-bold text-deck-b" title="Sin DJ en cabina: la caja decide los pedidos">
            SIN DJ
          </span>
        ) : null}
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[17px] rounded-full bg-deck-b px-1 text-center font-mono-tabular text-[10px] font-bold leading-[17px] text-ground">
            {unread}
          </span>
        ) : null}
      </button>

      {toast && !open ? (
        <button
          type="button"
          onClick={() => {
            setToast(null);
            setOpen(true);
          }}
          className="animate-drawer-in fixed right-3 top-14 z-[60] flex w-80 items-start gap-2.5 rounded-xl border border-white/[0.08] bg-raised p-3 text-left shadow-2xl cursor-pointer"
          
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-deck-b/15 text-deck-b">
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-muted">{toast.author} · caja</span>
            <span className="mt-0.5 line-clamp-3 block text-[13px] leading-snug text-ink">{toast.text}</span>
          </span>
        </button>
      ) : null}

      {open ? (
        <section
          role="dialog"
          aria-label="Mensajes con la caja"
          className="animate-drawer-in fixed right-3 top-14 z-[60] flex h-[min(600px,calc(100vh-5rem))] w-[380px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-surface shadow-2xl"
          
        >
          <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-ink">{cloud.business?.name ?? 'Lantify POS'}</p>
              <p className="text-[11px] text-muted">{online ? 'Caja conectada' : 'Sin conexión con Lantify'}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar mensajes"
              className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* La cabina: con DJ, decide Proyecta; sin DJ, la caja (o su piloto automático) */}
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-ground p-1" role="radiogroup" aria-label="¿Hay DJ en cabina?">
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
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold cursor-pointer ${
                    desk.djPresent === v ? (v ? 'bg-deck-a/15 text-deck-a' : 'bg-deck-b/15 text-deck-b') : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              {desk.djPresent ? (
                'Tú decides los pedidos. La caja no recibe avisos, solo tus mensajes.'
              ) : desk.autopilot.enabled ? (
                <>
                  <Bot className="mr-1 inline h-3 w-3 align-[-2px] text-deck-b" />
                  Piloto automático de la caja: aprueba hasta {desk.autopilot.maxPerHour} por hora y {desk.autopilot.maxPerTable} por mesa; lo demás lo decide la caja.
                </>
              ) : (
                'La caja aprueba o rechaza los pedidos desde Lantify POS.'
              )}
            </p>
          </div>

          <ul ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {chat.length === 0 ? (
              <li className="m-auto max-w-[26ch] text-center text-[12px] leading-snug text-muted">
                Aún no hay mensajes. Aquí hablas con la caja: cumpleaños, volumen, una canción especial.
              </li>
            ) : (
              chat.map((m) => (
                <li key={m.id} className={`flex flex-col ${m.from === 'dj' ? 'items-end' : 'items-start'}`}>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                      m.from === 'dj' ? 'rounded-br-md bg-deck-a/15 text-ink' : 'rounded-bl-md bg-raised-2 text-ink'
                    }`}
                  >
                    {m.text}
                  </p>
                  <span className="mt-0.5 font-mono-tabular text-[10px] text-faint">
                    {m.from === 'dj' ? 'Tú' : m.author} · {time(m.at)}
                  </span>
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-white/[0.06] px-3 py-2.5">
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={!online || sending}
                  onClick={() => void send(q)}
                  className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-ink-soft hover:border-white/20 hover:text-ink disabled:opacity-40 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <input
                value={text}
                maxLength={280}
                onChange={(e) => setText(e.target.value)}
                placeholder={online ? 'Mensaje para la caja' : 'Sin conexión con Lantify'}
                aria-label="Mensaje para la caja"
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-ground px-3 text-[13px] text-ink placeholder:text-faint focus:border-deck-a/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!text.trim() || !online || sending}
                aria-label="Enviar mensaje"
                className="grid h-9 w-9 place-items-center rounded-lg bg-deck-a text-ground disabled:opacity-40 cursor-pointer"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            {error ? (
              <p role="alert" className="mt-1.5 text-[11px] text-danger-soft">
                {error}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
