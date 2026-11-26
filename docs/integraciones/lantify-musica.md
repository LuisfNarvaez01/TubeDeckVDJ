# Pedidos de canciones por internet · Lantify Música (contrato v1)

Contrato compartido entre **Proyecta** (`D:\Trabajos\Pantallas`) y **Lantify POS** (`C:\Users\Luis\Desktop\pos-system\pos-system`, Worker `cloud/api-worker`). Cualquier cambio se hace en los dos repos.

## Por qué así

- El QR tiene que funcionar **desde cualquier red** (datos móviles, otro WiFi): la página del cliente vive en la nube de Lantify.
- El PC de Proyecta **no abre puertos**: mantiene un WebSocket saliente con un Durable Object por local (`MusicRoom`), igual que el relevo de meseros (`relay.ts`, `TenantRelay`). El objeto solo reenvía y guarda un caché pequeño (estado de pedidos, chat).
- La **búsqueda de YouTube la hace Proyecta** (youtubei.js en el PC del DJ). El cliente nunca habla con YouTube.
- Sirve igual para un local **sin Lantify POS** (módulo independiente: Proyecta se registra solo) y para uno **con Lantify POS** (se vincula con un código del POS; la página usa el tema del negocio y el POS puede chatear con el DJ).
- Sin internet, Proyecta sigue ofreciendo el modo **"Solo red del local"** (servidor LAN propio, mismo API y misma página).

Dominio: `api.lantifypos.com` (API y WebSocket) y `musica.lantifypos.com` (página del cliente, mismo Worker, `custom_domain`).

## Identidad del local (`venue`)

| Campo | Qué es |
|---|---|
| `venueId` | 8 caracteres `[a-z0-9]`, va en el QR. Para un local de Lantify es estable por negocio. |
| `hostSecret` | 32 bytes base64url que solo conoce Proyecta. En la nube se guarda solo su SHA-256. |
| `tenantId` | Negocio de Lantify vinculado, o `null` si es independiente. |

D1 (migración nueva):

```sql
CREATE TABLE music_venues (
  id TEXT PRIMARY KEY,              -- venueId
  tenant_id TEXT UNIQUE,            -- NULL = independiente
  name TEXT NOT NULL,
  host_secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE music_link_codes (
  code TEXT PRIMARY KEY,            -- 8 caracteres, un solo uso
  tenant_id TEXT NOT NULL,
  expires_at TEXT NOT NULL          -- 15 minutos
);
```

## Endpoints HTTP

Todos JSON, con CORS como el resto del Worker. Errores: `{ error: "texto en español para mostrar" }`.

### Proyecta (registro y vínculo)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/music/venues` | `{ name }` | `201 { venueId, hostSecret }` — local independiente. Límite: 5 por IP por hora. |
| `POST /v1/music/link` | `{ code }` (código del POS) | `200 { venueId, hostSecret, business: { name, slug } }`. Si el negocio ya tenía venue, se **rota** el secreto (el PC anterior queda fuera). `404` código vencido o usado. |
| `POST /v1/music/venues/:venueId/rotate` | cabecera `Authorization: Bearer <hostSecret>` | `200 { venueId, hostSecret }` nuevo (el QR no cambia). |
| `DELETE /v1/music/venues/:venueId` | `Authorization: Bearer <hostSecret>` | `204` — desvincular / dejar de usar. |
| `POST /v1/music/link-license` | `Authorization: Bearer <licencia de Proyecta>` | Igual que `/link`, sin código: Proyecta entró con la cuenta del negocio (3.7). `402` si el plan no incluye Proyecta. |

### Lantify POS (programa del negocio, licencia del POS)

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `POST /v1/music/link-code` | ADMIN | `200 { code, expiresAt }` — el dueño lo ve en **Lantify → Proyecta → Vincular**. |
| `GET /v1/music/mine` | cualquier usuario | `200 { venue: { venueId, name, online, lastSeenAt } \| null, tableUrl, desk: Desk \| null }` |
| `GET /v1/music/mine/chat?since=<msgId>` | cualquier usuario | `200 { messages: ChatMessage[], online }` |
| `POST /v1/music/mine/chat` | cualquier usuario | `{ text, author? }` → `201 ChatMessage` (author = nombre del usuario del POS) |
| `POST /v1/music/mine/decide` | cualquier usuario | `{ id, action: 'approve' \| 'reject' }` → `202`. Solo sin DJ en cabina (`409` con DJ, `404` ya decidido, `503` PC desconectado). |
| `PUT /v1/music/mine/autopilot` | ADMIN | `AutopilotRules` → `200 AutopilotRules` (limpio). Se manda al PC al momento y en cada `ready`. |

```ts
// La cabina vista desde la caja. Con DJ en cabina: pending y alerts vacíos (la caja no recibe avisos).
type Desk = {
  online: boolean; djPresent: boolean;
  pending: { id: string; title: string; artist?: string; table?: string; guest?: string; thumbnailUrl?: string; at: string }[];
  alerts: { id: string; kind: 'load_failed' | 'skipped' | 'info'; text: string; at: string }[];  // últimas 20, 12 h
  autopilot: AutopilotRules;
  lastChat: { id: string; from: 'dj' | 'pos'; at: string } | null;
};
// Lo aplica Proyecta SOLO sin DJ en cabina: aprueba hasta maxPerHour pedidos por hora y maxPerTable por
// mesa (o por nombre si no hay mesa); lo demás espera la decisión de la caja.
type AutopilotRules = { enabled: boolean; maxPerHour: number /* 1–60 */; maxPerTable: number /* 1–20 */; skipOnLoadError: boolean };
```

### Cuenta de Lantify en Proyecta (3.7)

Proyecta abre con la cuenta del negocio. La licencia es la misma JWS Ed25519 del POS con `app: 'proyecta'` en las claims: **solo** sirve para lo de Proyecta (`/v1/license/refresh`, `/v1/music/link-license`); cualquier ruta del POS la rechaza con `403`. Los equipos de Proyecta se cuentan aparte (`devices.app = 'proyecta'`): 3 por negocio con un plan del POS, o los del plan `proyecta`.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/auth/login` | `{ app: 'proyecta', tenantCode, username, password, device: { fingerprint, name } }` | `200 { license, user, tenant }`. `402 PLAN_FEATURE_REQUIRED` sin la función `proyecta`. |
| `POST /v1/proyecta/handoff` | `Authorization: Bearer <licencia del POS>`, `{ device }` | `200 { license, user, tenant }` — entrada automática desde el POS del mismo equipo. |
| `POST http://127.0.0.1:5000/api/cloud/proyecta-handoff` | `{ device }` | El servidor local del POS (solo desde el mismo equipo, sin `Origin`) usa su licencia más reciente y llama a `/v1/proyecta/handoff`. |
| `GET /v1/plans?product=proyecta` | — | Planes solo de Proyecta (sin `product`: los del POS, como antes). |

Plan `proyecta` (migración `0026`): un negocio que paga solo Proyecta entra a Proyecta pero no al punto de venta (`403 CLOUD_PLAN_PROYECTA_ONLY`). Registro: `lantifypos.com/registro?producto=proyecta`. Todos los planes del POS traen la función `proyecta`.

### Cliente (página del QR, público)

Base: `https://musica.lantifypos.com/<venueId>` (la página) y `https://api.lantifypos.com/v1/music/<venueId>/api/…` (el API). La página usa una variable `API_BASE` (en la nube la inyecta el Worker; en la red local es `/api/`).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET …/api/info` | — | `{ venueName, online, accepting, nowPlaying: { title, artist } \| null, upNext: { title, artist } \| null, theme: Theme \| null }` |
| `GET …/api/search?q=` | — | `{ items: GuestTrack[] }` (máx. 12, ya filtrados: 90–600 s, sin basura). `503` si el DJ no está conectado. |
| `POST …/api/requests` | `{ client, table?, guest?, videoId?, query? }` | `201 GuestRequestView` · `429 { error }` límite · `400 { error }` |
| `GET …/api/requests/:id?client=` | — | `GuestRequestView` (del caché del objeto, no despierta a Proyecta) |

- `client`: id aleatorio que la página guarda en el celular (`localStorage`), 16–64 caracteres. Junto con un hash de la IP lo usa Proyecta para los límites (1 pedido cada 30 s, 3 abiertos).
- Si viene `videoId`, debe ser uno que Proyecta devolvió en una búsqueda de los últimos 15 min; si no, se trata como `query` (texto libre).

```ts
type Theme = { primary: string; accent: string; logoUrl: string | null };  // del tema de la página del negocio
type GuestTrack = { videoId: string; title: string; channel: string; durationSec: number; thumbnailUrl: string };
type GuestRequestView = {
  id: string; state: 'searching' | 'pending' | 'queued' | 'playing' | 'played' | 'rejected';
  query: string; title?: string; artist?: string; thumbnailUrl?: string;
  reason?: string;          // texto para el cliente si fue rechazado
  position?: number;        // puesto en la cola cuando está "queued"
};
type ChatMessage = { id: string; from: 'dj' | 'pos'; author: string; text: string; at: string };
```

## WebSocket de Proyecta

`GET wss://api.lantifypos.com/v1/music/<venueId>/host` (upgrade). Primer mensaje en ≤ 5 s: `{ t:'auth', secret, v:1, app:'proyecta/<versión>' }`. Una sola conexión de host por local (la nueva cierra la vieja con código `4001`).

| Dirección | Mensaje | Uso |
|---|---|---|
| objeto → PC | `{ t:'ready', chat: ChatMessage[], autopilot: AutopilotRules }` | tras autenticar; últimos 50 mensajes y el piloto automático vigente |
| objeto → PC | `{ t:'req', rid, op:'search', q }` | búsqueda del cliente (responder en ≤ 8 s) |
| objeto → PC | `{ t:'req', rid, op:'request', body, clientKey }` | pedido nuevo; `clientKey` = sha256(ip + client) |
| objeto → PC | `{ t:'chat', msg: ChatMessage }` | mensaje del POS |
| objeto → PC | `{ t:'decide', id, action: 'approve' \| 'reject', by }` | la caja decidió un pedido (solo sin DJ). `id` = id del pedido en el relevo |
| objeto → PC | `{ t:'autopilot', rules: AutopilotRules }` | la caja cambió el piloto automático |
| PC → objeto | `{ t:'res', rid, status, body }` | respuesta (`status` HTTP que verá el cliente) |
| PC → objeto | `{ t:'view', view: GuestRequestView }` | estado nuevo de un pedido (caché para `GET requests/:id`) |
| PC → objeto | `{ t:'info', info: { venueName, accepting, nowPlaying, upNext? } }` | cada cambio de canción, de la que sigue o de nombre. `upNext` (26 nov 2026) es la siguiente canción de la cola (`{ title, artist }` o `null`); un PC viejo que no la manda queda en `null` |
| PC → objeto | `{ t:'chat', text }` | mensaje del DJ (el objeto le pone id, `from:'dj'`, hora y lo guarda) |
| PC → objeto | `{ t:'desk', desk: { djPresent, pending } }` | solo vinculado a un negocio, cuando cambia. Con DJ, `pending: []` |
| PC → objeto | `{ t:'alert', alert: { kind, text } }` | una canción no cargó o se saltó; el objeto la guarda solo sin DJ |
| ambos | `{ t:'ping' }` / `{ t:'pong' }` | cada 30 s |

Cerrar con `4003` = secreto inválido (Proyecta muestra "Vincula de nuevo"). El objeto guarda en su almacenamiento: últimos 200 `view` (24 h), último `info`, últimos 200 mensajes de chat.

## Página del cliente

- Una sola página (HTML+CSS+JS sin dependencias, CSP estricta). La fuente está en Proyecta: `src/main/services/localRequestPage.ts`; el Worker sirve **la misma** (copiada en `cloud/api-worker/src/musicPage.ts`) con `API_BASE` inyectado.
- **Mesa fija**: la primera vez se toma de `?mesa=` (QR de la mesa) o se escribe; se guarda en el celular por local y no se vuelve a pedir. Botón "Cambiar de mesa" para salir.
- **Buscador** tipo YouTube: resultados con miniatura, título, canal y duración; el cliente elige el video exacto. Si no aparece, "Pedir por nombre".
- **Tema**: si `info.theme` existe (local de Lantify POS) usa `primary`/`accent` y el logo del negocio; si no, el tema de Proyecta (negro, acentos cian/magenta).
- **Barra de Proyecta** (`<nav class="pnav">`): marca de Proyecta, "by Lantify" y un hueco `<!--nav-extra-->` donde el Worker pone el botón de la carta.
- **Ahora y lo que sigue**: la tarjeta "Sonando" muestra `nowPlaying` y, debajo, "Sigue: <título> · <artista>" con `upNext` cuando no es `null` (pendiente en Proyecta: la página y la proyección "A continuación").
- En un local de Lantify POS, la página del negocio (`/m/<slug>?mesa=<código de la mesa>`) enlaza a "Pedir canciones" → `https://musica.lantifypos.com/<venueId>?mesa=<mesa>&carta=<código de la mesa>`.
- **Un solo QR por mesa (solo Lantify POS):** si el negocio tiene el pedido desde la mesa activo, el QR de la mesa es el de la página del negocio (carta + "Pedir canciones"). Si no, el QR es el de la página de música.
- **Botón "volver a la carta" (lo pone el Worker, no la página de Proyecta):** en un local vinculado con página publicada, el Worker pone un `<a class="lf-carta">` en el hueco `<!--nav-extra-->` de la barra de Proyecta y suma sus estilos a `/app.css`. Con `carta=<código>` dice "Pedir de la carta" y vuelve a `/m/<slug>?mesa=<código>`; sin él, "Ver la carta" → `/m/<slug>`. Un local independiente no lo lleva. La página de Proyecta no cambia; en la red local (sin nube) no hay botón.
- **Publicidad de Lantify (la pone el Worker, en todos los locales):** el "by Lantify" de la barra pasa a ser `<a class="pnav-by" href="https://lantifypos.com/" target="_blank">` y antes del `<script src="/app.js">` va una tarjeta `<aside class="lf-promo">` ("¿Tienes un restaurante o un bar?" → lantifypos.com, en otra pestaña para no perder el pedido). Para que funcione, la página de Proyecta debe conservar literal `<span class="pnav-by">by Lantify</span>` y `<script src="/app.js"></script>`. En la red local no aparece.

## Chat DJ ↔ POS

Mensajes cortos (≤ 280 caracteres) entre el DJ (Proyecta → botón **Mensajes** de la barra superior, con contador y aviso) y el personal del POS (Lantify → Proyecta, y un aviso en cualquier pantalla de la caja). El objeto guarda los últimos 200. Límite: 20 mensajes por minuto por lado.
