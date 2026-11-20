# AI Context — TubeDeck VDJ (`v2.2.0`)

Documento de referencia técnica rápida para darle contexto inmediato del proyecto a cualquier asistente de IA.

## 1. Resumen del Proyecto
- **Nombre / Paquete:** `TubeDeck VDJ` (`tubedeck-vdj`, versión `2.2.0`, `appId`: `com.tubedeck.vdj`).
- **Objetivo:** Cabina DJ/VDJ de doble pantalla para Windows que mezcla videos de YouTube en streaming en memoria (**sin descargar archivos multimedia al disco** durante la reproducción normal), permite intercalar archivos o carpetas locales, renderiza video compuesto a 60 fps en Pantalla 2 con transiciones WebGL2 y marcos configurables, y ofrece descarga opcional por lotes de sesiones del historial.
- **Repositorio / Auto-Actualizaciones:** `https://github.com/LuisfNarvaez01/TubeDeckVDJ.git` (`electron-updater` vía GitHub Releases + workflow `.github/workflows/release.yml` activado al hacer push de tags `v*`).

## 2. Stack Tecnológico
- **Desktop / Build:** Electron `45.4.1`, `electron-vite` `6.0.0`, `electron-builder` `26.18.0` (instalador Windows NSIS `x64`, `asar: true`).
- **Frontend:** React `19.3.1`, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Zustand `5.1.0`, `lucide-react` (`1.76.0`).
- **Audio y Video:** Web Audio API (`AudioDspEngine`, `AudioOutputRouter`), reproducción dual HTMLMediaElement (`DualDeckMediaSync`), WebGL2 / GLSL (`WebGLVideoCompositor` + `transitions.glsl.ts` + `effects.glsl.ts`), Canvas 2D (`OverlayCompositor`), WebRTC loopback (`outputRtcBridge`).
- **Proceso Main / Persistencia:** `youtubei.js` `18.3.0`, binario `yt-dlp.exe` en `resources/bin/` (empaquetado en `extraResources` → `bin/`), `sql.js` `1.17.0` (SQLite WASM sin compilación nativa C++, `sql-wasm.wasm` en `extraResources`), `zod` `4.6.7`.
- **Testing:** Vitest `5.1.1` (26 archivos, 42 tests unitarios/componentes) y Playwright `1.65.1` (`tests/e2e/appFlow.spec.ts` para binario compilado y ejecutable empaquetado).

## 3. Arquitectura y Mapa de Archivos (`src/`)

### Main Process (`src/main/`)
- `src/main/index.ts`: Inicialización de Electron, CSP estricta (`media-src 'self' http://127.0.0.1:* blob:`), aislamiento opcional por `TUBEDECK_USER_DATA_DIR`, y arranque de servicios.
- `src/main/ipc/registerHandlers.ts`: Registro de handlers IPC validados con `zod` retornando `Result<T>` (`{ success: true, data } | { success: false, error }`).
- `src/main/services/StreamResolverService.ts`: Resolución de URLs de YouTube vía `yt-dlp` eligiendo **H.264 720p** por defecto y exponiendo `videoVariants` (`1080p`, `720p`, `480p`, `360p`) en modo `dash-split` o `muxed`.
- `src/main/services/RamStreamProxy.ts`: Proxy HTTP local en `127.0.0.1` en RAM con lectura por rangos (`Range`) en bloques de **2 MB** para evitar cortes/throttling de YouTube, parámetro `?quality=`, timeout/reintentos y streaming `HTTP 206` para archivos locales (`/local/:fileId`).
- `src/main/services/YouTubeSearchService.ts`: Búsqueda en YouTube con metadatos ricos (`durationSec`, `viewsText`, `publishedText`), playlists, pistas relacionadas y `getMusicRadio` (radio *automix* de YouTube Music vía `music.getUpNext`, prefiere la versión con video oficial 16:9). `getHistoryWeightedRecommendations` queda solo como respaldo (el feed `watch_next` anónimo ya casi no devuelve resultados).
- `src/main/services/RecommendationEngine.ts`: Pipeline de Radio YT (Fuente → Filtro → Puntuación → Selección). Fuentes en paralelo: radio YT Music de la canción actual + una de la sesión reciente + un Me gusta o canción de referencia (caché 20 min). Filtra basura (reacciones, tutoriales, vlogs, shorts, mezclas largas; duración 90–600 s), no me gusta y canales bloqueados; puntúa consenso entre radios, afinidad por artista, video oficial, perfil histórico; diversidad (máx. 2 por artista, sin versiones duplicadas). Devuelve `recommendReason` por pista.
- `src/main/services/TasteFeedbackService.ts`: Perfil local que reemplaza a la cuenta de Google: tablas `track_feedback` (`like`/`dislike`/`skip`/`complete`/`block-channel`, decaimiento de 60 días), `blocked_channels` y `taste_seeds` (hasta 10 canciones de referencia del asistente de primer uso).
- `src/main/services/DatabaseService.ts`, `HistoryAndCratesService.ts`, `SessionExporter.ts`: Base SQLite (`tubedeck.db` con tablas `sessions`, `history_entries`, `track_metadata`, `crates`, `crate_tracks`, `midi_mappings`, `app_settings`, `schema_version`; migración v2: `track_feedback`, `blocked_channels`, `taste_seeds`), generación del perfil de afinidad (`buildTasteProfile(100)`) y exportación de sesiones.
- `src/main/services/LocalLibraryService.ts`: Administración de archivos y carpetas locales de audio/video.
- `src/main/services/BatchDownloadService.ts`: Descarga por lotes de sesiones del historial vía `yt-dlp.exe` (formatos sin dependencia de `ffmpeg`) con eventos de progreso y registro en `LocalLibraryService`.
- `src/main/services/DisplayWindowManager.ts`: Detección de monitores y ventana secundaria limpia `role=output` (Pantalla 2).
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
- `src/renderer/video/`:
  - `WebGLVideoCompositor.ts` + `transitions.glsl.ts` + `effects.glsl.ts`: 9 transiciones de video, soporte de viewport interno `u_videoRect` para marcos y captura a 60 fps para Pantalla 2.
  - `VideoFxPipeline.ts`: 7 efectos visuales reactivos al análisis de bandas de audio.
  - `OverlayCompositor.ts`: Marcos (`minimal-studio`, `karaoke-stage`, `gala-gold`, `club-led`, PNG `custom` vía `getVideoInsetRect()`), Logo, Marquesina, OSD de pista y Webcam.
  - `outputRtcBridge.ts`: Envío/recepción WebRTC local del stream compuesto hacia `OutputWindowView.tsx`.
- `src/renderer/dj/`:
  - `QueueAndAutomixEngine.ts`: Cola con precarga temprana (`immediate` 4s / `90s` / `60s` / `30s`), `moveToNext`, `interleaveBySource` (intercalar Local/YouTube), `clear()` y Radio YT automática.
  - `CueLoopTempoController.ts`: Hot Cues 1–8, Auto-Loop, Loop Roll, Beat Jump y CUE real.
  - `BpmAndWaveformEngine.ts`: Detección de BPM por energía y cálculo de tasa para Sync.
- `src/renderer/controllers/`: `HotkeyManager.ts` (atajos de teclado) y `MidiLearnEngine.ts` (Web MIDI API).
- `src/renderer/store/`: Stores Zustand (`useDeckStore.ts`, `useMixerStore.ts`, `useLibraryStore.ts`, `useSettingsStore.ts`).
- `src/renderer/components/`:
  - Principales: `DeckPanel.tsx`, `MixerCenter.tsx`, `VideoPreviewBar.tsx`, `SearchBrowserTab.tsx`, `LocalLibraryTab.tsx`, `QueueTab.tsx`, `HistoryAndCratesTab.tsx`, `OverlayControls.tsx`, `SettingsTab.tsx`, `InteractiveGuideModal.tsx`, `OutputWindowView.tsx`.
  - Controles `src/renderer/components/ui/`: `JogWheel.tsx`, `LedVuMeter.tsx`, `RgbWaveformStrip.tsx`, `RotaryKnob.tsx`.

## 4. Reglas de Diseño Visual (UI)
- **Esquema Obsidian / Hardware:** Fondo base `#08090C`, paneles `#0F1117`, controles `#151821`/`#1C202B` con divisores hairline `border-white/[0.06]`, acentos Deck A `#0EA5E9`, Deck B `#F59E0B`, En vivo `#10B981` (sin violetas/morados).
- **Cero emojis:** Prohibido usar emojis Unicode en la interfaz; utilizar únicamente íconos SVG de `lucide-react` y caracteres Unicode simples de dirección.
- **Disposición actual (`v2.2.0`):** Barra superior con selector global de calidad, píldora **Siguiente**, estado P2, toggle **KEYS** y botones para **Marcos** (drawer), **Guía** (modal) y **Ajustes** (drawer). Fila central de 3 columnas simétricas (`DeckFxSamplerModule A` | `MixerCenter` | `DeckFxSamplerModule B`). El área inferior conserva 4 pestañas (`Buscador YouTube`, `Biblioteca Local`, `Cola`, `Historial & Crates`).

## 5. Comandos Clave (PowerShell en Windows)
> **Nota:** En Windows PowerShell 5.1 no usar `&&`; separar comandos con `;` y comprobar `$LASTEXITCODE`.

```powershell
# Desarrollo con Electron + Vite
npm run dev

# Verificación de tipos (main/preload + renderer)
npm run typecheck

# Compilación de producción (out/main, out/preload, out/renderer)
npm run build

# Pruebas unitarias (26 archivos / 42 tests)
npx vitest run

# Pruebas E2E contra app compilada (out/main/index.js)
npx playwright test tests/e2e/appFlow.spec.ts

# Pruebas E2E contra ejecutable Windows empaquetado
$env:TUBEDECK_E2E_EXE="d:\Trabajos\Pantallas\dist\win-unpacked\TubeDeck VDJ.exe"; npx playwright test tests/e2e/appFlow.spec.ts

# Empaquetado NSIS sin firma de código local (genera dist/TubeDeck VDJ Setup 2.2.0.exe)
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"; npx electron-builder --win nsis
```

## 6. Reglas Críticas y Trampas Conocidas (Pitfalls)
1. **Nunca declarar `__filename` ni `__dirname` a nivel superior en `src/main/**/*.ts`:** `electron-vite` inyecta `const __filename` / `const __dirname` al inicio de `out/main/index.js`; redeclararlos provoca un cierre silencioso al iniciar Electron. Usar `path.dirname(fileURLToPath(import.meta.url))`.
2. **Preload CommonJS:** `electron.vite.config.ts` compila el preload a `out/preload/index.cjs` y `src/main/index.ts` lo carga exactamente como `../preload/index.cjs`.
3. **Cero descargas de media al disco por streaming:** `tests/e2e/appFlow.spec.ts` falla si encuentra archivos `.mp4`, `.webm`, `.m4a` o `.mp3` dentro de `userData`. Solo la herramienta explícita de descarga por lotes en historial guarda archivos en la carpeta destino elegida por el usuario.
4. **Release CI en GitHub Actions:** `.github/workflows/release.yml` descarga automáticamente `yt-dlp.exe` en `resources/bin/` y ejecuta `vitest`, `typecheck`, `build` y `electron-builder --win nsis --publish always` al hacer push de cualquier tag `v*`.

