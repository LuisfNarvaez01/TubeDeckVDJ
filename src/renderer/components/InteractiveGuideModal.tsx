import { useEffect, useState, type ReactElement } from 'react';
import { X, Disc3, Sliders, Tv, ListMusic, Keyboard } from 'lucide-react';

interface InteractiveGuideModalProps {
  open: boolean;
  onClose: () => void;
}

type GuideCategory = 'decks' | 'mixer' | 'video' | 'queue' | 'shortcuts';

const CATEGORIES: Array<{ id: GuideCategory; label: string; icon: typeof Disc3 }> = [
  { id: 'decks', label: 'Decks & Jog', icon: Disc3 },
  { id: 'mixer', label: 'Mixer & Automix', icon: Sliders },
  { id: 'video', label: 'Video & Marcos', icon: Tv },
  { id: 'queue', label: 'Cola, Radio & Local', icon: ListMusic },
  { id: 'shortcuts', label: 'Atajos & MIDI', icon: Keyboard }
];

const GUIDE_ITEMS: Record<GuideCategory, Array<{ control: string; detail: string }>> = {
  decks: [
    {
      control: 'Play / Pausa, CUE Real y Edición OSD',
      detail:
        'Play alterna reproducción. Con la canción en pausa, clic en CUE guarda el punto CUE actual; mantener CUE preescucha y regresa al soltar. Haz doble clic sobre el título del Deck para editar manualmente cómo sale en Pantalla 2.'
    },
    {
      control: 'Jog Wheel, Nudge -/+ y Key Shift',
      detail:
        'En reproducción, arrastrar el plato o usar N-/N+ hace pitch bend momentáneo; en pausa busca punto exacto (scrub). Junto a Key (Master Tempo) puedes ajustar Key Shift de -6 a +6 semitonos para karaoke.'
    },
    {
      control: 'Módulo FX & Sampler y Pads (44px)',
      detail:
        'Cada Deck cuenta con rack dedicado a los costados del Mixer (ECHO, REVERB, FLANGER con división 1/4–1/1 y Sampler directo), además de pads HOT CUE, ROLL, JUMP, SAMPLER y FX.'
    },
    {
      control: 'Onda RGB, Buffer RAM, TAP y SYNC',
      detail:
        'La cabecera indica la resolución activa y barra de buffer RAM precargado. SYNC ajusta el BPM al otro deck; TAP permite marcar el tempo manualmente.'
    }
  ],
  mixer: [
    {
      control: 'AUTO MIX A⇄B',
      detail:
        'Realiza una transición suave y automática de audio y video entre Deck A y Deck B sin saltos bruscos, pausando el deck saliente al terminar. Si tocas el crossfader manualmente, tomas el control al instante.'
    },
    {
      control: 'Ecualizador HI / MID / LOW, KILL y Color Filter',
      detail:
        'Recorta o realza frecuencias por banda (-26 a +12 dB). KILL silencia esa banda al instante. FILTER hacia la izquierda aplica filtro paso bajo (graves) y hacia la derecha paso alto (agudos). Doble clic en cualquier perilla la reinicia.'
    },
    {
      control: 'AutoGain y PFL (Audífonos)',
      detail:
        'AutoGain nivela automáticamente diferencias de volumen entre videos de YouTube y archivos locales. Activa PFL en un deck y ajusta CUE VOL / CUE-MST para preescuchar antes de sacarlo al público.'
    },
    {
      control: 'Enlace A+V y Curvas de Crossfader',
      detail:
        'A+V sincroniza el crossfader de audio con la transición de video. Puedes elegir curva Equal-Power (suave para mezclas), Linear o Scratch (corte rápido en los extremos).'
    }
  ],
  video: [
    {
      control: 'Calidad Adaptativa Anti-Cortes',
      detail:
        'Por defecto usa 720p H.264 fluido en fragmentos de 2 MB y reduce automáticamente a 480p/360p si detecta internet lento, sin detener jamás el sonido. Puedes fijar calidad manual desde la barra superior.'
    },
    {
      control: 'Marcos de Video (Frames)',
      detail:
        'Desde "Marcos" activa marcos de estudio, Karaoke, Gala o Club LED, o sube un PNG transparente propio. El video se escala automáticamente para reproducirse completo dentro del marco sin tapar letras.'
    },
    {
      control: 'Pantalla 2 (Abrir P2) y Transiciones',
      detail:
        'Envía el video Master (con transiciones shader, Video FX, marco, logo y marquesina) sin barras de navegación a tu televisor, proyector o segunda pantalla en 60 fps.'
    },
    {
      control: 'OSD Pista, Logo, Marquesina y Webcam PiP',
      detail:
        'Muestra el título entrante en pantalla por 6s, fija tu logo en una esquina, corre texto en marquesina para avisos o eventos y superpone cámara en vivo PiP.'
    }
  ],
  queue: [
    {
      control: 'Precarga Inmediata y Cola Inteligente',
      detail:
        'Con Precarga "Inmediata", el siguiente tema comienza a almacenarse en el deck libre 4s después de iniciar la canción actual (ideal para conexiones lentas). En la barra superior siempre ves qué canción sigue.'
    },
    {
      control: 'Mover a Siguiente, Arrastrar y Vaciar Cola',
      detail:
        'Usa el botón "Siguiente" para poner cualquier tema de inmediato como próximo a sonar, arrastra filas con el ícono izquierdo para reordenar o limpia toda la cola en un clic.'
    },
    {
      control: 'Radio YT Basada en Historial',
      detail:
        'Cuando se vacía tu cola y Radio YT está activa, analiza la última canción reproducida (~70%) y tus canales/géneros frecuentes del historial (~30%) para encolar y mezclar sugerencias sin repetir canciones recientes.'
    },
    {
      control: 'Biblioteca Local, Intercalado y Descarga por Lotes',
      detail:
        'Agrega archivos o carpetas completas de tu PC en MP4/MP3/etc. Usa "Intercalar Local/YT" en la Cola para alternarlos. En Historial puedes descargar una sesión completa en MP4/M4A para uso sin internet.'
    }
  ],
  shortcuts: [
    {
      control: 'Teclado de Cabina & Botón KEYS',
      detail:
        'Activa KEYS en la barra superior para ver las teclas superpuestas sobre cada control. Space/Shift+Space: Play A/B • Q/W: Cue A/B • S/Shift+S: Sync A/B • 1..8: Hot Cues • Flechas y C: Crossfader • V: Auto Transición.'
    },
    {
      control: 'Pre-escucha CUE desde Navegador',
      detail:
        'Haz clic en el botón de audífonos sobre cualquier canción en Buscador o Biblioteca Local para preescucharla solo por tus audífonos sin detener ni cargar los Decks en vivo.'
    },
    {
      control: 'Controladores MIDI USB (MIDI Learn)',
      detail:
        'Conecta tu controlador Pioneer, Numark o Hercules antes o durante la sesión. Abre Ajustes arriba a la derecha, pulsa "Escanear MIDI" y usa "Learn" para mapear faders, crossfader y Play.'
    },
    {
      control: 'Actualizaciones Automáticas',
      detail:
        'En Ajustes -> Actualizaciones puedes verificar y descargar nuevas versiones directo desde GitHub Releases sin reinstalar manualmente.'
    }
  ]
};

export function InteractiveGuideModal({ open, onClose }: InteractiveGuideModalProps): ReactElement | null {
  const [category, setCategory] = useState<GuideCategory>('decks');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Guía de Cabina"
      onClick={onClose}
    >
      <div
        className="animate-modal-in flex max-h-[84vh] w-full max-w-3xl flex-col gap-3 rounded-xl border border-white/[0.08] bg-surface p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h2 className="text-base font-bold text-ink">Guía Rápida de Cabina — TubeDeck VDJ</h2>
            <p className="text-xs text-muted">
              Referencia de controles, mezcla automática de audio/video, marcos y reproducción híbrida.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar Guía"
            className="rounded-lg border border-white/[0.06] bg-raised p-1.5 text-muted hover:text-ink cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategory(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                category === id
                  ? 'border-white/25 bg-raised-2 text-ink'
                  : 'border-white/[0.06] bg-raised text-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 gap-2.5 pr-1 sm:grid-cols-2">
          {GUIDE_ITEMS[category].map((item) => (
            <div
              key={item.control}
              className="flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-ground p-3"
            >
              <h3 className="text-xs font-bold text-ink">{item.control}</h3>
              <p className="text-xs leading-relaxed text-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

