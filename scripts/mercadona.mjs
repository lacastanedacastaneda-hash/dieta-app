// Descarga el catálogo de Mercadona (API no oficial de tienda.mercadona.es) y lo guarda en datos/mercadona.json.
// Lo ejecuta GitHub Actions cada semana. Solo usa Node (18 o más), sin dependencias.
// Uso: node scripts/mercadona.mjs [--max N]   (--max limita las fichas nuevas que se piden, para probar)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const WH = 'bcn1'; // almacén del código postal 08901
const API = 'https://tienda.mercadona.es/api';
const OUT = 'datos/mercadona.json';
const PAUSE = 400; // ms entre llamadas, para no cargar su servidor
const IMG = 'https://prod-mercadona.imgix.net/images/';

const arg = process.argv.indexOf('--max');
const MAX = arg > 0 ? Number(process.argv[arg + 1]) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}lang=es&wh=${WH}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= 3) throw new Error(`${path}: ${e.message}`);
      await sleep(5000 * i);
    }
  }
}
// "https://prod-mercadona.imgix.net/images/abc.jpg?fit=..." -> "abc.jpg"
const imgId = (url) => (url && url.startsWith(IMG) ? url.slice(IMG.length).split('?')[0] : '');
const num = (s) => (s == null || String(s).trim() === '' ? null : Number(String(s).trim()));

// Tamaño total del envase en g o ml (null si se vende por unidades u otro formato).
// unit_size ya es el total: "Pack-6 1,2 l" son 6 × 200 ml.
function size(pi) {
  const k = { kg: 1000, g: 1, l: 1000, ml: 1 }[pi.size_format];
  return k && pi.unit_size ? Math.round(pi.unit_size * k) : null;
}

async function main() {
  let old = new Map();
  try { old = new Map(JSON.parse(await readFile(OUT, 'utf8')).products.map((p) => [p.id, p])); } catch (e) { /* primera vez */ }

  // 1) Precios: categorías y subcategorías.
  const tree = await get('/categories/');
  const subs = tree.results.flatMap((t) => t.categories.map((c) => ({ id: c.id, top: t.name })));
  const list = new Map();
  for (const s of subs) {
    const d = await get(`/categories/${s.id}/`);
    for (const sc of d?.categories || []) {
      for (const p of sc.products || []) {
        if (list.has(p.id) || !p.published) continue;
        const pi = p.price_instructions || {};
        list.set(p.id, {
          id: p.id,
          name: p.display_name,
          fmt: [p.packaging, pi.unit_size && pi.size_format ? `${String(pi.unit_size).replace('.', ',')} ${pi.size_format}` : ''].filter(Boolean).join(' '),
          price: num(pi.unit_price),
          ref: num(pi.reference_price),
          refUnit: pi.reference_format || null,
          size: size(pi),
          cat: `${s.top} › ${sc.name}`,
          img: imgId(p.thumbnail),
        });
      }
    }
    await sleep(PAUSE);
  }
  console.log(`Subcategorías: ${subs.length} · productos: ${list.size}`);
  if (list.size < 1000 || (old.size && list.size < old.size * 0.7)) throw new Error(`Demasiados pocos productos (${list.size}); no se guarda nada.`);

  // 2) Fichas: código EAN y foto de la tabla nutricional. Solo productos nuevos o con la foto cambiada.
  let asked = 0, failed = 0;
  for (const p of list.values()) {
    const o = old.get(p.id);
    if (o && o.img === p.img && 'label' in o) { p.ean = o.ean; p.label = o.label; continue; }
    if (asked >= MAX) continue;
    asked++;
    try {
      const d = await get(`/products/${p.id}/`);
      const lab = (d?.photos || []).find((f) => f.perspective === 9);
      p.ean = d?.ean || null;
      p.label = imgId(lab?.regular); // '' = no tiene foto de la tabla
    } catch (e) {
      failed++;
      if (o) { p.ean = o.ean; p.label = o.label; } // se reintenta la próxima semana
      console.warn(e.message);
    }
    if (asked % 250 === 0) console.log(`Fichas pedidas: ${asked}`);
    await sleep(PAUSE);
  }
  console.log(`Fichas pedidas: ${asked} · con error: ${failed}`);

  // Un producto por línea, para que en GitHub se vean bien los cambios de precio.
  const items = [...list.values()];
  const txt = `{"updated":"${new Date().toISOString()}","wh":"${WH}","img":"${IMG}","products":[\n${items.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`;
  await mkdir('datos', { recursive: true });
  await writeFile(OUT, txt);
  console.log(`Guardado ${OUT} (${(txt.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
