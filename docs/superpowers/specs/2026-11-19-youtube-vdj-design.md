# Especificación de Diseño: TubeDeck VDJ (VirtualDJ de Video con YouTube)

**Fecha:** 2026-11-19
**Plataforma objetivo:** Windows 10/11 (extensible a macOS y Linux)
**Estado:** Borrador para aprobación del usuario antes de iniciar implementación

---

## 1. Intención y Visión

**TubeDeck VDJ** es una aplicación de escritorio diseñada para replicar la experiencia de mezcla audiovisual de **VirtualDJ Video** utilizando videos directamente desde YouTube por streaming en tiempo real, **sin descargar ni almacenar archivos multimedia en el disco** y con un **buscador integrado propio que no requiere API Key**.

Está pensada para DJs de eventos, bares, fiestas privadas o sesiones en casa que conectan una laptop a un televisor, proyector o pantalla LED por HDMI (Pantalla 2): el público ve una salida Master limpia a pantalla completa con transiciones de video, efectos y overlays, mientras el DJ opera la cabina completa en la pantalla principal (Pantalla 1) con ecualizador real, pre-escucha en audífonos, cola Automix, controles DJ clásicos, soporte MIDI e historial de sesiones.

---

## 2. Objetivos, No-Objetivos y Anti-Objetivos

### Objetivos
- **Doble pantalla real (Cabina + Salida Master):** Cabina de control en Pantalla 1 con previews en vivo de Deck A, Deck B y Master; Salida Master limpia en Pantalla 2 (fullscreen sin bordes, sin UI de YouTube ni anuncios).
- **Motor de Audio DSP real por deck:** Ecualizador de 3 bandas (`Low`, `Mid`, `High`) con botones `Kill`, `Color Filter` bipolar (`LPF`/`HPF`), `Trim/Gain`, medidores VU LED, `Channel Faders`, `Crossfader` con curvas seleccionables y `Limiter` en Master.
- **Pre-escucha en audífonos (Cue / PFL):** Ruteo independiente de Master y Audífonos hacia dispositivos de audio distintos (`setSinkId`), control `Cue/Master Blend` y modo `Mono Split` para adaptadores DJ de una sola salida estéreo.
- **Motor de Video WebGL2 (60 fps):** `Video Crossfader` con los 3 modos de VirtualDJ (`linked`, `independent`, `auto-timed`), 7 transiciones GLSL, 7 Video FX acelerados por GPU (incluyendo Strobe por BPM y shaders audio-reactivos) y capa de Overlays (logo, texto/marquesina, título automático OSD y Webcam PiP).
- **Streaming 100% en memoria RAM:** Proxy HTTP local aislado en `127.0.0.1` que sirve fragmentos HTTP `Range` (`206 Partial Content`) directo a elementos `<audio>`/`<video>` locales sin escribir archivos multimedia en disco.
- **Controles DJ completos:** 8 Hot Cues por deck, Loops manuales (`In`/`Out`/`Exit`) y Auto-Loop por beats, Pitch/Tempo (`±8%`, `±16%`, `±50%`) con `Key Lock`, detección automática de BPM + `Tap BPM` + `Sync` y Waveforms interactivos.
- **Buscador, Cola y Automix inteligente:** Buscador integrado de YouTube e importador de playlists, cola "Up Next" reordenable y modo Automix con pre-resolución/pre-buffering 30s antes del final de pista y salto automático ante errores.
- **Historial de Mixes, Crates y Controladores:** Registro automático de sesiones en SQLite local, recarga de mixes anteriores a la cola, organización en Crates, exportación en `JSON`, `CSV` y `M3U`, atajos de teclado configurables y soporte USB MIDI (`Web MIDI API` con `MIDI Learn`).

### No-Objetivos (fuera de alcance en v1)
- Descarga o conversión de videos/audios de YouTube a archivos locales MP3/MP4.
- Más de 2 decks simultáneos (v1 implementa Decks A y B).
- Separación de stems (voces/batería/bajo) por IA en tiempo real.
- Sincronización en la nube, cuentas de usuario o versión móvil.

### Anti-Objetivos (fallos críticos inaceptables)
- Cortes o silencios de audio en la pista Master cuando se conecta o desconecta el cable HDMI de la Pantalla 2.
- Desincronización perceptible (`> 40 ms`) entre audio y video tras un `Hot Cue`, `Loop` o `Seek` en streams DASH separados.
- Pausas de silencio durante Automix por buffering tardío o bloqueo ante un video restringido.
- Filtración de botones, títulos, marcas de agua o anuncios de YouTube en la pantalla del público.
- Caídas de fluidez (`< 60 fps`) en la cabina o en la salida externa durante transiciones o con los VU meters activos.

---

## 3. Restricciones Globales

1. **Sistema operativo principal:** Windows 10/11 (x64), con arquitectura portable a macOS/Linux.
2. **Stack tecnológico:** Node.js 20+, Electron 34+, Vite + `electron-vite`, React 19, TypeScript 5 (`strict: true`), Tailwind CSS v4, Zustand, `sql.js` (SQLite WASM), `youtubei.js`, binario `yt-dlp` gestionado en `app.getPath('userData')/bin/`.
3. **Cero archivos multimedia en disco:** Prohibido escribir archivos `.mp4`, `.webm`, `.m4a`, `.mp3` o cachés temporales de media en disco. Todo stream de audio/video fluye por RAM vía `RamStreamProxy`. SQLite (`tubedeck.db` en `userData`) guarda únicamente metadatos, cues, waveform overview JSON, BPM, historial, crates, perfiles MIDI y preferencias.
4. **Aislamiento de red local:** El proxy local debe escuchar exclusivamente en `127.0.0.1` usando puerto efímero (`:0`) y validar un `token` aleatorio generado al arrancar la app en cada solicitud HTTP. Nunca escuchar en `0.0.0.0`.
5. **Seguridad Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en ventanas renderer, `webSecurity: true`, CSP estricta (`default-src 'self'`), validación de entradas IPC y retorno estandarizado `{ success: true, data } | { success: false, error }` a través de `contextBridge`.
6. **Rendimiento UI 60 fps:** Los medidores VU, playhead de waveforms, análisis FFT y renderizado WebGL2 operan sobre `requestAnimationFrame` y refs/canvas directos sin disparar re-renders de React a 60 Hz.

---

## 4. Arquitectura Técnica

```text
+-----------------------------------------------------------------------------------+
|                            ELECTRON MAIN PROCESS (Node.js)                        |
|  - YouTubeSearchService (youtubei.js)     - StreamResolverService (yt-dlp + TTL)  |
|  - RamStreamProxy (127.0.0.1:0 + token)   - DisplayWindowManager (electron.screen)|
|  - DatabaseService (sql.js WASM)          - Typed IPC Handlers + Binary Manager   |
+------------------------------------+----------------------------------------------+
                                     | contextBridge (Result<T> + StreamURLs)
+------------------------------------v----------------------------------------------+
|                        RENDERER 1: CABINA PRINCIPAL (React 19)                    |
|  +-----------------------------+     +-----------------------------------------+  |
|  | DualDeckMediaSync (A & B)   |     | WebGLVideoCompositor + VideoFxPipeline  |  |
|  | - Muxed o DASH A/V sync     |---->| + OverlayCompositor (60fps Master FBO)  |  |
|  +--------------+--------------+     +--------------------+--------------------+  |
|                 |                                         | masterCanvas          |
|                 v                                         | .captureStream(60)    |
|  +-----------------------------+                          |                       |
|  | AudioDspEngine (Web Audio)  |                          v                       |
|  | - Single AudioContext       |     +-----------------------------------------+  |
|  | - Trim, 3-Band EQ+Kill, LPF |     | RENDERER 2: PANTALLA EXTERNA (Monitor 2)|  |
|  | - Crossfader + Limiter      |     | - window.open() interceptada por Main   |  |
|  | - AudioOutputRouter         |     | - <video srcObject={stream} muted>      |  |
|  |   (Master + Cue + MonoSplit)|     | - Fullscreen borderless limpia          |  |
|  +-----------------------------+     +-----------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 4.1 Proceso Principal (Electron Main)

#### `YouTubeSearchService`
- Usa `youtubei.js` (Innertube) para búsquedas sin API key de YouTube.
- Soporta: búsqueda paginada por texto, autocompletado de sugerencias, carga de playlists públicas por URL/ID y obtención de videos relacionados para sugerencias de cola.
- Filtra livestreams activos o entradas sin duración válida y normaliza cada resultado al tipo `YouTubeTrack` (`videoId`, `title`, `channel`, `durationSec`, `thumbnailUrl`, `isLive`).

#### `StreamResolverService`
- Gestiona el binario `yt-dlp` en `userData/bin/yt-dlp.exe` (detectando si ya existe o descargándolo bajo demanda con verificación de estado) y usa `youtubei.js` como fallback secundario.
- Resuelve URLs directas de streaming para un `videoId` priorizando formato **muxed MP4** (`<= 1080p`, `<= 60fps`) para menor latencia; si no existe muxed en calidad óptima, resuelve **adaptive DASH** (`videoUrl` MP4/WebM `<= 1080p` + `audioUrl` M4A/Opus).
- Mantiene una **caché en memoria** indexada por `videoId` que lee el parámetro `expire` de la URL firmada de `googlevideo.com` para invalidar entradas caducadas automáticamente y soporta `invalidateAndResolve(videoId)` cuando `RamStreamProxy` detecta `HTTP 403`.

#### `RamStreamProxy`
- Servidor HTTP (`http.createServer`) enlazado estrictamente a `127.0.0.1`, puerto `0`.
- Expone `GET /stream/:videoId/:role?token=<sessionToken>` (`role` = `muxed | video | audio`).
- Rechaza con `401 Unauthorized` cualquier petición sin el `token` válido de la sesión actual.
- Reenvía la cabecera `Range` del elemento `<video>`/`<audio>` del navegador hacia el CDN remoto y responde `206 Partial Content` con `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, `Content-Type` y `Access-Control-Allow-Origin: *` (habilitando `AudioContext.createMediaElementSource` y texturas WebGL2 sin tainting CORS).
- Transfiere el flujo mediante pipes de memoria (`Readable` + `AbortController` por request). Si el usuario cambia de canción o hace seek rápido, aborta la conexión saliente previa de inmediato.
- Ante respuesta `403` o `410` del CDN remoto, solicita una única re-resolución fresca a `StreamResolverService` y reintenta transparente antes de fallar.

#### `DisplayWindowManager`
- Envuelve `electron.screen` para listar monitores (`id`, `label`, `bounds`, `isPrimary`, `scaleFactor`).
- Intercepta `window.open(..., 'tubedeck-output')` en `mainWindow.webContents.setWindowOpenHandler` para crear la ventana hija con `frame: false`, `backgroundColor: '#000000'`, `autoHideMenuBar: true`, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, posicionada en el monitor seleccionado y con `fullscreen: true` (o modo ventana flotante de prueba cuando solo hay 1 monitor).
- Escucha `display-added`, `display-removed` y `display-metrics-changed` emitiendo eventos actualizados al renderer vía IPC. Si se desconecta el monitor externo en vivo, cierra/oculta la ventana externa limpiamente sin detener los reproductores ni el motor de audio de la cabina.

#### `DatabaseService` (`sql.js` SQLite WASM con persistencia atómica)
Tablas en `userData/tubedeck.db` (escritura atómica `.tmp` + rename en cada cambio persistente) gestionadas mediante migraciones versionadas:
- `sessions`: `id`, `title`, `started_at`, `ended_at`, `notes`
- `history_entries`: `id`, `session_id`, `deck` (`'A'|'B'`), `video_id`, `title`, `channel`, `duration_sec`, `played_at`, `ended_at`, `bpm`, `transition_used`
- `track_metadata`: `video_id PRIMARY KEY`, `title`, `channel`, `duration_sec`, `thumbnail_url`, `bpm`, `beat_offset_sec`, `key_signature`, `gain_db`, `hot_cues_json`, `loop_json`, `waveform_peaks_json`, `last_played_at`, `play_count`
- `crates`: `id`, `name`, `color`, `sort_order`, `created_at`
- `crate_tracks`: `crate_id`, `video_id`, `position`, `added_at`
- `midi_mappings`: `id`, `device_name`, `control_key`, `channel`, `status_type`, `cc_or_note`, `mode`, `min_val`, `max_val`
- `app_settings`: `key PRIMARY KEY`, `value_json`

---

### 4.2 Motor de Audio DSP y Sincronización A/V (Renderer)

#### `DualDeckMediaSync`
- Cada deck (`A` y `B`) administra:
  - En modo `muxed`: un único `<video crossOrigin="anonymous">` como fuente tanto de audio como de textura WebGL.
  - En modo `dash-split`: un `<audio crossOrigin="anonymous">` como reloj maestro de audio + un `<video muted crossOrigin="anonymous">` para imagen.
- **Corrección de drift DASH:** monitor periódico (cada 100 ms mientras está en play) que ajusta `video.currentTime = audio.currentTime` únicamente si `|video.currentTime - audio.currentTime| > 0.04` (con enfriamiento mínimo de `250 ms` para evitar micro-tartamudeos). Replica siempre `playbackRate` y `preservesPitch` del audio al video y espera `canplay` en ambos elementos tras `seek`, `hotCue` o salto de `loop`.

#### `AudioDspEngine` y `AudioOutputRouter`
- **Un único `AudioContext` (`dspCtx`):** evita `InvalidStateError` al conectar elementos multimedia a dos destinos hardware y garantiza coherencia de fase entre Master y Audífonos.
- **Cadena por Deck:**
  1. `MediaElementAudioSourceNode`
  2. `GainNode` (`trimGain`: rango `0..2.0`, equivalente a `-∞..+6 dB`)
  3. `BiquadFilterNode` (`eqLow`: `lowshelf`, `250 Hz`, rango `-26 dB..+12 dB`, botón Kill `-60 dB`)
  4. `BiquadFilterNode` (`eqMid`: `peaking`, `1000 Hz`, `Q = 1.0`, rango `-26 dB..+12 dB`, botón Kill `-60 dB`)
  5. `BiquadFilterNode` (`eqHigh`: `highshelf`, `4000 Hz`, rango `-26 dB..+12 dB`, botón Kill `-60 dB`)
  6. `BiquadFilterNode` (`colorFilter`: parámetro bipolar `-1..+1`; centro `0` en `allpass`/bypass, `< 0` aplica `lowpass` `18000 Hz -> 220 Hz` con `Q = 1.5`, `> 0` aplica `highpass` `30 Hz -> 6000 Hz` con `Q = 1.5`)
  7. `AnalyserNode` (`fftSize = 2048` para VU medidor pre-fader y análisis de energía BPM)
  8. **Split a Bus Master:** `channelFader` (`GainNode` logarítmico) → `crossfaderGain` (`GainNode` con curvas `equal-power`, `linear` y `scratch`) → suma en `masterGain` → `DynamicsCompressorNode` (Limiter Master: `threshold -1 dB`, `ratio 20`, `attack 0.001s`, `release 0.1s`) → `masterAnalyser` → `masterDest` (`MediaStreamAudioDestinationNode`).
  9. **Split a Bus Cue (PFL):** `cueToggleGain` (`0|1` por deck) → mezcla `cueBlend` (perilla Cue ↔ Master) → `cueMasterGain` → `cueDest` (`MediaStreamAudioDestinationNode`).
- **`AudioOutputRouter`:** conecta `masterDest.stream` y `cueDest.stream` a sendos `<audio>` ocultos controlados por `.setSinkId(deviceId)`.
  - Escucha `navigator.mediaDevices.ondevicechange`: si el dispositivo asignado a Master o Cue desaparece, conmuta automáticamente a `'default'` y notifica en la barra de estado.
  - **Modo Mono Split:** mediante `ChannelSplitterNode` + `ChannelMergerNode`, combina Master en mono al Canal Izquierdo (`L`) y Cue en mono al Canal Derecho (`R`) sobre `masterDest` cuando el DJ usa un cable splitter estéreo en una laptop con una sola salida jack.

---

### 4.3 Motor de Video Dual-Screen (WebGL2 + Overlays)

#### `WebGLVideoCompositor`
- Mantiene un contexto `WebGL2RenderingContext` sobre el canvas Master (`1920x1080` configurable a `1280x720`).
- Sube como texturas GPU en cada frame a 60 fps únicamente los videos activos, la webcam opcional y la textura de overlays 2D.
- **Video Crossfader con 3 modos de VirtualDJ:**
  - `linked`: sigue automáticamente la posición del crossfader de audio (`0..1`).
  - `independent`: slider de mezcla visual desacoplado del audio.
  - `auto-timed`: botón de transición automática (`1s`, `2s`, `4s`, `8s`) que anima la mezcla visual entre `0` y `1` suavemente.
- **7 Transiciones GLSL:**
  1. `dissolve` (Cross-dissolve clásico)
  2. `wipe` (Barrido direccional Horizontal / Vertical / Diagonal)
  3. `zoom-push` (Zoom progresivo + empuje del frame entrante)
  4. `circle-iris` (Apertura/cierre circular desde el centro)
  5. `luma-fade` (Transición basada en luminancia)
  6. `curtain-split` (Apertura tipo cortina desde el eje central)
  7. `slide` (Desplazamiento lateral continuo)

#### `VideoFxPipeline`
7 efectos shader en cadena aplicables por Deck (A/B) o sobre el bus Master:
1. `blur` (Desenfoque gaussiano separable)
2. `strobe` (Pulso luminoso sincronizado al reloj de BPM activo)
3. `mirror` (Espejo Horizontal, Vertical o Cuádruple / Caleidoscopio)
4. `hue-tint` (Rotación de tono y tinte cromático)
5. `bw-contrast` (Blanco y negro de alto contraste para club)
6. `pixelate` (Mosaico/pixelado variable)
7. `audio-shader` (Generador visual reactivo a bandas Low/Mid/High del `AnalyserNode`, apto tanto como overlay atmosférico o fondo de respaldo)

#### `OverlayCompositor` y Salida a Pantalla 2
- Capa 2D compuesta sobre la salida Master (sin afectar a los previews individuales de Deck A/B):
  - **Logo:** imagen local PNG/SVG/WebP con control de esquina, escala y opacidad.
  - **Texto / Marquesina:** banner fijo o ticker animado con fuente, tamaño y color configurables.
  - **OSD Automático:** cartel elegante "Ahora suena: Título — Canal" que aparece durante 6 segundos cuando un deck toma el protagonismo Master.
  - **Webcam PiP:** entrada en vivo vía `getUserMedia({ video: true })` con tamaño, esquina, recorte redondeado y opacidad ajustables.
- **Espejo hacia Pantalla 2:** `masterCanvas.captureStream(60)` se transmite hacia la ventana secundaria abierta por `window.open(..., 'tubedeck-output')` (interceptada por `DisplayWindowManager`) mediante una conexión WebRTC loopback local (`RTCPeerConnection` en memoria con señalización por `postMessage`/IPC, sin tráfico de red externo), entregando el stream directamente al `<video srcObject={stream} autoPlay muted />` de la Pantalla 2. Esto evita fallos de propiedad cross-window de `MediaStream` en Chromium, mantiene `< 16ms` de latencia, cero decodificación duplicada y cero interfaz ajena al público.

---

### 4.4 Controles DJ, Automix, Historial y MIDI

- **Hot Cues (`CueLoopTempoController`):** 8 slots por deck (`1..8`). Si un slot está vacío, pulsarlo guarda la posición exacta (`currentTime`); si está definido, salta instantáneamente y mantiene estado play/pause. `Shift+Clic` o modo borrado limpia el slot. Persistidos automáticamente en `track_metadata.hot_cues_json`.
- **Loops:** Loop In, Loop Out, Loop Exit/Reloop y **Auto-Loop** (`1/2, 1, 2, 4, 8, 16` beats derivados del BPM del deck) con barra de desplazamiento de fase.
- **Pitch / Tempo & Key Lock:** Slider de rango seleccionable (`±8%`, `±16%`, `±50%`), botones momentáneos `Pitch Bend - / +` y toggle `Key Lock` (`preservesPitch = true`).
- **BPM, Waveform & Sync (`BpmAndWaveformEngine`):**
  - Detección automática de BPM basada en energía espectral de graves + autocorrelación en ventana móvil (o cálculo inicial de picos si el stream permite precarga en Web Audio `decodeAudioData` de muestra corta en RAM, con fallback en tiempo real por `AnalyserNode`), corregible manualmente con **Tap BPM** y `×2 / ÷2`.
  - Botón **SYNC** por deck que ajusta `playbackRate` para igualar el BPM del deck opuesto.
  - Waveform Overview completo (persistido en `waveform_peaks_json` por `videoId` cuando se analiza) + Waveform desplazable con marcadores visuales de Hot Cues y Loops.
- **Cola y Automix (`QueueAndAutomixEngine`):**
  - Cola "Up Next" con reordenamiento Drag & Drop, carga directa a Deck A o Deck B, e importación de playlists de YouTube completas.
  - Cuando **Automix** está activo:
    1. A `30 segundos` del final de la pista activa, resuelve y pre-carga el siguiente track de la cola en el deck en reposo (`readyState >= HAVE_FUTURE_DATA`).
    2. Al llegar al punto de transición (`outroSeconds` configurable `4..16s` antes del final, o al terminar si la pista es corta), inicia el siguiente deck y ejecuta transición cruzada simultánea de Audio + Video.
    3. **Resiliencia ante fallos:** si el siguiente video falla al resolver o lanza error de red/restricción, lo marca como fallido en el toast de cabina y **avanza automáticamente al siguiente item válido de la cola** para impedir cortes de música.
- **Historial de Mixes, Crates y Exportación (`HistoryAndCratesService`, `SessionExporter`):**
  - Registra automáticamente en SQLite toda pista reproducida en Master `>= 10s` con hora, deck, BPM y transición empleada.
  - Permite cerrar/iniciar sesiones, consultar el historial completo, recargar cualquier sesión pasada a la Cola "Up Next", gestionar Crates temáticos y exportar sesiones/crates a `JSON`, `CSV` y `M3U`.
- **Atajos de Teclado y Web MIDI (`HotkeyManager`, `MidiLearnEngine`):**
  - Mapa de teclado completo (con desactivación automática mientras el usuario escribe en el buscador o campo de marquesina).
  - Motor `Web MIDI API` compatible con controladores USB DJ estándar: modo **MIDI Learn** (clic en cualquier control de UI → mover fader/knob/botón físico → guardado inmediato en `midi_mappings` por `device_name`).

---

## 5. Diseño de Interfaz (Cabina y Pantalla Externa)

### Estética y Lenguaje Visual
- Consola oscura profesional de alto contraste orientada a cabinas con poca iluminación:
  - Fondo base `#0B0E14`, superficie de módulos `#131822`, bordes `#1F2735`, texto primario `#F1F5F9`, secundario `#94A3B8`.
  - Identidad cromática funcional: **Deck A Cian (`#00D4FF`)**, **Deck B Ámbar (`#FF8A00`)**, **Master / Sync / Automix Esmeralda (`#10B981`)**, **Cue / PFL Violeta (`#8B5CF6`)**, **Clipping / Kill Rojo (`#EF4444`)**.
  - Tipografía UI limpia (`Inter`) y cifras tabulares monoespaciadas (`JetBrains Mono`) para BPM, cronómetros `elapsed/remaining` y porcentaje de Pitch.
  - Knobs rotatorios con interacción vertical (`pointerdown` + `setPointerCapture`), rueda de mouse fina y doble clic para reset al valor neutro (`0 dB`).

### Distribución en 3 Franjas (Cabina Principal)
1. **Franja Superior — Decks A/B y Monitores de Video:**
   - Izquierda: **Deck A** (Título, BPM, Tiempo restante, Waveform Overview + Scroll, Play/Cue/Sync, Pitch slider + Key Lock, 8 Hot Cues + Auto-Loop).
   - Centro: **Cabina de Video** (`Preview A` | **`MASTER LIVE`** + selector rápido de Transición/FX | `Preview B`, además de indicador `PANTALLA 2 ON AIR` y botón rápido para abrir/mover salida externa).
   - Derecha: **Deck B** (espejo simétrico con acento ámbar).
2. **Franja Media — Mixer Central & Overlays:**
   - Canal A y Canal B: `Trim`, `EQ High/Mid/Low` + botones `Kill`, `Color Filter`, botón `Cue` (audífonos), medidor LED estéreo y `Channel Fader`.
   - Columna Central: `Master Vol`, `Cue Vol`, `Cue/Master Mix`, selector `Automix` + botón de transición temporizada, **Crossfader Audio** y **Video Crossfader** (`Linked` / `Independent` / `Auto`).
   - Barra compacta de **Overlays en vivo** (toggles rápidos para Logo, Marquesina/Texto, OSD automático y Webcam PiP).
3. **Franja Inferior — Navegador con Pestañas:**
   - `Buscador YouTube` (barra de búsqueda + pegado de URL/Playlist + resultados con miniatura, duración y botones `A`, `B`, `+ Cola`).
   - `Cola (Up Next)` (lista reordenable drag & drop + estado de pre-buffering Automix).
   - `Historial de Mixes` (sesiones pasadas y actual, recargar mix a cola, exportar `JSON`/`CSV`/`M3U`).
   - `Crates` (colecciones temáticas locales).
   - `Ajustes` (dispositivos de audio Master/Cue + Mono Split, gestión de Monitores, perfiles MIDI Learn, mapa de atajos y estado de `yt-dlp`).

---

## 6. Decisiones Fijadas y Alcance de Builder

- **Un único `AudioContext` con `MediaStreamAudioDestinationNode` + `setSinkId`:** decidido frente a múltiples `AudioContext` porque un `HTMLMediaElement` solo puede enlazarse a un único `AudioContext` en Chromium sin lanzar `InvalidStateError`.
- **`masterCanvas.captureStream(60)` hacia Pantalla 2:** decidido frente a instanciar un segundo par de reproductores YouTube en la ventana hija porque garantiza sincronización exacta cuadro a cuadro con el Master Preview, evita duplicar ancho de banda y preserva los shaders GLSL y overlays con latencia mínima.
- **Proxy HTTP en RAM (`127.0.0.1:0` + token):** decidido frente al IFrame oficial de YouTube porque el IFrame impide el acceso Web Audio por CORS (silenciando los nodos EQ/Analyser) e impide texturas WebGL limpias y eliminación de UI ajena en la pantalla del público.
- **Libertad del implementador dentro del Plan:** los detalles internos de helpers GLSL, estilos Tailwind específicos y manejo fino de SQL queries quedan acotados por los contratos exactos de interfaces y pruebas definidos en `docs/superpowers/plans/2026-11-19-youtube-vdj-plan.md`.
