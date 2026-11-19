# TubeDeck VDJ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la aplicación de escritorio **TubeDeck VDJ** (Windows 10/11, extensible a macOS/Linux) que replica la mezcla audiovisual de VirtualDJ Video usando videos de YouTube en streaming directo por RAM sin descargas al disco, doble pantalla real (Cabina + Salida Master limpia), DSP real por deck, pre-escucha en audífonos, Automix, historial SQLite y soporte MIDI.

**Architecture:** Proceso principal Electron (Node.js) encargado de búsqueda Innertube (`youtubei.js`), resolución de streams (`yt-dlp` + fallback), proxy HTTP `Range` aislado en RAM (`127.0.0.1:0` con token de sesión), gestión de monitores externos (`electron.screen`) y persistencia de metadatos/sesiones (`sql.js` SQLite WASM con guardado atómico). El renderer principal (React 19 + TypeScript + Zustand) ejecuta un único `AudioContext` con doble salida hardware (`setSinkId` + Mono Split), un compositor WebGL2 a 60 fps para transiciones/Video FX/overlays y refleja el canvas Master hacia la Pantalla 2 mediante `masterCanvas.captureStream(60)` sin decodificación ni ancho de banda duplicados.

**Tech Stack:** Electron 34+, Node.js 20+, `electron-vite`, React 19, TypeScript 5 (`strict: true`), Tailwind CSS v4, Zustand, `sql.js` (SQLite WASM), `youtubei.js`, `yt-dlp` (binario gestionado en `userData/bin/`), Web Audio API, WebGL2, Web MIDI API, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-youtube-vdj-design.md`

---

## Global Constraints

1. **Sistema operativo principal:** Windows 10/11 (x64), con arquitectura portable a macOS y Linux.
2. **Stack tecnológico:** Node.js 20+, Electron 34+, Vite + `electron-vite`, React 19, TypeScript 5 (`strict: true`), Tailwind CSS v4, Zustand, `sql.js`, `youtubei.js`, binario `yt-dlp` gestionado en `app.getPath('userData')/bin/`.
3. **Cero archivos multimedia en disco:** Prohibido escribir archivos `.mp4`, `.webm`, `.m4a`, `.mp3` o cachés temporales de media en disco. Todo stream de audio/video fluye por RAM vía `RamStreamProxy`. SQLite (`tubedeck.db` en `userData`) guarda únicamente metadatos, cues, waveform overview JSON, BPM, historial, crates, perfiles MIDI y preferencias.
4. **Aislamiento de red local:** El proxy local debe escuchar exclusivamente en `127.0.0.1` usando puerto efímero (`:0`) y validar un `token` aleatorio generado al arrancar la app en cada solicitud HTTP. Nunca escuchar en `0.0.0.0`.
5. **Seguridad Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en ventanas renderer, `webSecurity: true`, CSP estricta (`default-src 'self'`), validación de entradas IPC y retorno estandarizado `{ success: true, data } | { success: false, error }` a través de `contextBridge`.
6. **Rendimiento UI 60 fps:** Los medidores VU, playhead de waveforms, análisis FFT y renderizado WebGL2 operan sobre `requestAnimationFrame` y refs/canvas directos sin disparar re-renders de React a 60 Hz.

---

## Review Focus

1. **Expiración `403`/`410` o corte de CDN en `googlevideo.com`:** `RamStreamProxy` debe invalidar la entrada caducada vía `StreamResolverService.invalidateAndResolve(videoId)` una sola vez por petición y reanudar el `Range` sin dejar el deck mudo (cubierto en **Task 5**).
2. **Desincronización A/V (`> 40 ms`) en streams `dash-split` tras Cue/Loop/Seek:** `DualDeckMediaSync` debe pausar brevemente hasta `canplay` en ambos elementos, replicar `playbackRate`/`preservesPitch` y corregir drift solo si `|v - a| > 0.04` con cooldown de `250 ms` (cubierto en **Task 6**).
3. **Desconexión HDMI en vivo de Pantalla 2:** `DisplayWindowManager` debe manejar `display-removed`, cerrar/desacoplar la ventana de salida limpiamente sin lanzar excepciones ni interrumpir audio/video en la cabina (cubierto en **Task 8**).
4. **Desconexión de tarjeta de audio / audífonos USB y Mono Split:** `AudioOutputRouter` debe escuchar `devicechange`, revertir con seguridad a `'default'` ante desconexión y soportar ruteo `Mono Split` (`L = Master`, `R = Cue`) sin `InvalidStateError` (cubierto en **Task 13**).
5. **Gap de buffering o video bloqueado durante Automix:** `QueueAndAutomixEngine` debe pre-cargar `30 s` antes del fin de pista y saltar automáticamente al siguiente track válido cuando un video falle al resolver o cargar (cubierto en **Task 16**).

---

## Mapa de Estructura de Archivos

```text
d:\Trabajos\Pantallas\
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── vitest.config.ts
├── playwright.config.ts
├── electron-builder.yml
├── src/
│   ├── shared/
│   │   ├── types.ts                  # Result<T>, DeckId, YouTubeTrack, ResolvedStream, HotCue, LoopState, HistoryEntry, Crate, MidiMapping, DisplayInfo
│   │   └── ipcChannels.ts            # Nombres y contratos tipados IPC
│   ├── main/
│   │   ├── index.ts                  # Bootstrap app, CSP headers, lifecycle
│   │   ├── ipc/
│   │   │   └── registerHandlers.ts   # Registro centralizado ipcMain.handle con validación Zod/manual
│   │   ├── services/
│   │   │   ├── DatabaseService.ts    # SQLite WASM (sql.js) + migraciones versionadas + guardado atómico
│   │   │   ├── YouTubeSearchService.ts
│   │   │   ├── YtDlpBinaryManager.ts # Gestión binario yt-dlp en userData/bin
│   │   │   ├── StreamResolverService.ts
│   │   │   ├── RamStreamProxy.ts     # HTTP Range 206 proxy en 127.0.0.1:0 + token
│   │   │   ├── DisplayWindowManager.ts
│   │   │   └── SessionExporter.ts    # Exportación JSON / CSV / M3U
│   ├── preload/
│   │   ├── index.ts                  # contextBridge.exposeInMainWorld('tubedeckAPI', ...)
│   │   └── index.d.ts
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx                   # Switcher Cabina vs Ventana Salida (?role=output)
│       ├── styles/index.css          # Tailwind v4 + tokens cabina oscura
│       ├── audio/
│       │   ├── DualDeckMediaSync.ts  # Reloj maestro DASH + drift correction
│       │   ├── AudioDspEngine.ts     # Single AudioContext + 3-band EQ + Kill + Filter + Crossfader + Limiter + VU
│       │   └── AudioOutputRouter.ts  # setSinkId Master/Cue + devicechange + Mono Split
│       ├── video/
│       │   ├── transitions.glsl.ts   # 7 shaders de transición
│       │   ├── effects.glsl.ts       # 7 shaders Video FX + audio-reactive
│       │   ├── WebGLVideoCompositor.ts
│       │   ├── VideoFxPipeline.ts
│       │   └── OverlayCompositor.ts  # Logo, Marquee, OSD 6s, Webcam PiP
│       ├── dj/
│       │   ├── CueLoopTempoController.ts
│       │   ├── BpmAndWaveformEngine.ts
│       │   └── QueueAndAutomixEngine.ts
│       ├── controllers/
│       │   ├── HotkeyManager.ts
│       │   └── MidiLearnEngine.ts
│       ├── store/
│       │   ├── useDeckStore.ts
│       │   ├── useMixerStore.ts
│       │   ├── useLibraryStore.ts
│       │   └── useSettingsStore.ts
│       └── components/
│           ├── OutputWindowView.tsx
│           ├── DeckPanel.tsx
│           ├── VideoPreviewBar.tsx
│           ├── MixerCenter.tsx
│           ├── OverlayControls.tsx
│           ├── SearchBrowserTab.tsx
│           ├── QueueTab.tsx
│           ├── HistoryAndCratesTab.tsx
│           ├── SettingsTab.tsx
│           └── ui/
│               ├── RotaryKnob.tsx
│               └── LedVuMeter.tsx
└── tests/
    ├── unit/...
    └── e2e/...
```

---

## Fase 1: Fundación, Streaming en RAM y Motor Audio DSP v1

### Task 1: Inicialización de Repo Git, Electron-Vite, TypeScript, Tailwind v4 y Vitest

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `src/shared/types.ts`, `src/shared/ipcChannels.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/index.css`
- Test: `tests/unit/shared/ipcContract.test.ts`

**Interfaces:**
- Produces:
  - `export type Result<T> = { success: true; data: T } | { success: false; error: string };`
  - `export type DeckId = 'A' | 'B';`
  - `export interface YouTubeTrack { videoId: string; title: string; channel: string; durationSec: number; thumbnailUrl: string; isLive: boolean; }`
  - `export type StreamMode = 'muxed' | 'dash-split';`
  - `export interface ResolvedStream { videoId: string; mode: StreamMode; muxedUrl?: string; videoUrl?: string; audioUrl?: string; expiresAtMs: number; mimeTypes: { muxed?: string; video?: string; audio?: string }; }`
  - `export interface HotCue { slot: number; timeSec: number; label: string; color: string; }`
  - `export interface LoopState { active: boolean; inSec: number; outSec: number; beats?: number; }`
  - `export interface DisplayInfo { id: number; label: string; bounds: { x: number; y: number; width: number; height: number }; isPrimary: boolean; }`
  - `export const IPC_CHANNELS = { ... } as const;`

- [ ] **Step 1: Inicializar Git y escribir el test inicial del contrato compartido**

En `tests/unit/shared/ipcContract.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipcChannels';

describe('IPC_CHANNELS', () => {
  it('exposes unique channel names for all core namespaces', () => {
    const values = Object.values(IPC_CHANNELS);
    expect(values.length).toBeGreaterThanOrEqual(12);
    expect(new Set(values).size).toBe(values.length);
  });
});
```

- [ ] **Step 2: Instalar dependencias base y ejecutar el test para confirmar fallo**

Inicializar `git init` y `package.json` con `electron`, `electron-vite`, `vite`, `react`, `react-dom`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `zustand`, `lucide-react`, `zod`, `vitest`, `@vitest/coverage-v8`, `sql.js`, `youtubei.js` (y `@types/...`). Ejecutar `npx vitest run tests/unit/shared/ipcContract.test.ts`.
Expected: FAIL porque `src/shared/ipcChannels.ts` aún no existe.

- [ ] **Step 3: Crear tipos compartidos, shell seguro Electron + CSP y arranque mínimo React**

Implementar `src/shared/types.ts`, `src/shared/ipcChannels.ts`, `src/main/index.ts` (con `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `default-src 'self'; media-src 'self' http://127.0.0.1:* blob:; img-src 'self' https://i.ytimg.com https://*.ggpht.com data: blob:`), `src/preload/index.ts` y vista base en `src/renderer/App.tsx`.

- [ ] **Step 4: Verificar compilación y test en verde**

Run: `npx vitest run tests/unit/shared/ipcContract.test.ts && npm run typecheck`
Expected: PASS (1 test passed, 0 errores TypeScript).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap electron-vite react typescript project and shared contracts"
```

---

### Task 2: `DatabaseService` (`sql.js` SQLite WASM + Migraciones y Metadatos)

**Files:**
- Create: `src/main/services/DatabaseService.ts`
- Test: `tests/unit/main/databaseService.test.ts`

**Interfaces:**
- Consumes: `HotCue`, `LoopState` de `src/shared/types.ts`
- Produces:
  - `export interface HistoryEntryInput { sessionId: string; deck: 'A' | 'B'; videoId: string; title: string; channel: string; durationSec: number; playedAt: number; endedAt?: number; bpm?: number; transitionUsed?: string; }`
  - `export interface TrackMetadataRecord { videoId: string; title: string; channel: string; durationSec: number; thumbnailUrl: string; bpm: number | null; beatOffsetSec: number | null; gainDb: number; hotCues: HotCue[]; loop: LoopState | null; waveformPeaks: number[] | null; playCount: number; }`
  - `export class DatabaseService { constructor(dbPath: string); init(): Promise<void>; migrate(): void; queryAll<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T[]; queryOne<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T | null; run(sql: string, params?: unknown[]): void; save(): void; getSetting<T>(key: string, fallback: T): T; setSetting<T>(key: string, value: T): void; upsertTrackMetadata(track: Partial<TrackMetadataRecord> & { videoId: string }): TrackMetadataRecord; getTrackMetadata(videoId: string): TrackMetadataRecord | null; close(): void; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/main/databaseService.test.ts`: probar creación de las 7 tablas (`sessions`, `history_entries`, `track_metadata`, `crates`, `crate_tracks`, `midi_mappings`, `app_settings`) sobre `:memory:`, activación de `foreign_keys`, persistencia y lectura de `hotCues` JSON en `upsertTrackMetadata`, `getSetting`/`setSetting` y persistencia real en archivo temporal en disco al cerrar y reabrir.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/databaseService.test.ts`
Expected: FAIL (`Cannot find module .../DatabaseService`).

- [ ] **Step 3: Implement `DatabaseService` en `src/main/services/DatabaseService.ts`**

Inicializar `sql.js` localizando `sql-wasm.wasm` tanto en desarrollo/Vitest como empaquetado (`process.resourcesPath`), ejecutar `PRAGMA foreign_keys = ON`, migración transaccional `v1` con tabla `schema_version` y escritura atómica (`<dbPath>.tmp` -> `renameSync`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/databaseService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/DatabaseService.ts tests/unit/main/databaseService.test.ts
git commit -m "feat: add sql.js DatabaseService with atomic persistence and schema migrations"
```

---

### Task 3: `YouTubeSearchService` (Innertube sin API Key + Playlists)

**Files:**
- Create: `src/main/services/YouTubeSearchService.ts`
- Test: `tests/unit/main/youtubeSearchService.test.ts`

**Interfaces:**
- Consumes: `YouTubeTrack`
- Produces:
  - `export interface SearchPage { items: YouTubeTrack[]; hasMore: boolean; }`
  - `export class YouTubeSearchService { search(query: string): Promise<SearchPage>; nextPage(): Promise<SearchPage>; getSuggestions(query: string): Promise<string[]>; getPlaylistTracks(urlOrId: string): Promise<YouTubeTrack[]>; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/main/youtubeSearchService.test.ts` (inyectando cliente Innertube mockeado en constructor opcional para pruebas unitarias deterministas): verificar normalización de `YouTubeTrack`, filtrado estricto de items `isLive === true` o `durationSec <= 0`, extracción de `playlistId` desde URL completa (`https://www.youtube.com/playlist?list=PL123`) y paginación `nextPage()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/youtubeSearchService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `YouTubeSearchService` en `src/main/services/YouTubeSearchService.ts`**

Inicializar `Innertube.create()` de forma perezosa y reutilizable, mapear miniaturas a mayor resolución disponible (`i.ytimg.com`), filtrar livestreams y manejar playlists vía `yt.getPlaylist(listId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/youtubeSearchService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/YouTubeSearchService.ts tests/unit/main/youtubeSearchService.test.ts
git commit -m "feat: implement YouTubeSearchService with Innertube search and playlists"
```

---

### Task 4: `YtDlpBinaryManager` y `StreamResolverService` (Resolución en RAM + TTL + 403 Refresh)

**Files:**
- Create: `src/main/services/YtDlpBinaryManager.ts`, `src/main/services/StreamResolverService.ts`
- Test: `tests/unit/main/streamResolverService.test.ts`

**Interfaces:**
- Consumes: `ResolvedStream`, `StreamMode`
- Produces:
  - `export class YtDlpBinaryManager { constructor(binDir: string); getBinaryPath(): string; ensureInstalled(): Promise<string>; }`
  - `export class StreamResolverService { resolve(videoId: string): Promise<ResolvedStream>; invalidateAndResolve(videoId: string): Promise<ResolvedStream>; clearCache(): void; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/main/streamResolverService.test.ts`:
1. Dado JSON de salida de `yt-dlp -J` con formato muxed `mp4` `<= 1080p` (`acodec !== 'none' && vcodec !== 'none'`), devuelve `mode: 'muxed'` y calcula `expiresAtMs` desde el query param `expire=`.
2. Dado JSON solo con streams adaptive DASH (`<= 1080p`), selecciona mejor video `mp4`/`webm` + mejor audio `m4a`/`opus` y devuelve `mode: 'dash-split'`.
3. Reutiliza caché en memoria mientras `Date.now() < expiresAtMs - 60_000`; tras `invalidateAndResolve(videoId)`, fuerza nueva extracción; si `yt-dlp` falla, recurre al fallback `youtubei.js` mockeado.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/streamResolverService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `YtDlpBinaryManager` y `StreamResolverService`**

`YtDlpBinaryManager` busca primero binario en `PATH` o `userData/bin/yt-dlp.exe` y descarga desde GitHub Releases oficial (`yt-dlp/yt-dlp`) verificando archivo no vacío (sin ejecutar shell arbitrario; `execFile` directo sin `shell: true`). `StreamResolverService` ejecuta `yt-dlp -J --no-playlist --no-warnings https://www.youtube.com/watch?v=${videoId}` con timeout `12000ms` y caché LRU en RAM (máximo 100 entradas).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/streamResolverService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/YtDlpBinaryManager.ts src/main/services/StreamResolverService.ts tests/unit/main/streamResolverService.test.ts
git commit -m "feat: add YtDlpBinaryManager and StreamResolverService with TTL cache"
```

---

### Task 5: `RamStreamProxy` (HTTP `206` en RAM, `127.0.0.1:0`, Token y Renovación `403`)

**Files:**
- Create: `src/main/services/RamStreamProxy.ts`
- Test: `tests/unit/main/ramStreamProxy.test.ts`

**Interfaces:**
- Consumes: `StreamResolverService`, `ResolvedStream`
- Produces:
  - `export class RamStreamProxy { constructor(resolver: StreamResolverService); start(): Promise<{ port: number; token: string }>; buildLocalUrl(videoId: string, role: 'muxed' | 'video' | 'audio'): string; stop(): Promise<void>; }`

- [ ] **Step 1: Write the failing test (incluye caso Review Focus #1)**

En `tests/unit/main/ramStreamProxy.test.ts` (levantando servidor HTTP remoto mock en `127.0.0.1:0`):
1. `proxy.start()` enlaza estrictamente en `127.0.0.1` y rechaza con `401` si falta `?token=` o es incorrecto.
2. Petición con `Range: bytes=0-9` devuelve `206 Partial Content`, `Content-Range`, `Access-Control-Allow-Origin: *` y los 10 bytes exactos sin crear archivos en disco.
3. **Test Review Focus #1 (`403` auto-refresh):** Cuando el upstream mock responde `403` la primera vez para una URL caducada, `RamStreamProxy` llama a `resolver.invalidateAndResolve(videoId)` exactamente 1 vez, obtiene la nueva URL válida y devuelve `206` con los bytes correctos al cliente.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/ramStreamProxy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `RamStreamProxy` en `src/main/services/RamStreamProxy.ts`**

Usar `http.createServer` en `127.0.0.1:0`, token generado con `crypto.randomBytes(24).toString('hex')`, `fetch` con `AbortController` ligado a `req.on('close', ...)` y reintento único ante `403`/`410`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/ramStreamProxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/RamStreamProxy.ts tests/unit/main/ramStreamProxy.test.ts
git commit -m "feat: implement RamStreamProxy on 127.0.0.1 with Range streaming and 403 recovery"
```

---

### Task 6: `DualDeckMediaSync` (Sincronización DASH Audio-Video y Drift Correction)

**Files:**
- Create: `src/renderer/audio/DualDeckMediaSync.ts`
- Test: `tests/unit/renderer/dualDeckMediaSync.test.ts`

**Interfaces:**
- Consumes: `DeckId`, `ResolvedStream`
- Produces:
  - `export interface DeckMediaElements { audioSourceEl: HTMLMediaElement; videoEl: HTMLVideoElement; }`
  - `export class DualDeckMediaSync { constructor(deckId: DeckId); load(streamUrls: { mode: 'muxed' | 'dash-split'; muxedUrl?: string; videoUrl?: string; audioUrl?: string }): Promise<DeckMediaElements>; play(): Promise<void>; pause(): void; seek(timeSec: number): Promise<void>; setPlaybackRate(rate: number, keyLock: boolean): void; syncDrift(nowMs?: number): boolean; getAudioElement(): HTMLMediaElement; getVideoElement(): HTMLVideoElement; dispose(): void; }`

- [ ] **Step 1: Write the failing test (incluye caso Review Focus #2)**

En `tests/unit/renderer/dualDeckMediaSync.test.ts` (con elementos media mockeados en JSDOM/fake timers):
1. En modo `dash-split`, `audioEl` y `videoEl` reciben URLs separadas, `videoEl.muted === true`, y `setPlaybackRate(1.06, true)` aplica `playbackRate = 1.06` y `preservesPitch = true` en ambos.
2. **Test Review Focus #2 (drift correction & seek sync):** Si `|video.currentTime - audio.currentTime| > 0.04` (p. ej. `0.09s`), `syncDrift(1000)` ajusta `video.currentTime = audio.currentTime` y retorna `true`; una segunda llamada dentro de los `250 ms` (`syncDrift(1100)`) no vuelve a saltar (`false`); tras `seek(45.5)` ambos elementos quedan en `45.5` antes de resolver.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/dualDeckMediaSync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `DualDeckMediaSync` en `src/renderer/audio/DualDeckMediaSync.ts`**

Asegurar `crossOrigin = 'anonymous'` antes de asignar `.src`, limpieza completa al recargar sin crear nuevos elementos `<video>`/`<audio>` si ya están enlazados al `AudioDspEngine` (reemplazar `src` + `load()` para reutilizar el mismo `MediaElementAudioSourceNode`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/dualDeckMediaSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio/DualDeckMediaSync.ts tests/unit/renderer/dualDeckMediaSync.test.ts
git commit -m "feat: add DualDeckMediaSync for muxed and DASH A/V sync"
```

---

### Task 7: `AudioDspEngine` + Conexión IPC y Cabina Mínima Reproducible (Hito Fase 1)

**Files:**
- Create: `src/renderer/audio/AudioDspEngine.ts`, `src/main/ipc/registerHandlers.ts`, `src/renderer/store/useDeckStore.ts`, `src/renderer/store/useMixerStore.ts`, `src/renderer/components/SearchBrowserTab.tsx`, `src/renderer/components/DeckPanel.tsx`, `src/renderer/components/MixerCenter.tsx`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/App.tsx`
- Test: `tests/unit/renderer/audioDspEngine.test.ts`

**Interfaces:**
- Consumes: `DeckId`, `YouTubeSearchService`, `StreamResolverService`, `RamStreamProxy`, `DatabaseService`
- Produces:
  - `export type CrossfaderCurve = 'equal-power' | 'linear' | 'scratch';`
  - `export type EqBand = 'low' | 'mid' | 'high';`
  - `export class AudioDspEngine { constructor(contextFactory?: () => AudioContext); init(): Promise<void>; attachDeckElement(deck: DeckId, el: HTMLMediaElement): void; setTrim(deck: DeckId, value: number): void; setEq(deck: DeckId, band: EqBand, db: number): void; setEqKill(deck: DeckId, band: EqBand, kill: boolean): void; setColorFilter(deck: DeckId, amount: number): void; setChannelFader(deck: DeckId, level: number): void; setCrossfader(pos: number, curve: CrossfaderCurve): void; setCueEnabled(deck: DeckId, enabled: boolean): void; setCueMix(blend: number): void; setCueGain(level: number): void; setMasterGain(level: number): void; readVuLevel(deck: DeckId | 'MASTER'): number; getDeckAnalyser(deck: DeckId): AnalyserNode | null; getMasterAnalyser(): AnalyserNode | null; getOutputDestinations(): { masterDest: MediaStreamAudioDestinationNode; cueDest: MediaStreamAudioDestinationNode; context: AudioContext }; dispose(): Promise<void>; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/audioDspEngine.test.ts` (con mock completo de `AudioContext` / `BiquadFilterNode` / `GainNode` / `DynamicsCompressorNode`):
1. `attachDeckElement('A', el)` crea un único `MediaElementAudioSourceNode` y no vuelve a crear otro si se llama de nuevo con el mismo elemento.
2. `setEq('A', 'low', -12)` fija `-12` dB; `setEqKill('A', 'low', true)` fuerza `-60` dB y `setEqKill('A', 'low', false)` restaura `-12` dB.
3. `setColorFilter('A', -0.5)` configura `lowpass`, `setColorFilter('A', 0.5)` configura `highpass`, y `0` configura `allpass`.
4. `setCrossfader(0.5, 'equal-power')` entrega ganancia `~0.707` (`cos(pi/4)` / `sin(pi/4)`) en ambos decks; `setCrossfader(0.5, 'scratch')` entrega `1.0` en ambos hasta los extremos `0..0.1` y `0.9..1.0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/audioDspEngine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `AudioDspEngine`, handlers IPC Fase 1 y Cabina v1 mínima**

Registrar en `registerHandlers.ts` los canales de búsqueda YouTube, resolución de stream vía `RamStreamProxy` y acceso a metadatos SQLite. Conectar `SearchBrowserTab`, `DeckPanel` (Play/Pause, seek, video preview) y `MixerCenter` (EQ, Kill, Filter, Faders, Crossfader) para que el Hito Fase 1 sea 100% ejecutable y audible.

- [ ] **Step 4: Run tests and typecheck to verify Phase 1**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (todos los tests de Fase 1 en verde).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: implement AudioDspEngine, IPC handlers and runnable Phase 1 dual-deck cabin"
```

---

## Fase 2: Motor de Video Dual-Screen (WebGL2, Transiciones, FX y Overlays)

### Task 8: `DisplayWindowManager` (Multi-Monitor + `window.open` Interception + Hot-Plug HDMI)

**Files:**
- Create: `src/main/services/DisplayWindowManager.ts`
- Modify: `src/main/index.ts`, `src/main/ipc/registerHandlers.ts`, `src/preload/index.ts`
- Test: `tests/unit/main/displayWindowManager.test.ts`

**Interfaces:**
- Consumes: `DisplayInfo`
- Produces:
  - `export class DisplayWindowManager { listDisplays(): DisplayInfo[]; getPreferredExternalDisplayId(): number | null; configureWindowOpen(mainWindow: BrowserWindow, onDisplaysChanged: (displays: DisplayInfo[]) => void): void; moveOutputToDisplay(displayId: number, fullscreen: boolean): boolean; closeOutputWindow(): void; isOutputOpen(): boolean; }`

- [ ] **Step 1: Write the failing test (incluye caso Review Focus #3)**

En `tests/unit/main/displayWindowManager.test.ts` (mockeando `screen` y `BrowserWindow`):
1. `getPreferredExternalDisplayId()` selecciona el primer monitor donde `!isPrimary`, o `null` si solo hay uno.
2. **Test Review Focus #3 (hot-plug HDMI disconnect):** Al disparar el evento `display-removed` con el `displayId` donde estaba la salida externa, `DisplayWindowManager` cierra/desacopla limpiamente la ventana hija sin lanzar excepciones, emite la nueva lista actualizada a `onDisplaysChanged` y mantiene la ventana principal intacta (`isOutputOpen() === false`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/displayWindowManager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `DisplayWindowManager` y conectar eventos IPC**

Configurar `mainWindow.webContents.setWindowOpenHandler` para permitir únicamente URLs que terminen en `?role=output` (o `#/output`), retornando `{ action: 'allow', overrideBrowserWindowOptions: { frame: false, backgroundColor: '#000000', autoHideMenuBar: true, x, y, width, height, fullscreen, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/displayWindowManager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/DisplayWindowManager.ts src/main/index.ts src/main/ipc/registerHandlers.ts src/preload/index.ts tests/unit/main/displayWindowManager.test.ts
git commit -m "feat: add DisplayWindowManager with multi-monitor fullscreen and HDMI hot-plug handling"
```

---

### Task 9: `WebGLVideoCompositor` (3 Modos Video Crossfader + 7 Transiciones GLSL)

**Files:**
- Create: `src/renderer/video/transitions.glsl.ts`, `src/renderer/video/WebGLVideoCompositor.ts`
- Test: `tests/unit/renderer/webglVideoCompositor.test.ts`

**Interfaces:**
- Produces:
  - `export type VideoTransitionId = 'dissolve' | 'wipe-h' | 'wipe-v' | 'wipe-diag' | 'zoom-push' | 'circle-iris' | 'luma-fade' | 'curtain-split' | 'slide';`
  - `export type VideoCrossfaderMode = 'linked' | 'independent' | 'auto-timed';`
  - `export interface CompositorFrameState { mix: number; transition: VideoTransitionId; videoA: HTMLVideoElement | null; videoB: HTMLVideoElement | null; overlayCanvas: HTMLCanvasElement | null; }`
  - `export class WebGLVideoCompositor { constructor(canvas: HTMLCanvasElement); init(): boolean; setResolution(width: number, height: number): void; renderFrame(state: CompositorFrameState): void; stepAutoTransition(progress01: number, fromSide: 'A' | 'B'): number; captureOutputStream(fps?: number): MediaStream; dispose(): void; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/webglVideoCompositor.test.ts`:
1. Verifica que `TRANSITION_SHADERS` compile fragmentos GLSL válidos (`#version 300 es`) para las 7 familias de transición (`dissolve`, `wipe-*`, `zoom-push`, `circle-iris`, `luma-fade`, `curtain-split`, `slide`) y que el uniform `u_mix` quede acotado a `[0, 1]`.
2. `stepAutoTransition(0.5, 'A')` (de A hacia B) devuelve `0.5` con easing suave (`smoothstep`), y `stepAutoTransition(1, 'B')` (de B hacia A) devuelve `0`.
3. `renderFrame()` con un mock de `WebGL2RenderingContext` vincula texturas de Deck A, Deck B y Overlay sin lanzar errores cuando alguno es `null` (renderiza negro limpio).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/webglVideoCompositor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `transitions.glsl.ts` y `WebGLVideoCompositor.ts`**

Calcular `aspect-fit` (letterbox/pillarbox sin estirar videos verticales ni panorámicos) dentro del shader/UV transform, manejar contextos sin video cargado mostrando fondo negro o shader audio-reactivo, y exponer `captureStream(60)` para Pantalla 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/webglVideoCompositor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/video/transitions.glsl.ts src/renderer/video/WebGLVideoCompositor.ts tests/unit/renderer/webglVideoCompositor.test.ts
git commit -m "feat: implement WebGLVideoCompositor with 7 GLSL transitions and aspect-fit"
```

---

### Task 10: `VideoFxPipeline` (7 Video FX GLSL + BPM Strobe + Audio-Reactive Shader)

**Files:**
- Create: `src/renderer/video/effects.glsl.ts`, `src/renderer/video/VideoFxPipeline.ts`
- Modify: `src/renderer/video/WebGLVideoCompositor.ts`
- Test: `tests/unit/renderer/videoFxPipeline.test.ts`

**Interfaces:**
- Consumes: `WebGLVideoCompositor`
- Produces:
  - `export type VideoFxId = 'blur' | 'strobe' | 'mirror' | 'hue-tint' | 'bw-contrast' | 'pixelate' | 'audio-shader';`
  - `export interface DeckFxState { enabled: Record<VideoFxId, boolean>; intensity: Record<VideoFxId, number>; mirrorMode: 'h' | 'v' | 'quad'; }`
  - `export class VideoFxPipeline { computeStrobeAlpha(timeSec: number, bpm: number, intensity: number): number; extractAudioBands(analyser: AnalyserNode | null): { low: number; mid: number; high: number }; getFxUniforms(state: DeckFxState, bands: { low: number; mid: number; high: number }, timeSec: number, bpm: number): Record<string, number>; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/videoFxPipeline.test.ts`:
1. `computeStrobeAlpha(0, 120, 1.0)` vs `computeStrobeAlpha(0.25, 120, 1.0)` alterna ciclo sincronizado a 120 BPM (`2 beats/s`).
2. `extractAudioBands(mockAnalyser)` normaliza `low` (`20-250Hz`), `mid` (`250-4000Hz`) y `high` (`4000Hz+`) en `[0, 1]`; devuelve `{ low: 0, mid: 0, high: 0 }` si `analyser` es `null`.
3. `getFxUniforms` incluye las 7 banderas/intensidades GLSL esperadas para aplicar por Deck (A/B) y Master.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/videoFxPipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `effects.glsl.ts` y `VideoFxPipeline.ts` e integrar pases FBO en `WebGLVideoCompositor`**

Agregar pass de post-procesado para Deck A, Deck B y Master usando Framebuffer Objects (FBOs) reutilizables sin asignaciones de memoria por frame.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/videoFxPipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/video/effects.glsl.ts src/renderer/video/VideoFxPipeline.ts src/renderer/video/WebGLVideoCompositor.ts tests/unit/renderer/videoFxPipeline.test.ts
git commit -m "feat: add VideoFxPipeline with 7 GPU effects, BPM strobe and audio-reactive shader"
```

---

### Task 11: `OverlayCompositor` (Logo, Marquee/Texto, OSD Automático y Webcam PiP)

**Files:**
- Create: `src/renderer/video/OverlayCompositor.ts`, `src/renderer/components/OverlayControls.tsx`
- Test: `tests/unit/renderer/overlayCompositor.test.ts`

**Interfaces:**
- Produces:
  - `export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';`
  - `export interface OverlayConfig { logo: { enabled: boolean; dataUrl: string | null; corner: OverlayCorner; scale: number; opacity: number }; marquee: { enabled: boolean; text: string; speedPxPerSec: number; color: string; bgOpacity: number; position: 'top' | 'bottom' }; osd: { enabled: boolean; durationMs: number }; webcam: { enabled: boolean; deviceId: string; corner: OverlayCorner; scale: number; opacity: number }; }`
  - `export class OverlayCompositor { constructor(width: number, height: number); triggerTrackOsd(title: string, channel: string, nowMs?: number): void; updateConfig(config: OverlayConfig): void; render(ctx2d: CanvasRenderingContext2D, nowMs: number, webcamVideo?: HTMLVideoElement | null): boolean; getCanvas(): HTMLCanvasElement; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/overlayCompositor.test.ts`:
1. `triggerTrackOsd('Track 1', 'Artist', 1000)` hace que `render(ctx, 3000)` dibuje el OSD (y devuelva `true` indicando capa sucia/activa), y `render(ctx, 8000)` tras los `6000 ms` desvanece y oculta el OSD.
2. Con `marquee.enabled = true`, el desplazamiento horizontal avanza proporcionalmente a `speedPxPerSec * deltaSec` haciendo wrap limpio al cruzar el ancho del canvas.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/overlayCompositor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `OverlayCompositor` y `OverlayControls`**

Rasterizar solo cuando hay animación activa (marquee, OSD visible o webcam habilitada) para ahorrar ciclos GPU.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/overlayCompositor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/video/OverlayCompositor.ts src/renderer/components/OverlayControls.tsx tests/unit/renderer/overlayCompositor.test.ts
git commit -m "feat: implement OverlayCompositor for logo, marquee, track OSD and webcam PiP"
```

---

### Task 12: Vista Espejo Pantalla 2 (`OutputWindowView`), `VideoPreviewBar` y Validación Dual-Screen

**Files:**
- Create: `src/renderer/components/OutputWindowView.tsx`, `src/renderer/components/VideoPreviewBar.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/MixerCenter.tsx`
- Test: `tests/unit/renderer/outputWindowView.test.tsx`

**Interfaces:**
- Consumes: `WebGLVideoCompositor`, `VideoCrossfaderMode`, `VideoTransitionId`, `DisplayInfo`
- Produces:
  - `<OutputWindowView />` (cuando `window.location.search` contiene `role=output`)
  - `<VideoPreviewBar />` (Preview A | Master Canvas + Controles Transición/FX | Preview B + Botón Pantalla 2 `ON AIR`)

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/outputWindowView.test.tsx`: verificar que `OutputWindowView` renderiza únicamente un elemento `<video>` fullscreen sin controles (`controls === false`), asigna `srcObject` recibido de `window.opener` o callback de stream, y muestra fondo negro limpio sin texto ni marcas cuando aún no hay stream asignado.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/outputWindowView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `OutputWindowView` y `VideoPreviewBar`**

En `App.tsx`, abrir la ventana secundaria vía `window.open(url, 'tubedeck-output')` y transferir `masterCanvas.captureStream(60)` hacia `OutputWindowView` mediante un par local `RTCPeerConnection` (loopback in-memory intercambiando SDP/ICE por `postMessage` o IPC), asignando `pc.ontrack` a `<video srcObject={stream} autoPlay muted />` para evitar límites cross-window de Chromium sobre `MediaStream`. En `VideoPreviewBar`, renderizar Preview A/B ligeros a 30fps en canvas auxiliares y el Master Live Canvas a 60fps con selector de Video Crossfader (`Linked` / `Independent` / `Auto` + botón temporizado `1s/2s/4s/8s`).

- [ ] **Step 4: Run tests and typecheck to verify Phase 2**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/OutputWindowView.tsx src/renderer/components/VideoPreviewBar.tsx src/renderer/App.tsx src/renderer/components/MixerCenter.tsx tests/unit/renderer/outputWindowView.test.tsx
git commit -m "feat: add dual-screen VideoPreviewBar and clean OutputWindowView mirror"
```

---

## Fase 3: Pre-escucha en Audífonos, Controles DJ, BPM/Sync y Automix

### Task 13: `AudioOutputRouter` (`setSinkId` Master/Cue, `devicechange` y Mono Split)

**Files:**
- Create: `src/renderer/audio/AudioOutputRouter.ts`
- Modify: `src/renderer/audio/AudioDspEngine.ts`
- Test: `tests/unit/renderer/audioOutputRouter.test.ts`

**Interfaces:**
- Consumes: `AudioDspEngine`
- Produces:
  - `export interface AudioOutputDevice { deviceId: string; label: string; }`
  - `export class AudioOutputRouter { constructor(dsp: AudioDspEngine); enumerateOutputs(): Promise<AudioOutputDevice[]>; setMasterDevice(deviceId: string): Promise<void>; setCueDevice(deviceId: string): Promise<void>; setMonoSplit(enabled: boolean): void; handleDeviceChange(): Promise<{ masterFallback: boolean; cueFallback: boolean }>; startWatchingDevices(onDisconnect: (info: { masterFallback: boolean; cueFallback: boolean }) => void): () => void; dispose(): void; }`

- [ ] **Step 1: Write the failing test (incluye caso Review Focus #4)**

En `tests/unit/renderer/audioOutputRouter.test.ts`:
1. `setMasterDevice('usb-main')` y `setCueDevice('usb-phones')` invocan `.setSinkId(...)` en los `<audio>` destino correspondientes.
2. **Test Review Focus #4 (desconexión de dispositivo + Mono Split):** Si `enumerateOutputs()` deja de incluir `'usb-phones'`, `handleDeviceChange()` revierte automáticamente `cueDevice` a `'default'`, retorna `{ masterFallback: false, cueFallback: true }` sin lanzar excepción; y `setMonoSplit(true)` activa el nodo `ChannelMergerNode` (Master Mono en Canal 0 / Izquierdo, Cue Mono en Canal 1 / Derecho).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/audioOutputRouter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `AudioOutputRouter` y nodos Mono Split en `AudioDspEngine`**

Agregar `ChannelSplitterNode` y `ChannelMergerNode` con ganancia conmutable para el modo Mono Split dentro del único `AudioContext`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/audioOutputRouter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio/AudioOutputRouter.ts src/renderer/audio/AudioDspEngine.ts tests/unit/renderer/audioOutputRouter.test.ts
git commit -m "feat: add AudioOutputRouter with dual setSinkId, device fallback and Mono Split"
```

---

### Task 14: `CueLoopTempoController` (8 Hot Cues, Loops Manuales/Auto y Pitch/Key Lock)

**Files:**
- Create: `src/renderer/dj/CueLoopTempoController.ts`
- Test: `tests/unit/renderer/cueLoopTempoController.test.ts`

**Interfaces:**
- Consumes: `DeckId`, `HotCue`, `LoopState`, `DualDeckMediaSync`
- Produces:
  - `export class CueLoopTempoController { constructor(deckId: DeckId, media: DualDeckMediaSync, onPersist?: (videoId: string, cues: HotCue[], loop: LoopState | null) => void); loadTrackState(videoId: string, cues: HotCue[], loop: LoopState | null): void; triggerHotCue(slot: number, currentTimeSec: number): Promise<HotCue>; clearHotCue(slot: number): void; getHotCues(): HotCue[]; setLoopIn(timeSec: number): void; setLoopOut(timeSec: number): void; triggerAutoLoop(beats: 0.5 | 1 | 2 | 4 | 8 | 16, currentTimeSec: number, bpm: number): LoopState | null; toggleLoopExit(): void; checkLoopBoundary(currentTimeSec: number): Promise<boolean>; setPitchPercent(percent: number, keyLock: boolean): void; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/cueLoopTempoController.test.ts`:
1. `triggerHotCue(1, 32.5)` cuando el slot `1` está vacío guarda el cue en `32.5` y llama `onPersist`; volver a llamarlo cuando ya existe hace `media.seek(32.5)` y no lo sobrescribe.
2. `triggerAutoLoop(4, 10.0, 120)` calcula exactamente `outSec = 10.0 + 4 * (60 / 120) = 12.0`; `checkLoopBoundary(12.05)` ejecuta `media.seek(10.0)` y devuelve `true`.
3. `setPitchPercent(8, true)` fija `playbackRate = 1.08` y `keyLock = true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/cueLoopTempoController.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `CueLoopTempoController`**

Asignar paleta fija de 8 colores DJ para slots `1..8`, evitar re-disparo múltiple en `checkLoopBoundary` cuando ya hay un seek de loop pendiente.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/cueLoopTempoController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/dj/CueLoopTempoController.ts tests/unit/renderer/cueLoopTempoController.test.ts
git commit -m "feat: implement CueLoopTempoController with 8 Hot Cues, Auto-Loop and Pitch/KeyLock"
```

---

### Task 15: `BpmAndWaveformEngine` (Detección BPM, Tap BPM, Sync y Waveforms)

**Files:**
- Create: `src/renderer/dj/BpmAndWaveformEngine.ts`
- Test: `tests/unit/renderer/bpmAndWaveformEngine.test.ts`

**Interfaces:**
- Produces:
  - `export class BpmAndWaveformEngine { computeWaveformPeaks(channelData: Float32Array, buckets?: number): number[]; detectBpmFromEnergyHistory(energySamples: number[], sampleIntervalSec: number): number | null; recordTap(timestampMs: number): number | null; resetTap(): void; adjustHalfDouble(bpm: number, factor: 0.5 | 2): number; computeSyncPlaybackRate(slaveBpm: number, targetMasterBpm: number): number; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/bpmAndWaveformEngine.test.ts`:
1. `recordTap` con 4 taps espaciados a `500 ms` (`0, 500, 1000, 1500`) devuelve `120` BPM.
2. `detectBpmFromEnergyHistory` con picos sintéticos periódicos cada `0.5 s` (`sampleIntervalSec = 0.02`) estima BPM dentro de `[118, 122]`.
3. `computeSyncPlaybackRate(100, 125)` devuelve `1.25` (y acota fuera de rango extremo a `[0.5, 1.5]`).
4. `computeWaveformPeaks` normaliza `buckets = 200` valores en `[0, 1]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/bpmAndWaveformEngine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `BpmAndWaveformEngine`**

Usar autocorrelación normalizada en rango musical `70..180 BPM` para `detectBpmFromEnergyHistory` y promedio móvil de los últimos 6 intervalos válidos para `Tap BPM` (reiniciando si pasa > 2.5s entre taps).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/bpmAndWaveformEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/dj/BpmAndWaveformEngine.ts tests/unit/renderer/bpmAndWaveformEngine.test.ts
git commit -m "feat: add BpmAndWaveformEngine for BPM autocorrelation, Tap BPM, Sync and waveforms"
```

---

### Task 16: `QueueAndAutomixEngine` (Cola Up Next, Pre-Buffering 30s y Salto Automático ante Error)

**Files:**
- Create: `src/renderer/dj/QueueAndAutomixEngine.ts`, `src/renderer/store/useLibraryStore.ts`
- Test: `tests/unit/renderer/queueAndAutomixEngine.test.ts`

**Interfaces:**
- Consumes: `DeckId`, `YouTubeTrack`
- Produces:
  - `export interface QueueItem { queueId: string; track: YouTubeTrack; status: 'pending' | 'preloading' | 'loaded' | 'failed'; errorMessage?: string; }`
  - `export interface AutomixOptions { enabled: boolean; preloadLeadSec: number; crossfadeDurationSec: number; outroTriggerSec: number; }`
  - `export interface AutomixCallbacks { loadDeck: (deck: DeckId, track: YouTubeTrack) => Promise<void>; startTransition: (fromDeck: DeckId, toDeck: DeckId, durationSec: number) => Promise<void>; onTrackSkipped: (item: QueueItem, reason: string) => void; }`
  - `export class QueueAndAutomixEngine { enqueue(track: YouTubeTrack): QueueItem; enqueueMany(tracks: YouTubeTrack[]): QueueItem[]; reorder(fromIndex: number, toIndex: number): void; remove(queueId: string): void; getQueue(): QueueItem[]; tick(activeDeck: DeckId, remainingSec: number, isActivePlaying: boolean, options: AutomixOptions, callbacks: AutomixCallbacks): Promise<void>; }`

- [ ] **Step 1: Write the failing test (incluye caso Review Focus #5)**

En `tests/unit/renderer/queueAndAutomixEngine.test.ts`:
1. Cuando `remainingSec <= 30` y `options.enabled === true`, `tick` pre-carga el primer ítem `'pending'` en el deck opuesto (`callbacks.loadDeck('B', track1)`).
2. Cuando `remainingSec <= 8` (`outroTriggerSec = 8`) y el siguiente deck ya está `'loaded'`, `tick` dispara `callbacks.startTransition('A', 'B', 8)` una sola vez.
3. **Test Review Focus #5 (auto-skip si un video falla):** Si `loadDeck` rechaza para `track1` ("Video unavailable"), `QueueAndAutomixEngine` marca `track1` como `'failed'`, invoca `onTrackSkipped`, y en el siguiente intento (o bucle inmediato) carga automáticamente `track2` sin detener la mezcla.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/queueAndAutomixEngine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `QueueAndAutomixEngine` y `useLibraryStore`**

Proteger `tick()` con lock reentrante para evitar pre-cargas o transiciones duplicadas durante ticks sucesivos a 4 Hz.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/queueAndAutomixEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/dj/QueueAndAutomixEngine.ts src/renderer/store/useLibraryStore.ts tests/unit/renderer/queueAndAutomixEngine.test.ts
git commit -m "feat: add QueueAndAutomixEngine with 30s preload and fault-tolerant auto-skip"
```

---

### Task 17: Integración UI Completa de Cabina DJ (Hot Cues, Loops, Pitch, BPM, Cola, Audio Output)

**Files:**
- Modify: `src/renderer/components/DeckPanel.tsx`, `src/renderer/components/MixerCenter.tsx`, `src/renderer/components/SearchBrowserTab.tsx`, `src/renderer/App.tsx`
- Create: `src/renderer/components/QueueTab.tsx`, `src/renderer/components/SettingsTab.tsx`, `src/renderer/store/useSettingsStore.ts`
- Test: `tests/unit/renderer/deckPanel.test.tsx`

**Interfaces:**
- Consumes: `CueLoopTempoController`, `BpmAndWaveformEngine`, `QueueAndAutomixEngine`, `AudioOutputRouter`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/deckPanel.test.tsx`: renderizar `DeckPanel` para `'A'` y verificar: botones `Hot Cue 1..8`, controles `Auto-Loop (1, 2, 4, 8)`, `Sync`, `Tap`, `Key Lock`, slider de `Pitch`, e invocación del handler al pulsar `Hot Cue 1` o `Sync`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/deckPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar controles DJ en `DeckPanel`, `QueueTab` (Drag & Drop + Importar Playlist YouTube) y `SettingsTab` (Audio Master/Cue + Mono Split + Monitores)**

Conectar el ciclo de `requestAnimationFrame` para waveform playhead, medidores VU y chequeo de fronteras de loop sin re-renderizar componentes padres cada frame.

- [ ] **Step 4: Run tests and typecheck to verify Phase 3**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: integrate Phase 3 DJ deck controls, queue tab, automix and audio routing UI"
```

---

## Fase 4: Historial de Mixes, Crates, Exportación, Atajos y MIDI USB

### Task 18: `HistoryAndCratesService` (Auto-Logging de Sesiones, Recarga como Cola y Crates)

**Files:**
- Create: `src/main/services/HistoryAndCratesService.ts`
- Modify: `src/main/ipc/registerHandlers.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`
- Test: `tests/unit/main/historyAndCratesService.test.ts`

**Interfaces:**
- Consumes: `DatabaseService`, `YouTubeTrack`
- Produces:
  - `export interface MixSession { id: string; title: string; startedAt: number; endedAt: number | null; notes: string; }`
  - `export interface HistoryEntry { id: string; sessionId: string; deck: 'A' | 'B'; videoId: string; title: string; channel: string; durationSec: number; playedAt: number; endedAt: number | null; bpm: number | null; transitionUsed: string | null; }`
  - `export interface Crate { id: string; name: string; color: string; trackCount: number; }`
  - `export class HistoryAndCratesService { constructor(db: DatabaseService); startSession(title?: string): MixSession; endSession(sessionId: string): void; listSessions(): MixSession[]; logTrackPlay(entry: Omit<HistoryEntry, 'id'>): HistoryEntry; getSessionHistory(sessionId: string): HistoryEntry[]; createCrate(name: string, color: string): Crate; addTrackToCrate(crateId: string, track: YouTubeTrack): void; getCrateTracks(crateId: string): YouTubeTrack[]; listCrates(): Crate[]; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/main/historyAndCratesService.test.ts`:
1. `startSession('Fiesta Viernes')`, dos llamadas `logTrackPlay(...)` y `getSessionHistory(session.id)` devuelven las pistas ordenadas cronológicamente por `playedAt`.
2. `createCrate('Reggaeton Clásico', '#FF8A00')` + `addTrackToCrate` evitan duplicados en el mismo crate y retornan tracks intactos con `getCrateTracks`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/historyAndCratesService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `HistoryAndCratesService` y conectar en el renderer regla `>= 10s en Master`**

Registrar pista automáticamente cuando un deck permanezca activo al aire (`crossfader` + `channelFader > 0.05`) durante `>= 10s`, evitando duplicados consecutivos del mismo `videoId` en el mismo play.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/historyAndCratesService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/HistoryAndCratesService.ts src/main/ipc/registerHandlers.ts src/preload/index.ts src/preload/index.d.ts tests/unit/main/historyAndCratesService.test.ts
git commit -m "feat: add HistoryAndCratesService for session logging and crates"
```

---

### Task 19: `SessionExporter` (`JSON`, `CSV`, `M3U`) + UI `HistoryAndCratesTab`

**Files:**
- Create: `src/main/services/SessionExporter.ts`, `src/renderer/components/HistoryAndCratesTab.tsx`
- Modify: `src/main/ipc/registerHandlers.ts`, `src/renderer/App.tsx`
- Test: `tests/unit/main/sessionExporter.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `MixSession`
- Produces:
  - `export type ExportFormat = 'json' | 'csv' | 'm3u';`
  - `export class SessionExporter { formatSession(session: MixSession, entries: HistoryEntry[], format: ExportFormat): string; exportToFile(targetPath: string, session: MixSession, entries: HistoryEntry[], format: ExportFormat): Promise<void>; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/main/sessionExporter.test.ts`:
1. `formatSession(..., 'csv')` escapa comillas y comas en títulos (`"Track, ""Remix"""`).
2. `formatSession(..., 'm3u')` comienza con `#EXTM3U`, genera `#EXTINF:<duration>,<channel> - <title>` seguido de `https://www.youtube.com/watch?v=<videoId>`.
3. `formatSession(..., 'json')` serializa `{ session, entries }` válido y parseable.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main/sessionExporter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `SessionExporter`, `dialog.showSaveDialog` IPC y UI `HistoryAndCratesTab`**

Incluir botón "Recargar Mix en Cola" que envía todas las pistas de una sesión pasada directo a `QueueAndAutomixEngine.enqueueMany`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/sessionExporter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/SessionExporter.ts src/renderer/components/HistoryAndCratesTab.tsx src/main/ipc/registerHandlers.ts src/renderer/App.tsx tests/unit/main/sessionExporter.test.ts
git commit -m "feat: add SessionExporter (JSON/CSV/M3U) and History/Crates UI tab"
```

---

### Task 20: `HotkeyManager` (Atajos de Teclado DJ Personalizables)

**Files:**
- Create: `src/renderer/controllers/HotkeyManager.ts`
- Test: `tests/unit/renderer/hotkeyManager.test.ts`

**Interfaces:**
- Produces:
  - `export type HotkeyAction = 'deckA.playPause' | 'deckB.playPause' | 'deckA.cue' | 'deckB.cue' | 'deckA.sync' | 'deckB.sync' | 'crossfader.left' | 'crossfader.right' | 'crossfader.center' | 'video.autoTransition' | `deckA.hotCue.${1|2|3|4|5|6|7|8}` | `deckB.hotCue.${1|2|3|4|5|6|7|8}`;`
  - `export class HotkeyManager { constructor(bindings?: Partial<Record<string, HotkeyAction>>); setBindings(bindings: Record<string, HotkeyAction>): void; getBindings(): Record<string, HotkeyAction>; handleKeyEvent(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'target'>): HotkeyAction | null; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/hotkeyManager.test.ts`:
1. `Space` dispara `'deckA.playPause'`, `Shift+Space` dispara `'deckB.playPause'`, `Digit1..Digit8` dispara hot cues del deck enfocado/asignado.
2. Si `e.target` es un `<input>`, `<textarea>` o `[contenteditable="true"]`, `handleKeyEvent` devuelve `null` para no interceptar búsquedas ni texto de marquesina.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/hotkeyManager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `HotkeyManager` y enlazar en `App.tsx` + `SettingsTab.tsx`**

Permitir reasignación y restauración a valores por defecto persistidos en `app_settings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/hotkeyManager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/controllers/HotkeyManager.ts tests/unit/renderer/hotkeyManager.test.ts
git commit -m "feat: implement customizable DJ HotkeyManager with input focus guard"
```

---

### Task 21: `MidiLearnEngine` (Web MIDI API + MIDI Learn + Persistencia por Controlador)

**Files:**
- Create: `src/renderer/controllers/MidiLearnEngine.ts`
- Modify: `src/main/services/HistoryAndCratesService.ts` (o `DatabaseService.ts` para `midi_mappings`), `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/midiLearnEngine.test.ts`

**Interfaces:**
- Produces:
  - `export interface MidiMapping { id: string; deviceName: string; controlKey: string; channel: number; statusType: 'cc' | 'note'; ccOrNote: number; mode: 'absolute' | 'toggle' | 'trigger'; minVal: number; maxVal: number; }`
  - `export class MidiLearnEngine { init(): Promise<string[]>; startLearn(controlKey: string, mode: MidiMapping['mode'], onLearned: (mapping: MidiMapping) => void): void; cancelLearn(): void; processMidiMessage(deviceName: string, data: Uint8Array, onControl: (controlKey: string, normalized01: number, mapping: MidiMapping) => void): void; loadMappings(mappings: MidiMapping[]): void; }`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/midiLearnEngine.test.ts`:
1. Con `startLearn('mixer.crossfader', 'absolute', cb)`, al llegar mensaje CC `[0xB0, 0x0A, 64]` de `'Pioneer DDJ-FLX4'`, crea el `MidiMapping` (`channel: 0`, `statusType: 'cc'`, `ccOrNote: 10`), llama `cb` y sale del modo learn.
2. En uso normal, mensaje `[0xB0, 0x0A, 127]` invoca `onControl('mixer.crossfader', 1.0, mapping)`; mensaje Note On `[0x90, 0x24, 127]` con `mode: 'trigger'` dispara `1.0`, ignorando Note Off (`[0x80, ...]` o velocidad `0`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/midiLearnEngine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `MidiLearnEngine`, persistencia SQLite en `midi_mappings` y panel MIDI Learn en `SettingsTab`**

Degradar graciosamente si `navigator.requestMIDIAccess` no está disponible o no hay controladores conectados.

- [ ] **Step 4: Run tests and typecheck to verify Phase 4**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add MidiLearnEngine with Web MIDI API and per-device SQLite persistence"
```

---

## Fase 5: Pulido Visual de Cabina, E2E y Empaquetado Windows

### Task 22: Controles Hardware Táctiles (`RotaryKnob`, `LedVuMeter`) y Pulido Visual 60fps

**Files:**
- Create: `src/renderer/components/ui/RotaryKnob.tsx`, `src/renderer/components/ui/LedVuMeter.tsx`
- Modify: `src/renderer/components/MixerCenter.tsx`, `src/renderer/components/DeckPanel.tsx`, `src/renderer/styles/index.css`
- Test: `tests/unit/renderer/rotaryKnob.test.tsx`

**Interfaces:**
- Produces:
  - `<RotaryKnob label: string; value: number; min: number; max: number; defaultValue?: number; accentColor?: string; bipolar?: boolean; onChange: (v: number) => void; formatValue?: (v: number) => string />`
  - `<LedVuMeter getLevel: () => number; orientation?: 'vertical' | 'horizontal'; />`

- [ ] **Step 1: Write the failing test**

En `tests/unit/renderer/rotaryKnob.test.tsx`: verificar accesibilidad (`role="slider"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`), reset al `defaultValue` con doble clic (`dblclick`), y ajuste por arrastre vertical (`pointerdown` + `pointermove` + `pointerup`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/rotaryKnob.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `RotaryKnob`, `LedVuMeter` sobre Canvas/`requestAnimationFrame` y aplicar diseño de consola oscura profesional**

Usar guías de `impeccable` y `vercel-react-best-practices` (sin re-renders React por `LedVuMeter`, números `tabular-nums`, bordes limpios, foco visible en botones de cabina).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/rotaryKnob.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ui/RotaryKnob.tsx src/renderer/components/ui/LedVuMeter.tsx src/renderer/components/MixerCenter.tsx src/renderer/components/DeckPanel.tsx src/renderer/styles/index.css tests/unit/renderer/rotaryKnob.test.tsx
git commit -m "feat: add hardware-style RotaryKnob, 60fps LedVuMeter and dark cabin polish"
```

---

### Task 23: Suite E2E con Playwright en Electron (Cabina + Búsqueda + Doble Ventana)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/appFlow.spec.ts`

- [ ] **Step 1: Escribir prueba E2E de flujo completo en `tests/e2e/appFlow.spec.ts`**

Lanzar la app compilada con `_electron.launch`, verificar:
1. Ventana principal visible sin errores de consola ni uncaught page errors.
2. Presencia de Deck A, Deck B, Video Preview Bar, Mixer Center y tabs inferiores (`Buscador`, `Cola`, `Historial`, `Crates`, `Ajustes`).
3. Abrir ventana de salida secundaria (`Pantalla 2`) y comprobar que aparece la segunda ventana Electron sin barras de UI ni errores WebGL2, y que cerrarla no cierra la cabina.
4. Verificar que no se creó ningún archivo `.mp4`/`.webm`/`.m4a`/`.mp3` en el directorio `userData` temporal de prueba.

- [ ] **Step 2: Compilar app y ejecutar suite E2E**

Run: `npm run build && npx playwright test tests/e2e/appFlow.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts tests/e2e/appFlow.spec.ts
git commit -m "test: add Electron Playwright E2E suite for dual-window cabin and zero-disk policy"
```

---

### Task 24: Configuración de Empaquetado Windows Instalador `.exe` NSIS (`electron-builder`) y Verificación Integral

**Files:**
- Create: `electron-builder.yml`, `build/icon.ico`
- Modify: `package.json`

- [ ] **Step 1: Generar ícono `build/icon.ico` (256×256 multi-tamaño) y configurar `electron-builder.yml` para instalador `.exe` NSIS universal**

Configurar:
- `appId: "com.tubedeck.vdj"`
- `productName: "TubeDeck VDJ"`
- `asar: true`, `asarUnpack: ["**/*.node"]`
- `win.icon: "build/icon.ico"`, `win.target: [{ target: "nsis", arch: ["x64"] }]`
- `nsis`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `shortcutName: "TubeDeck VDJ"`
- `extraResources` opcional para `resources/bin/yt-dlp.exe` (respaldado por autodescarga/actualización en `userData/bin/yt-dlp.exe` para que funcione en cualquier equipo recién instalado).

- [ ] **Step 2: Ejecutar suite completa, construir el instalador `.exe` NSIS y verificar el binario desempaquetado con Playwright**

Run: `npx vitest run && npm run typecheck && npm run build && npx electron-builder --win nsis && npx playwright test`
Expected: PASS en unit tests, typecheck, build, generación del instalador `dist/TubeDeck VDJ Setup *.exe` (> 40 MB) y prueba E2E sobre `dist/win-unpacked/TubeDeck VDJ.exe`.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml build/icon.ico package.json
git commit -m "build: add Windows NSIS installer configuration and verify full release build"
```
