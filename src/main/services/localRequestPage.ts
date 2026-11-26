/**
 * Guest page for song requests (phones). ONE source for both transports:
 *  - "Solo red del local": served by `LocalRequestServer` (API under `/api/`, access key `?k=`).
 *  - "Por internet": served by the Lantify Música Worker at musica.lantifypos.com/<venue>,
 *    which injects `window.API_BASE` (copy these three constants verbatim into
 *    pos-system `cloud/api-worker/src/musicPage.ts`).
 * Plain HTML/CSS/JS, no external resources, strict CSP; user text only via textContent.
 * Contract: docs/integraciones/lantify-musica.md.
 */

export const GUEST_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#050507">
<title>Pide tu canción</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<nav class="pnav" aria-label="Proyecta">
  <div class="pnav-in">
    <span class="pnav-brand">
      <svg class="pnav-mark" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><rect width="1024" height="1024" rx="232" fill="#111114"/><circle cx="630" cy="420" r="282" fill="#2A2A31"/><circle cx="630" cy="420" r="236" fill="none" stroke="#000" stroke-width="10"/><circle cx="630" cy="420" r="190" fill="none" stroke="#000" stroke-width="10"/><circle cx="630" cy="420" r="144" fill="none" stroke="#000" stroke-width="10"/><circle cx="630" cy="420" r="96" fill="#FF4FA8"/><circle cx="630" cy="420" r="16" fill="#000"/><rect x="120" y="520" width="520" height="320" rx="72" fill="#22E1F0" stroke="#000" stroke-width="28"/><g fill="#000"><rect x="232" y="640" width="40" height="80" rx="20"/><rect x="300" y="596" width="40" height="168" rx="20"/><rect x="368" y="620" width="40" height="120" rx="20"/><rect x="436" y="572" width="40" height="216" rx="20"/><rect x="504" y="628" width="40" height="104" rx="20"/></g></svg>
      <span class="pnav-word">Proyecta</span>
    </span>
    <!--nav-extra-->
    <span class="pnav-by">by Lantify</span>
  </div>
</nav>
<div class="app" id="app">
  <header class="top">
    <div class="brand">
      <img id="logo" class="logo" alt="" hidden>
      <div class="brand-text">
        <p id="venue" class="venue">Pide tu canción</p>
        <p id="dj-state" class="dj-state" aria-live="polite"></p>
      </div>
    </div>
    <button id="seat" class="seat" type="button" hidden aria-label="Cambiar de mesa">
      <span id="seat-label"></span>
      <span class="seat-change">Cambiar</span>
    </button>
  </header>

  <section id="now" class="now" hidden aria-live="polite">
    <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <div class="now-text">
      <p class="eyebrow">Suena ahora</p>
      <p id="now-title" class="now-title"></p>
      <p id="now-artist" class="now-artist"></p>
    </div>
  </section>

  <section id="onboard" class="panel onboard" hidden>
    <h1>Antes de pedir</h1>
    <p class="muted">Lo guardamos en este celular: no te lo volvemos a preguntar.</p>
    <form id="onboard-form" autocomplete="on">
      <label for="ob-table">¿En qué mesa estás?</label>
      <input id="ob-table" maxlength="40" inputmode="text" placeholder="Ej. 7 o Terraza 2" autocomplete="off">
      <label for="ob-name">Tu nombre <span class="muted">(opcional, lo ve el DJ)</span></label>
      <input id="ob-name" maxlength="60" autocomplete="given-name" placeholder="Ej. Ana">
      <button class="primary" type="submit">Continuar</button>
      <button id="ob-skip" class="ghost" type="button">No estoy en una mesa</button>
    </form>
  </section>

  <main id="main" hidden>
    <form id="search-form" class="search" role="search">
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" maxlength="120" placeholder="Busca artista o canción" aria-label="Buscar canción" enterkeyhint="search" autocomplete="off">
      <button id="clear" class="clear" type="button" aria-label="Borrar búsqueda" hidden>&times;</button>
    </form>

    <p id="error" class="notice" role="alert" hidden></p>

    <section id="results-wrap" hidden>
      <p id="results-state" class="muted small" aria-live="polite"></p>
      <ul id="results" class="results" aria-label="Resultados"></ul>
      <button id="free" class="ghost free" type="button" hidden></button>
    </section>

    <section id="mine-wrap" hidden>
      <h2>Tus pedidos</h2>
      <ul id="mine" class="mine"></ul>
    </section>

    <section id="empty" class="hint">
      <p>Busca la versión exacta que quieres escuchar y tócala para pedirla. El DJ revisa cada pedido.</p>
    </section>
  </main>

  <p id="closed" class="panel closed" hidden></p>
</div>

<div id="sheet" class="sheet" hidden role="dialog" aria-modal="true" aria-labelledby="sheet-title">
  <div class="sheet-card">
    <div class="sheet-thumb"><img id="sheet-img" alt=""><span id="sheet-dur" class="dur"></span></div>
    <p id="sheet-title" class="sheet-title"></p>
    <p id="sheet-channel" class="muted"></p>
    <p id="sheet-for" class="muted small"></p>
    <button id="sheet-send" class="primary" type="button">Pedir esta canción</button>
    <button id="sheet-cancel" class="ghost" type="button">Cancelar</button>
  </div>
</div>
<script src="/app.js"></script>
</body>
</html>`;

export const GUEST_CSS = `
:root{
  --bg:#050507;--surface:#0e0e12;--raised:#16161b;--line:rgba(255,255,255,.08);
  --ink:#f5f5f6;--ink-2:#c9c9cf;--muted:#9c9ca6;--faint:#6f6f79;
  --accent:#22e1f0;--accent-2:#ff4fa8;--on-accent:#050507;--danger:#ffa39d;
  --radius:14px;color-scheme:dark
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;background:radial-gradient(120% 60% at 50% -10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 60%),var(--bg)}
.app{max-width:560px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))}
p{margin:0}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;font-weight:700;letter-spacing:-.01em}
h2{font-size:15px;margin:28px 0 10px;font-weight:650}
.muted{color:var(--muted);font-weight:400}.small{font-size:13px}
.pnav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 78%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top)}
.pnav-in{max-width:560px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:10px}
.pnav-brand{display:inline-flex;align-items:center;gap:8px;min-width:0;margin-right:auto}
.pnav-mark{width:26px;height:26px;flex:none}
.pnav-word{font-size:16px;font-weight:800;letter-spacing:-.02em}
.pnav-by{font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 9px;white-space:nowrap}
.pnav + .app{padding-top:14px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 14px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.logo{width:40px;height:40px;border-radius:10px;object-fit:cover;background:var(--raised)}
.brand-text{min-width:0}
.venue{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dj-state{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.dj-state::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--faint)}
.dj-state[data-on="1"]::before{background:#3ddc97;box-shadow:0 0 0 3px rgba(61,220,151,.18)}
.seat{display:flex;flex-direction:column;align-items:flex-end;gap:1px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:7px 11px;font:inherit;cursor:pointer;min-height:44px}
.seat span:first-child{font-weight:700;font-size:14px}
.seat-change{font-size:11px;color:var(--muted)}
.now{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--radius);background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 16%,var(--surface)),color-mix(in srgb,var(--accent-2) 12%,var(--surface)));border:1px solid var(--line);margin-bottom:16px}
.now-text{min-width:0}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.now-title{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now-artist{font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bars{display:flex;align-items:flex-end;gap:3px;height:22px;flex:none}
.bars i{width:4px;height:40%;border-radius:2px;background:var(--ink)}
@media (prefers-reduced-motion:no-preference){
  .bars i{animation:eq 1s ease-in-out infinite}
  .bars i:nth-child(2){animation-delay:-.4s}.bars i:nth-child(3){animation-delay:-.7s}.bars i:nth-child(4){animation-delay:-.2s}
  @keyframes eq{0%,100%{height:30%}50%{height:100%}}
  .result,.primary,.ghost,.seat{transition:transform .15s cubic-bezier(.16,1,.3,1),background-color .15s,border-color .15s}
  .result:active,.primary:active,.ghost:active{transform:scale(.98)}
  .sheet-card{animation:up .22s cubic-bezier(.16,1,.3,1)}
  @keyframes up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
}
.panel{padding:20px 16px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.onboard form{display:flex;flex-direction:column;gap:8px;margin-top:16px}
label{font-size:13px;font-weight:600;margin-top:6px}
input{font:inherit;font-size:17px;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-height:48px;width:100%;caret-color:var(--accent)}
input:focus{outline:none;border-color:color-mix(in srgb,var(--accent) 60%,transparent)}
button{font:inherit;cursor:pointer}
.primary{margin-top:10px;min-height:52px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--on-accent);font-size:17px;font-weight:700}
.primary:disabled{opacity:.5}
.ghost{min-height:46px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--ink-2);font-size:15px;font-weight:600}
button:focus-visible,.result:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:2px}
.search{position:sticky;top:8px;z-index:5;display:flex;align-items:center;gap:8px;background:var(--raised);border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 14px;box-shadow:0 12px 28px -18px rgba(0,0,0,.9)}
.search:focus-within{border-color:color-mix(in srgb,var(--accent) 60%,transparent)}
.search input{border:0;background:transparent;padding:10px 0;min-height:44px;border-radius:0}
.search input::-webkit-search-cancel-button{display:none}
.search-icon{width:20px;height:20px;flex:none;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round}
.clear{border:0;background:var(--surface);color:var(--ink-2);width:36px;height:36px;border-radius:50%;font-size:22px;line-height:1;flex:none}
.notice{margin-top:12px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--danger) 10%,var(--surface));color:var(--danger);font-size:14px}
#results-wrap{margin-top:14px}
.results,.mine{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.result{display:flex;gap:12px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px;border-radius:12px;align-items:flex-start}
.result:hover{background:var(--surface)}
.thumb{position:relative;flex:none;width:136px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--raised)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.dur{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.82);color:#fff;font-size:12px;font-weight:600;padding:1px 5px;border-radius:5px;font-variant-numeric:tabular-nums}
.r-text{min-width:0;padding-top:2px}
.r-title{font-size:15px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.r-channel{font-size:13px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.free{width:100%;margin-top:10px}
.mine li{display:flex;gap:12px;align-items:center;padding:10px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.mine .thumb{width:84px}
.m-text{min-width:0;flex:1}
.m-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-flex;align-items:center;gap:6px;margin-top:5px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--raised);color:var(--ink-2)}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
.mine li[data-state="queued"] .chip{color:var(--accent)}
.mine li[data-state="playing"]{border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.mine li[data-state="playing"] .chip{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--on-accent)}
.mine li[data-state="rejected"] .chip{color:var(--danger)}
.m-reason{font-size:12px;color:var(--muted);margin-top:4px}
.hint{margin-top:22px;color:var(--muted);font-size:14px;line-height:1.5}
.closed{text-align:center;color:var(--ink-2);margin-top:30px}
.sheet{position:fixed;inset:0;z-index:20;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.7);padding:12px}
.sheet[hidden]{display:none}
.sheet-card{width:100%;max-width:520px;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:6px;margin-bottom:env(safe-area-inset-bottom)}
.sheet-thumb{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--raised);margin-bottom:6px}
.sheet-thumb img{width:100%;height:100%;object-fit:cover}
.sheet-title{font-size:17px;font-weight:700;line-height:1.3}
`;

export const GUEST_JS = `(function () {
  'use strict';
  var API = (window.API_BASE || '/api/').replace(/\\/?$/, '/');
  var params = new URLSearchParams(location.search);
  var key = params.get('k') || '';
  var venueKey = 'proyecta.' + (location.pathname.replace(/[^a-z0-9]/gi, '') || 'local') + '.' + key.slice(0, 6);
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(venueKey + '.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(venueKey + '.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  var client = store.get('client', '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(client)) {
    var bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach(function (_, i) { bytes[i] = Math.random() * 256; });
    client = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    store.set('client', client);
  }

  // Table: from the table QR (?mesa=), asked once, kept on this phone until "Cambiar".
  var seat = store.get('seat', null);
  if (params.get('mesa')) {
    seat = { table: params.get('mesa').slice(0, 40), name: seat ? seat.name : '' };
    store.set('seat', seat);
  }
  var mine = store.get('mine', []);
  if (!Array.isArray(mine)) mine = [];

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-Proyecta-Key'] = key;
    return fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers: headers, cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) { var err = new Error(body.error || 'No se pudo conectar con el DJ.'); err.status = r.status; throw err; }
          return body;
        });
      });
  }

  function show(el, on) { el.hidden = !on; }
  function tableLabel(t) { return !t ? '' : /^\\d+$/.test(t) ? 'Mesa ' + t : t; }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function thumb(url, dur, cls) {
    var box = document.createElement('div'); box.className = 'thumb' + (cls ? ' ' + cls : '');
    if (url && /^https:\\/\\/i\\.ytimg\\.com\\//.test(url)) {
      var img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = url; box.appendChild(img);
    }
    if (dur) { var d = document.createElement('span'); d.className = 'dur'; d.textContent = fmt(dur); box.appendChild(d); }
    return box;
  }
  function text(tag, cls, value) { var el = document.createElement(tag); el.className = cls; el.textContent = value; return el; }
  function setError(msg) { var e = $('error'); e.textContent = msg || ''; show(e, Boolean(msg)); }

  // ---- seat / onboarding
  function renderSeat() {
    var has = seat !== null;
    show($('onboard'), !has);
    show($('main'), has);
    show($('seat'), has);
    if (has) $('seat-label').textContent = tableLabel(seat.table) || (seat.name ? seat.name : 'Sin mesa');
  }
  $('onboard-form').addEventListener('submit', function (e) {
    e.preventDefault();
    seat = { table: $('ob-table').value.trim().slice(0, 40), name: $('ob-name').value.trim().slice(0, 60) };
    store.set('seat', seat); renderSeat(); $('q').focus();
  });
  $('ob-skip').addEventListener('click', function () {
    seat = { table: '', name: $('ob-name').value.trim().slice(0, 60) };
    store.set('seat', seat); renderSeat();
  });
  $('seat').addEventListener('click', function () {
    $('ob-table').value = seat ? seat.table : ''; $('ob-name').value = seat ? seat.name : '';
    seat = null; store.set('seat', null); renderSeat(); $('ob-table').focus();
  });

  // ---- venue info and now playing
  var closedMsg = '';
  function loadInfo() {
    api('info').then(function (info) {
      closedMsg = '';
      $('venue').textContent = info.venueName || 'Pide tu canción';
      document.title = (info.venueName ? info.venueName + ' · ' : '') + 'Pide tu canción';
      var dj = $('dj-state');
      dj.textContent = info.online === false ? 'El DJ no está conectado' : info.accepting === false ? 'Pedidos cerrados' : 'El DJ recibe pedidos';
      dj.setAttribute('data-on', info.online !== false && info.accepting !== false ? '1' : '0');
      var np = info.nowPlaying;
      show($('now'), Boolean(np));
      if (np) { $('now-title').textContent = np.title; $('now-artist').textContent = np.artist || ''; }
      if (info.theme) applyTheme(info.theme);
      show($('closed'), false);
    }).catch(function (err) {
      if (err.status === 403 || err.status === 404) {
        closedMsg = err.message; $('closed').textContent = err.message;
        show($('closed'), true); show($('main'), false); show($('onboard'), false);
      }
    });
  }
  function validColor(c) { return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c); }
  function applyTheme(t) {
    var root = document.documentElement.style;
    if (validColor(t.accent)) root.setProperty('--accent', t.accent);
    if (validColor(t.primary)) root.setProperty('--accent-2', t.primary);
    if (typeof t.logoUrl === 'string' && /^https:\\/\\//.test(t.logoUrl)) { var l = $('logo'); l.src = t.logoUrl; show(l, true); }
  }

  // ---- search
  var timer = null, lastQ = '', seq = 0;
  function search(q) {
    q = q.trim(); lastQ = q; setError('');
    show($('clear'), q.length > 0);
    if (q.length < 2) { show($('results-wrap'), false); show($('empty'), mine.length === 0); return; }
    var my = ++seq;
    show($('results-wrap'), true); show($('empty'), false);
    $('results-state').textContent = 'Buscando…';
    api('search?q=' + encodeURIComponent(q) + '&client=' + client).then(function (res) {
      if (my !== seq) return;
      var list = $('results'); list.textContent = '';
      var items = Array.isArray(res.items) ? res.items : [];
      $('results-state').textContent = items.length ? '' : 'Sin resultados para esa búsqueda.';
      items.forEach(function (t) {
        var li = document.createElement('li');
        var b = document.createElement('button'); b.type = 'button'; b.className = 'result';
        b.setAttribute('aria-label', 'Pedir ' + t.title);
        b.appendChild(thumb(t.thumbnailUrl, t.durationSec));
        var tx = document.createElement('div'); tx.className = 'r-text';
        tx.appendChild(text('p', 'r-title', t.title));
        tx.appendChild(text('p', 'r-channel', t.channel));
        b.appendChild(tx);
        b.addEventListener('click', function () { openSheet(t); });
        li.appendChild(b); list.appendChild(li);
      });
      var free = $('free');
      free.textContent = '¿No aparece? Pedir «' + q.slice(0, 40) + '» al DJ';
      show(free, true);
    }).catch(function (err) {
      if (my !== seq) return;
      $('results-state').textContent = '';
      setError(err.message);
    });
  }
  $('q').addEventListener('input', function (e) {
    clearTimeout(timer); var v = e.target.value;
    timer = setTimeout(function () { search(v); }, 450);
  });
  $('search-form').addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(timer); search($('q').value); $('q').blur(); });
  $('clear').addEventListener('click', function () { $('q').value = ''; search(''); $('q').focus(); });
  $('free').addEventListener('click', function () { send({ query: lastQ }); });

  // ---- confirm sheet
  var picked = null;
  function openSheet(t) {
    picked = t;
    var img = $('sheet-img');
    if (/^https:\\/\\/i\\.ytimg\\.com\\//.test(t.thumbnailUrl)) img.src = t.thumbnailUrl; else img.removeAttribute('src');
    $('sheet-dur').textContent = fmt(t.durationSec);
    $('sheet-title').textContent = t.title;
    $('sheet-channel').textContent = t.channel;
    $('sheet-for').textContent = seat && (seat.table || seat.name)
      ? 'Para ' + [tableLabel(seat.table), seat.name].filter(Boolean).join(' · ') : '';
    show($('sheet'), true); $('sheet-send').focus();
  }
  function closeSheet() { show($('sheet'), false); picked = null; }
  $('sheet-cancel').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  $('sheet-send').addEventListener('click', function () { if (picked) send({ videoId: picked.videoId, query: '' }, picked); });

  function send(what, track) {
    var btn = $('sheet-send'); btn.disabled = true; setError('');
    api('requests', {
      method: 'POST',
      body: JSON.stringify({ client: client, table: seat ? seat.table : '', guest: seat ? seat.name : '', videoId: what.videoId, query: what.query || '' })
    }).then(function (v) {
      if (track && !v.thumbnailUrl) { v.thumbnailUrl = track.thumbnailUrl; v.title = v.title || track.title; }
      mine.push(v); mine = mine.slice(-6); store.set('mine', mine);
      closeSheet(); renderMine();
      $('q').value = ''; search('');
      $('mine-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      closeSheet(); setError(err.message);
    }).then(function () { btn.disabled = false; });
  }

  // ---- my requests
  var LABEL = {
    searching: 'Buscando la canción…', pending: 'Esperando al DJ', queued: 'En la lista: sonará pronto',
    playing: 'Sonando ahora', played: 'Ya sonó', rejected: 'No se pudo poner'
  };
  function renderMine() {
    var list = $('mine'); list.textContent = '';
    show($('mine-wrap'), mine.length > 0);
    show($('empty'), mine.length === 0 && !lastQ);
    mine.slice().reverse().forEach(function (r) {
      var li = document.createElement('li'); li.setAttribute('data-state', r.state);
      li.appendChild(thumb(r.thumbnailUrl, 0));
      var tx = document.createElement('div'); tx.className = 'm-text';
      tx.appendChild(text('p', 'm-title', r.title || r.query));
      tx.appendChild(text('span', 'chip', LABEL[r.state] || ''));
      if (r.state === 'rejected' && r.reason) tx.appendChild(text('p', 'm-reason', r.reason));
      li.appendChild(tx); list.appendChild(li);
    });
  }
  function refreshMine() {
    mine.filter(function (r) { return r.state !== 'played' && r.state !== 'rejected'; }).forEach(function (r) {
      api('requests/' + r.id + '?client=' + client).then(function (v) {
        for (var i = 0; i < mine.length; i++) if (mine[i].id === v.id) {
          mine[i] = Object.assign({}, mine[i], v, { thumbnailUrl: v.thumbnailUrl || mine[i].thumbnailUrl, title: v.title || mine[i].title });
        }
        store.set('mine', mine); renderMine();
      }).catch(function (err) {
        if (err.status === 404) { mine = mine.filter(function (x) { return x.id !== r.id; }); store.set('mine', mine); renderMine(); }
      });
    });
  }

  renderSeat();
  renderMine();
  loadInfo();
  refreshMine();
  setInterval(refreshMine, 6000);
  setInterval(loadInfo, 20000);
})();`;
