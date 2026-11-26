/**
 * Guest page served by `LocalRequestServer` (phones on the venue WiFi). Plain HTML, CSS
 * and JS with no external resources, so it works under its own strict CSP and offline
 * from the internet. User text is only ever written with textContent.
 */

export const GUEST_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Pide tu canción</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main>
  <header>
    <p id="venue" class="venue"></p>
    <h1>Pide tu canción</h1>
    <p id="table" class="table" hidden></p>
  </header>

  <section id="now" class="now" hidden aria-live="polite">
    <p class="label">Suena ahora</p>
    <p id="now-title" class="now-title"></p>
    <p id="now-artist" class="muted"></p>
  </section>

  <form id="form" autocomplete="off">
    <label for="query">Canción</label>
    <input id="query" name="query" maxlength="120" required placeholder="Artista y canción" enterkeyhint="send">
    <div id="table-field">
      <label for="table-input">Mesa <span class="muted">(opcional)</span></label>
      <input id="table-input" name="table" maxlength="40" inputmode="text">
    </div>
    <label for="guest">Tu nombre <span class="muted">(opcional)</span></label>
    <input id="guest" name="guest" maxlength="60" autocomplete="given-name">
    <button id="send" type="submit">Pedir canción</button>
    <p id="error" class="error" role="alert" hidden></p>
  </form>

  <section id="mine" hidden>
    <h2>Tus pedidos</h2>
    <ul id="list"></ul>
  </section>

  <p id="closed" class="error" hidden></p>
  <footer class="muted">El DJ revisa cada pedido antes de ponerlo.</footer>
</main>
<script src="/app.js"></script>
</body>
</html>`;

export const GUEST_CSS = `
*{box-sizing:border-box}
html{background:#000;color:#f5f5f6;font-family:"Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh}
main{max-width:480px;margin:0 auto;padding:24px 16px calc(32px + env(safe-area-inset-bottom))}
h1{font-size:26px;line-height:1.15;margin:4px 0 0;font-weight:700}
h2{font-size:15px;margin:28px 0 8px;font-weight:600}
.venue{margin:0;color:#c9c9cf;font-size:14px;font-weight:600}
.table{margin:8px 0 0;display:inline-block;padding:4px 10px;border-radius:999px;background:#1e1e22;color:#f0fdff;font-weight:600;font-size:13px}
.muted{color:#9c9ca6;font-weight:400}
.label{margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9c9ca6;font-weight:600}
.now{margin-top:20px;padding:12px 14px;border-radius:12px;background:#0b0b0d;border:1px solid rgba(255,255,255,.08)}
.now p{margin:2px 0}.now-title{font-weight:600}
form{margin-top:24px;display:flex;flex-direction:column;gap:6px}
label{font-size:13px;font-weight:600;margin-top:10px}
input{font:inherit;font-size:17px;color:#f5f5f6;background:#151518;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px 14px;min-height:48px;width:100%}
input:focus{outline:none;border-color:rgba(255,255,255,.4)}
button{font:inherit;margin-top:16px;min-height:52px;border:0;border-radius:12px;background:#f0fdff;color:#000;font-size:17px;font-weight:700;cursor:pointer}
button:disabled{opacity:.5}
button:focus-visible{outline:2px solid rgba(240,253,255,.6);outline-offset:2px}
.error{margin:10px 0 0;color:#ffa39d;font-size:14px}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
li{padding:12px 14px;border-radius:12px;background:#0b0b0d;border:1px solid rgba(255,255,255,.08)}
li .q{margin:0;font-weight:600;overflow-wrap:anywhere}
li .s{margin:4px 0 0;font-size:14px;color:#c9c9cf}
li[data-state="playing"]{border-color:rgba(240,253,255,.5)}
li[data-state="playing"] .s{color:#f0fdff;font-weight:600}
li[data-state="rejected"] .s{color:#ffa39d}
footer{margin-top:32px;font-size:13px}
@media (prefers-reduced-motion:no-preference){button{transition:transform .15s cubic-bezier(.16,1,.3,1)}button:active{transform:scale(.98)}}
`;

export const GUEST_JS = `(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var key = params.get('k') || '';
  var table = (params.get('mesa') || '').slice(0, 40);
  var STORE = 'proyecta.requests.' + key.slice(0, 8);
  var $ = function (id) { return document.getElementById(id); };
  var mine = [];
  try { mine = JSON.parse(localStorage.getItem(STORE) || '[]').slice(-5); } catch (e) { mine = []; }

  function save() { try { localStorage.setItem(STORE, JSON.stringify(mine.slice(-5))); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      body: opts.body,
      headers: { 'Content-Type': 'application/json', 'X-Proyecta-Key': key },
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) { var err = new Error(body.error || 'No se pudo conectar con el DJ.'); err.status = r.status; throw err; }
        return body;
      });
    });
  }

  if (table) {
    var t = $('table');
    t.textContent = /^\\d+$/.test(table) ? 'Mesa ' + table : table;
    t.hidden = false;
    $('table-field').hidden = true;
  }

  function closed(msg) {
    $('form').hidden = true;
    var c = $('closed');
    c.textContent = msg;
    c.hidden = false;
  }

  function loadInfo() {
    api('/api/info').then(function (info) {
      $('venue').textContent = info.venueName || '';
      var np = info.nowPlaying;
      $('now').hidden = !np;
      if (np) { $('now-title').textContent = np.title; $('now-artist').textContent = np.artist; }
      $('form').hidden = false; $('closed').hidden = true;
    }).catch(function (err) {
      if (err.status === 403 || err.status === 503) closed(err.message);
    });
  }

  var LABEL = {
    searching: 'Buscando la canción…',
    pending: 'Esperando al DJ',
    queued: 'En la lista: sonará pronto',
    playing: 'Sonando ahora',
    played: 'Ya sonó',
    rejected: ''
  };

  function render() {
    var list = $('list');
    list.textContent = '';
    $('mine').hidden = mine.length === 0;
    mine.slice().reverse().forEach(function (r) {
      var li = document.createElement('li');
      li.setAttribute('data-state', r.state);
      var q = document.createElement('p'); q.className = 'q'; q.textContent = r.title || r.query;
      var s = document.createElement('p'); s.className = 's';
      s.textContent = r.state === 'rejected' ? (r.reason || 'No se pudo poner esta vez.') : (LABEL[r.state] || '');
      li.appendChild(q); li.appendChild(s); list.appendChild(li);
    });
  }

  function refresh() {
    var open = mine.filter(function (r) { return r.state !== 'played' && r.state !== 'rejected'; });
    open.forEach(function (r) {
      api('/api/requests/' + r.id).then(function (v) {
        for (var i = 0; i < mine.length; i++) if (mine[i].id === v.id) mine[i] = v;
        save(); render();
      }).catch(function (err) {
        if (err.status === 404) { mine = mine.filter(function (x) { return x.id !== r.id; }); save(); render(); }
      });
    });
  }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('send'); var errEl = $('error');
    errEl.hidden = true; btn.disabled = true;
    api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        query: $('query').value,
        table: table || $('table-input').value,
        guest: $('guest').value
      })
    }).then(function (v) {
      mine.push(v); save(); render();
      $('query').value = '';
    }).catch(function (err) {
      errEl.textContent = err.message; errEl.hidden = false;
    }).then(function () { btn.disabled = false; });
  });

  render();
  loadInfo();
  refresh();
  setInterval(refresh, 5000);
  setInterval(loadInfo, 20000);
})();`;
