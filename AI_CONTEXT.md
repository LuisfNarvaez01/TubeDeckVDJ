# AI Context — Proyecta (antes TubeDeck VDJ) (`v3.1.2`)

Documento de referencia técnica rápida para darle contexto inmediato del proyecto a cualquier asistente de IA.

## 1. Resumen del Proyecto
- **Nombre / Paquete:** `Proyecta` desde v3.1 (antes `TubeDeck VDJ`). Paquete `tubedeck-vdj`, versión `3.1.2`, `appId` `com.tubedeck.vdj` — NO cambiar paquete ni appId (la actualización automática depende de ellos). La carpeta de datos sigue siendo `%APPDATA%/TubeDeck VDJ` (`LEGACY_DATA_FOLDER` en `src/main/index.ts`). Instalador: `Proyecta-Setup-<versión>.exe`.
- **Objetivo:** Cabina DJ/VDJ de doble pantalla para Windows que mezcla videos de YouTube en streaming en memoria (**sin descargar archivos multimedia al disco** durante la reproducción normal), permite intercalar archivos o carpetas locales, renderiza video compuesto a 60 fps en Pantalla 2 con transiciones WebGL2 y marcos configurables, y ofrece descarga opcional por lotes de sesiones del historial.
- **Repositorio / Auto-Actualizaciones:** `https://github.com/LuisfNarvaez01/TubeDeckVDJ.git` (`electron-updater` vía GitHub Releases + workflow `.github/workflows/release.yml` activado al hacer push de tags `v*`).

## 2. Stack Tecnológico
- **Desktop / Build:** Electron `45.4.1`, `electron-vite` `6.0.0`, `electron-builder` `26.18.0` (instalador Windows NSIS `x64`, `asar: true`).
- **Frontend:** React `19.3.1`, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Zustand `5.1.0`, `lucide-react` (`1.76.0`).
- **Audio y Video:** Web Audio API (`AudioDspEngine`, `AudioOutputRouter`), reproducción dual HTMLMediaElement (`DualDeckMediaSync`), WebGL2 / GLSL (`WebGLVideoCompositor` + `transitions.glsl.ts` + `effects.glsl.ts`), Canvas 2D (`OverlayCompositor`), WebRTC loopback (`outputRtcBridge`).
- **Proceso Main / Persistencia:** `youtubei.js` `18.3.0`, binario `yt-dlp.exe` en `resources/bin/` (empaquetado en `extraResources` → `bin/`), `sql.js` `1.17.0` (SQLite WASM sin compilación nativa C++, `sql-wasm.wasm` en `extraResources`), `zod` `4.6.7`.
- **Testing:** Vitest `5.1.1` (28 archivos, 60 tests unitarios/componentes) y Playwright `1.65.1` (`tests/e2e/appFlow.spec.ts` para binario compilado y ejecutable empaquetado).

## 3. Arquitectura y Mapa de Archivos (`src/`)

### Main Process (`src/main/`)
- `src/main/index.ts`: Inicialización de Electron, CSP estricta (`media-src 'self' http://127.0.0.1:* blob:`), aislamiento opcional por `TUBEDECK_USER_DATA_DIR`, y arranque de servicios.
- `src/main/ipc/registerHandlers.ts`: Registro de handlers IPC validados con `zod` retornando `Result<T>` (`{ success: true, data } | { success: false, error }`).
- `src/main/services/StreamResolverService.ts`: Resolución de URLs de YouTube vía `yt-dlp` eligiendo **H.264 720p** por defecto y exponiendo `videoVariants` (`1080p`, `720p`, `480p`, `360p`) en modo `dash-split` o `muxed`.
- `src/main/services/RamStreamProxy.ts`: Proxy HTTP local en `127.0.0.1` en RAM con lectura por rangos (`Range`) en bloques de **2 MB** para evitar cortes/throttling de YouTube, parámetro `?quality=`, timeout/reintentos y streaming `HTTP 206` para archivos locales (`/local/:fileId`).
- `src/main/services/YouTubeSearchService.ts`: Búsqueda en YouTube con metadatos ricos (`durationSec`, `viewsText`, `publishedText`), playlists, pistas relacionadas y `getMusicRadio` (radio *automix* de YouTube Music vía `music.getUpNext`, prefiere la versión con video oficial 16:9). Toda llamada a YouTube pasa por `withClient`/`withRetry`: timeout de 12 s (`DEFAULT_YOUTUBE_TIMEOUT_MS`), y ante cuelgue o fallo descarta la sesión Innertube y reintenta una vez con una nueva; el error final llega en español ("YouTube tardó demasiado en responder…") y el buscador ofrece **Reintentar**. `getHistoryWeightedRecommendations` queda solo como respaldo (el feed `watch_next` anónimo ya casi no devuelve resultados).
- `src/main/services/RecommendationEngine.ts`: Pipeline de Radio YT (Fuente → Filtro → Puntuación → Selección). Fuentes en paralelo: radio YT Music de la canción actual + una de la sesión reciente + un Me gusta o canción de referencia (caché 20 min). Filtra basura (reacciones, tutoriales, vlogs, shorts, mezclas largas; duración 90–600 s), no me gusta y canales bloqueados; puntúa consenso entre radios, afinidad por artista, video oficial, perfil histórico; diversidad (máx. 2 por artista, sin versiones duplicadas). Devuelve `recommendReason` por pista.
- `src/main/services/TasteFeedbackService.ts`: Perfil local que reemplaza a la cuenta de Google: tablas `track_feedback` (`like`/`dislike`/`skip`/`complete`/`block-channel`, decaimiento de 60 días), `blocked_channels` y `taste_seeds` (hasta 10 canciones de referencia del asistente de primer uso).
- `src/main/services/DatabaseService.ts`, `HistoryAndCratesService.ts`, `SessionExporter.ts`: Base SQLite (`tubedeck.db` con tablas `sessions`, `history_entries`, `track_metadata`, `crates`, `crate_tracks`, `midi_mappings`, `app_settings`, `schema_version`; migración v2: `track_feedback`, `blocked_channels`, `taste_seeds`), generación del perfil de afinidad (`buildTasteProfile(100)`) y exportación de sesiones.
- `src/main/services/LocalLibraryService.ts`: Administración de archivos y carpetas locales de audio/video.
- `src/main/services/BatchDownloadService.ts`: Descarga por lotes de sesiones del historial vía `yt-dlp.exe` (formatos sin dependencia de `ffmpeg`) con eventos de progreso y registro en `LocalLibraryService`.
- `src/main/services/DisplayWindowManager.ts`: Detección de monitores y ventana secundaria limpia `role=output` (Pantalla 2).
- **Pedidos de canciones (módulo vendible por separado)** — `songRequestsModule.ts` une un núcleo y dos fuentes; solo una activa según el modo (`requests.mode`: `off` | `lantify` | `local`):
  - `SongRequestsService.ts` (núcleo): lista de pedidos (`id` = `<origen>:<externalId>`), búsqueda con `YouTubeSearchService` + `passesSongFilter` (los filtros de la Radio), `NO_MATCH`, decisiones (QUEUED/PLAYING/PLAYED/REJECTED), preferencias (auto-aprobar, máx. por hora y por mesa, aviso en Pantalla 2) y now-playing. Avisa a cada conector (`RequestConnector`) de los cambios de sus pedidos.
  - `LantifyRequestsService.ts` (con Lantify POS, QR de la mesa): `POST /v1/proyecta/pair`, `GET /v1/proyecta/requests?since=` cada 5 s (backoff 10/20/40/60 s), `POST /v1/proyecta/requests/:id`, `PUT /v1/proyecta/now-playing`; cola de envío que sobrevive cortes; `401` borra el token (`revoked`). Vincular pone el modo en `lantify`.
  - `LocalRequestServer.ts` + `localRequestPage.ts` (independiente, sin Lantify): servidor HTTP en la red del local (puerto 8765, siguiente libre si está ocupado) con página para el celular; el QR (librería `qrcode`) lleva una clave de acceso (`?k=`, se puede rotar) y opcionalmente `&mesa=N`. API: `GET /api/info`, `POST /api/requests`, `GET /api/requests/:id` (cabecera `X-Proyecta-Key`), cuerpo máx. 2 KB, 1 pedido cada 30 s y máx. 3 abiertos por celular, CSP propia. Hoja imprimible con un QR general y uno por mesa (`Documentos/Proyecta/QR para pedir canciones.html`). Los clientes deben estar en el mismo WiFi; Windows pide permiso de firewall la primera vez.
  - El token de Lantify y la clave del QR viven en `app_settings` (`lantify.*`, `requests.*`) y `db:get/set-setting` rechaza esas claves. IPC: `requests:*`, `lantify:pair/unpair`, `local-requests:*`.
  - Renderer: `dj/SongRequestBridge.ts` (aprobar → `enqueue(source: 'request')` con mesa/nombre, `requestConflict` = en cola o sonó hace < 60 min → `ALREADY_PLAYED`, auto-aprobar con límites, PLAYING/PLAYED según la pista más audible), `store/useSongRequestStore.ts`, pestaña `RequestsTab` ("Pedidos"), `SongRequestsCard` en Ajustes, `OverlayCompositor.triggerRequestBanner` ("Pedida por la mesa N", 10 s) y `setRequestQr` (QR en una esquina libre de Pantalla 2 en modo independiente).
- `src/main/services/AutoUpdaterService.ts` y `YtDlpBinaryManager.ts`: Auto-actualización contra GitHub Releases y gestión de `yt-dlp.exe`.

### Preload y Contrato Compartido (`src/preload/`, `src/shared/`)
- `src/preload/index.ts` (compilado a `out/preload/index.cjs` con `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`): Expone `window.tubedeckAPI`.
- `src/shared/ipcChannels.ts`: Constante `IPC_CHANNELS` con 55 canales (`youtube:*`, `stream:*`, `ytdlp:*`, `db:*`, `display:*`, `history:*`, `taste:*`, `local:*`, `crate:*`, `midi:*`, `updater:*`).
- `src/shared/types.ts`: Tipos compartidos (`YouTubeTrack`, `ResolvedStream`, `DeckStreamEndpoints`, `VideoQualityTier`, `HistoryTasteProfile`, `BatchDownloadProgress`, etc.).

### Renderer (`src/renderer/`)
- `src/renderer/App.tsx`: Orquestador principal y loop 60 fps (`requestAnimationFrame`: crossfade audio+video, `syncDrift`, `checkVideoHealth`, Auto-Gain, detección de BPM, Automix + Radio YT, WebGL2 master y overlays).
- `src/renderer/audio/`:
  - `AudioDspEngine.ts`: EQ de 3 bandas + Kill, Color Filter, Crossfader con curvas, Sampler de 8 pads, Deck FX (Echo/Reverb/Flanger), ruteo Master/Cue.
  - `AudioOutputRouter.ts`: Ruteo hacia dispositivos de audio (`setSinkId`) para Master y Audífonos o modo Mono Split.
  - `DualDeckMediaSync.ts`: Sincronización audio/video en `dash-split`, watchdog anti-congelamiento `checkVideoHealth` con downgrade automático (`720p` → `480p` → `360p`) y soporte `mediaKind: 'audio'`.
- Grabación de mezcla (v3): `audio/MixRecorder.ts` (MediaRecorder del master post-limitador + canvas de Pantalla 2) → `main/services/MixRecordingService.ts` escribe por trozos en `Música/TubeDeck Grabaciones`.
- Listas inteligentes (v3): `HistoryAndCratesService.getSmartCrate` (combina con lo que suena, Me gusta, Más tocadas, Recientes, Olvidadas).
- Explorador local (v2.4+): `LocalLibraryService.browseDirectory` / `listDrivePlaces` (unidades, USB, accesos).
- Distribución v3.1.2: escenario arriba = `RundownColumn` "Anteriores" (2 últimas que sonaron ≥10 s, `useLibraryStore.recentOnAir`) · Previa A · AL AIRE · Previa B · "Siguientes" (2 primeras de la cola). Los controles de video (`VideoPreviewBar part="controls"`) van en `MixerCenter topSlot`. Debajo: Deck A · Mixer · Deck B completos.
- Vigilante de reproducción (v3.1.2, App RAF): si un deck "sonando" no avanza en 7 s se recarga en el mismo punto (invalida la URL); si se traba de nuevo cuenta como terminada (`stallEndedRef`) y el Automix pasa a la siguiente.
- Canciones quitadas (v3.1.2): `removeByUser` / expulsar llaman `dismissSong`; la Radio y "Sugerir ahora" (`filterFreshSuggestions`) no las vuelven a poner en la sesión (por id y por `looseSongKey`).
- Acceso a YouTube (v3.1.1): yt-dlp usa el Node del propio Electron como motor JS (`--js-runtimes node:<exe>` + `ELECTRON_RUN_AS_NODE`). Si YouTube pide "confirmar que no eres un robot", el error lleva `YOUTUBE_BOT_CHECK`; `YouTubeAccessMonitor` prueba al arrancar y la UI ofrece "Conectar YouTube" (ventana aislada, partición `persist:youtube-signin`; cookies exportadas a `userData/youtube-cookies.txt` para `--cookies`).
- `src/renderer/video/`:
  - `WebGLVideoCompositor.ts` + `transitions.glsl.ts` + `effects.glsl.ts`: 9 transiciones de video, soporte de viewport interno `u_videoRect` para marcos y captura a 60 fps para Pantalla 2.
  - `VideoFxPipeline.ts`: 7 efectos visuales reactivos al análisis de bandas de audio.
  - `OverlayCompositor.ts`: Marcos (`minimal-studio`, `karaoke-stage`, `gala-gold`, `club-led`, PNG `custom` vía `getVideoInsetRect()`), Logo, Marquesina, OSD de pista y Webcam.
  - `outputRtcBridge.ts`: Envío/recepción WebRTC local del stream compuesto hacia `OutputWindowView.tsx`.
- `src/renderer/dj/`:
  - `QueueAndAutomixEngine.ts`: Cola con precarga temprana (`immediate` 4s / `90s` / `60s` / `30s`), `moveToNext`, `interleaveBySource` (intercalar Local/YouTube), `clear()` y Radio YT automática. Las cargas manuales reclaman el deck (`claimDeckForManualLoad`), una carga más nueva cancela a la anterior (`DeckLoadSupersededError`) y la Radio no repite canciones (`looseSongKey`).
  - `HarmonicKey.ts` (v3): tono musical en vivo (cromagrama + perfiles Krumhansl) → código Camelot, guardado en `track_metadata.musical_key`; reglas de mezcla armónica en `src/shared/camelot.ts`.
  - `BeatPhase.ts` (v3): ancla del beatgrid (`beat_offset_sec`), medidor de fase (`PhaseMeter.tsx`) y SYNC que alinea fase; Automix iguala BPM y fase si los tempos están a ±8 %.
  - `CueLoopTempoController.ts`: Hot Cues 1–8, Auto-Loop, Loop Roll, Beat Jump y CUE real.
  - `BpmAndWaveformEngine.ts`: Detección de BPM por energía y cálculo de tasa para Sync.
- `src/renderer/controllers/`: `HotkeyManager.ts` (atajos de teclado) y `MidiLearnEngine.ts` (Web MIDI API).
- `src/renderer/store/`: Stores Zustand (`useDeckStore.ts`, `useMixerStore.ts`, `useLibraryStore.ts`, `useSettingsStore.ts`).
- `src/renderer/components/`:
  - Principales: `DeckPanel.tsx` (incluye 👍/👎 de la pista cargada), `MixerCenter.tsx`, `VideoPreviewBar.tsx`, `SearchBrowserTab.tsx`, `LocalLibraryTab.tsx`, `QueueTab.tsx`, `HistoryAndCratesTab.tsx`, `OverlayControls.tsx`, `SettingsTab.tsx`, `InteractiveGuideModal.tsx`, `TasteSetupModal.tsx`, `OutputWindowView.tsx`.
  - Dock inferior (estilo página de video de YouTube): izquierda 3 pestañas (`SearchBrowserTab`, `LocalLibraryTab`, `HistoryAndCratesTab`); derecha columna fija **Siguiente** (`QueueTab.tsx` dentro de `<aside aria-label="Siguiente">`, 300–380 px) con Automix/Radio, opciones plegables (`Opciones de cola`), motivo de cada sugerencia de la radio y 👍/👎/bloquear canal. `SearchBrowserTab` muestra tarjetas 16:9 (título 2 líneas, canal, vistas · fecha; A/B/CUE sobre la miniatura al hover/focus) o lista compacta (`tubedeck.searchViewMode` en localStorage) y cae a lista automáticamente si el área mide < 250 px.
  - Divisor cabina/dock (`role="separator"`: arrastre, flechas, doble clic restablece) y botón **Ampliar navegador / Cabina completa**; alto en `tubedeck.dockHeight` (mín. 120 px). Sin alto explícito el dock tiene mín. 220 px y la cabina hace scroll interno si no cabe.
  - `TasteSetupModal.tsx` ("Ajustar mi radio"): hasta 10 canciones de referencia (solo canciones de 1–10 min, sin mezclas), resumen de lo aprendido, desbloquear canales, reiniciar. Se abre en el primer arranque (setting `tasteSetupDismissed`) y desde Siguiente → Opciones.
  - Señales implícitas en `App.tsx` (`reportImplicitFeedback`): sugerencia de radio audible 3–30 s y reemplazada = `skip`; ≥ 60 % escuchada = `complete`.
  - Controles `src/renderer/components/ui/`: `JogWheel.tsx`, `LedVuMeter.tsx`, `RgbWaveformStrip.tsx`, `RotaryKnob.tsx`.

## 4. Reglas de Diseño Visual (UI)
- **Fuente de verdad:** `PRODUCT.md` (producto y usuarios), `DESIGN.md` (sistema visual) y `.impeccable/surfaces/src-renderer-app-tsx.md` (contrato de dirección). Leerlos antes de tocar la UI.
- **Mundo visual "Muro de streaming de noche" (v2.2+):** fondo negro puro (v2.4), el color lo ponen las miniaturas y el video; lo enfocado se eleva y lo demás se atenúa. Tokens Tailwind v4 en `src/renderer/styles/index.css` (`@theme`): `ground #000000`, `surface #0b0b0d`, `raised #151518`, `raised-2/3`, `ink #f5f5f6`, `ink-2`, `ink-soft`, `muted`, `faint`, `deck-a #22e1f0` (cian), `deck-b #ff4fa8` (magenta), `live #f0fdff` (en vivo / foco), `danger`. Usar clases de token (`bg-surface`, `text-deck-a/80`), nunca hex sueltos en la UI.
- **Tipografía:** Figtree Variable empaquetada localmente (`@fontsource-variable/figtree`, la CSP no permite fuentes remotas). `.font-mono-tabular` = Figtree con `tabular-nums` para relojes, BPM, horas y contadores.
- **Firma:** el deck al aire (reproduciendo + fader + crossfader abiertos) se eleva con borde/sombra de su color y etiqueta `AL AIRE`; en el buscador la tarjeta en hover/foco se eleva con anillo cálido y sus hermanas bajan a 0.55 de opacidad; la cola muestra la hora estimada de inicio de cada canción y el estado por forma de línea (punteada pendiente, sólida precargada, tachado fallida); la barra superior muestra solo la próxima decisión con cuenta regresiva.
- **Reglas:** color saturado solo en lo accionable o en vivo; Deck A/B son identidad funcional; sin emojis (solo `lucide-react`); los estados de pads usan línea interior (`inset box-shadow`), no `border-b-2`; el arte de salida de Pantalla 2 (`src/renderer/video/*`, marcos) conserva sus propios colores.
- **Marca:** `components/ui/BrandMark.tsx` y `build/icon.svg` → `build/icon.png` (1024) y `build/icon.ico` (16–256). La versión de la barra superior sale de `__APP_VERSION__` (definida en `electron.vite.config.ts` desde `package.json`).
- **Disposición:** barra superior (marca, versión, calidad, Siguiente + cuenta regresiva, Automix/Radio/P2/KEYS/Marcos/Guía/Ajustes); fila de decks + master de video; fila FX A | Mixer (mín. 560 px) | FX B; dock inferior con 3 pestañas + columna fija `Siguiente`, divisor arrastrable.

## 5. Comandos Clave (PowerShell en Windows)
> **Nota:** En Windows PowerShell 5.1 no usar `&&`; separar comandos con `;` y comprobar `$LASTEXITCODE`.

```powershell
# Desarrollo con Electron + Vite
npm run dev

# Verificación de tipos (main/preload + renderer)
npm run typecheck

# Compilación de producción (out/main, out/preload, out/renderer)
npm run build

# Pruebas unitarias (28 archivos / 60 tests)
npx vitest run

# Pruebas E2E contra app compilada (out/main/index.js)
npx playwright test tests/e2e/appFlow.spec.ts

# Pruebas E2E contra ejecutable Windows empaquetado
$env:TUBEDECK_E2E_EXE="d:\Trabajos\Pantallas\dist\win-unpacked\TubeDeck VDJ.exe"; npx playwright test tests/e2e/appFlow.spec.ts

# Empaquetado NSIS sin firma de código local (genera dist/Proyecta-Setup-3.1.2.exe)
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"; npx electron-builder --win nsis
```

## 6. Reglas Críticas y Trampas Conocidas (Pitfalls)
1. **Nunca declarar `__filename` ni `__dirname` a nivel superior en `src/main/**/*.ts`:** `electron-vite` inyecta `const __filename` / `const __dirname` al inicio de `out/main/index.js`; redeclararlos provoca un cierre silencioso al iniciar Electron. Usar `path.dirname(fileURLToPath(import.meta.url))`.
2. **Preload CommonJS:** `electron.vite.config.ts` compila el preload a `out/preload/index.cjs` y `src/main/index.ts` lo carga exactamente como `../preload/index.cjs`.
3. **Cero descargas de media al disco por streaming:** `tests/e2e/appFlow.spec.ts` falla si encuentra archivos `.mp4`, `.webm`, `.m4a` o `.mp3` dentro de `userData`. Solo la herramienta explícita de descarga por lotes en historial guarda archivos en la carpeta destino elegida por el usuario.
4. **Release CI en GitHub Actions:** `.github/workflows/release.yml` descarga automáticamente `yt-dlp.exe` en `resources/bin/` y ejecuta `vitest`, `typecheck`, `build` y `electron-builder --win nsis --publish always` al hacer push de cualquier tag `v*`.

