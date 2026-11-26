/** QR codes for the guest page: images for the booth / Screen 2 and the printable sheet. */
import QRCode from 'qrcode';
import type { GuestPageSettings } from '../../shared/types';

export interface QrImages {
  /** SVG for the booth (sharp at any size). */
  svg: string;
  /** PNG for Screen 2: drawing an SVG data URL on the output canvas could taint it. */
  png: string;
}

export async function qrImages(url: string): Promise<QrImages> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return {
    svg: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    png: await QRCode.toDataURL(url, { margin: 2, width: 360, errorCorrectionLevel: 'M' })
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function card(url: string, heading: string, page: GuestPageSettings, wifiHint: boolean): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `<div class="card">${page.venueName ? `<p class="venue">${escapeHtml(page.venueName)}</p>` : ''}<h2>${escapeHtml(heading)}</h2>${svg}<p>Escanea y pide tu canción</p>${
    wifiHint && page.wifiName ? `<p>Conéctate al WiFi «${escapeHtml(page.wifiName)}»</p>` : ''
  }</div>`;
}

/**
 * Printable page with a general QR and one per table (1..tables).
 * `wifiHint` = the QR only works on the venue network (local mode).
 */
export async function buildQrSheet(
  urlFor: (table?: string) => string,
  tables: number,
  page: GuestPageSettings,
  wifiHint: boolean
): Promise<string> {
  const count = Math.max(0, Math.min(100, Math.round(tables)));
  const cards: string[] = [await card(urlFor(), 'Pide tu canción', page, wifiHint)];
  for (let i = 1; i <= count; i += 1) cards.push(await card(urlFor(String(i)), `Mesa ${i}`, page, wifiHint));
  const hint = wifiHint
    ? 'Cada QR funciona mientras Proyecta esté abierto en «Solo red del local» y el celular esté en la misma red WiFi.'
    : 'Cada QR funciona desde cualquier red mientras Proyecta esté abierto y conectado a internet.';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR para pedir canciones</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:12mm;font-family:Segoe UI,system-ui,sans-serif;color:#111;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
.card{border:1px solid #ccc;border-radius:4mm;padding:6mm;text-align:center;break-inside:avoid}
.card svg{width:100%;height:auto;max-width:55mm}
h2{margin:0 0 2mm;font-size:16pt}p{margin:1.5mm 0;font-size:10pt;color:#333}.venue{font-weight:600;color:#111}
.hint{font-size:11pt;margin-bottom:8mm}@media print{.hint{display:none}body{padding:8mm}}
</style></head><body>
<p class="hint">Imprime esta página (Ctrl + P). ${hint}</p>
<div class="grid">${cards.join('')}</div></body></html>`;
}
