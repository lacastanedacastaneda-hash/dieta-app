// Rellena kcal y macros por 100 g de los productos de datos/mercadona.json (campo "nut").
//   1) Open Food Facts por código EAN (gratis, sin clave).
//   2) Si no está: IA leyendo la foto de la tabla nutricional (Gemini; OpenRouter si Gemini llega al límite).
// Las claves llegan como variables de entorno (secrets de GitHub): GEMINI_API_KEY y OPENROUTER_API_KEY (opcional).
// Sin claves, solo usa Open Food Facts. Va poco a poco: lo que no termine hoy lo sigue mañana.
// Uso: node scripts/nutricion.mjs [--max-off N] [--max-ia N] [--minutos M]
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FILE = 'datos/mercadona.json';
const opt = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFF_PAUSE = 1500; // Open Food Facts limita las consultas por minuto; si responde 429, la pausa se alarga
const IA_PAUSE = 4500; // el plan gratuito de Gemini limita las peticiones por minuto
const MAX_FAILS = 3; // tras 3 lecturas fallidas de un producto, no se vuelve a intentar

export const PROMPT = 'Lee la tabla de información nutricional de esta etiqueta de un producto de supermercado. ' +
  'Responde SOLO con JSON: {"kcal": number, "p": number, "c": number, "f": number, "u": number o null}. ' +
  'Valores POR 100 g o 100 ml (si la tabla solo da valores por ración, conviértelos a 100 g usando el peso de la ración). ' +
  'kcal = energía en kcal (no kJ); p = proteínas, c = hidratos de carbono, f = grasas, en gramos; si pone "<0,5 g", usa 0.5. ' +
  'u = peso en gramos de una unidad o ración si aparece, si no null. Si la imagen no tiene tabla nutricional o no se lee, devuelve {"kcal": -1}.';

// Lee la respuesta de la IA aunque venga entre ```json ... ``` o con texto alrededor.
export function parseAI(raw) {
  const t = String(raw || '').replace(/```(json)?/g, '').trim();
  let o;
  try { o = JSON.parse(t); } catch (e) { const m = t.match(/[[{][\s\S]*[\]}]/); try { o = m && JSON.parse(m[0]); } catch (e2) { o = null; } }
  return Array.isArray(o) ? o[0] || null : o;
}

// Deja los valores como números redondeados; null si faltan o no se pudo leer.
export function clean(o) {
  if (!o) return null;
  const n = (v) => (typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.]/g, '')) : v == null ? NaN : Number(v));
  const kcal = n(o.kcal), p = n(o.p), c = n(o.c), f = n(o.f), u = n(o.u);
  if (!(kcal >= 0) || ![p, c, f].every((x) => x >= 0)) return null;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { kcal: Math.round(kcal), p: r1(p), c: r1(c), f: r1(f), ...(u > 0 && u < 5000 ? { u: r1(u) } : {}) };
}

// ¿Cuadran las kcal con los macros (4 kcal/g proteína e hidratos, 9 kcal/g grasa)? Si no, se marca como dudoso.
export function plausible({ kcal, p, c, f }) {
  if ([p, c, f].some((x) => x > 100) || p + c + f > 105 || kcal > 950) return false;
  return Math.abs(4 * p + 4 * c + 9 * f - kcal) <= Math.max(25, 0.25 * kcal);
}

/* ---------- Open Food Facts ---------- */
export async function fromOFF(ean) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=nutriments,serving_quantity`, { headers: { 'User-Agent': 'dieta-app/1.0' } });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`Open Food Facts respondió ${r.status}`), { status: r.status });
  const j = await r.json();
  if (j.status !== 1) return null;
  const n = j.product?.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null); // energy_100g va en kJ
  if (kcal == null || n.proteins_100g == null || n.carbohydrates_100g == null || n.fat_100g == null) return null;
  return clean({ kcal, p: n.proteins_100g, c: n.carbohydrates_100g, f: n.fat_100g, u: j.product.serving_quantity });
}

/* ---------- IA: lista de modelos por orden; al agotar uno (límite o error) se pasa al siguiente ---------- */
const GAPI = 'https://generativelanguage.googleapis.com/v1beta';
const OR = 'https://openrouter.ai/api/v1';
const asText = async (r) => { try { return await r.text(); } catch (e) { return ''; } };

async function geminiModels(key) {
  try {
    const j = await (await fetch(`${GAPI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } })).json();
    const ok = (j.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/.test(m.name) && !/(image|tts|live|audio|embedding)/.test(m.name)).map((m) => m.name.replace('models/', ''));
    // Los "lite" primero: suelen tener más cuota gratuita y leer una tabla no necesita más.
    const rank = (n) => (/lite/.test(n) ? 0 : /latest/.test(n) ? 1 : 2);
    return ok.sort().reverse().sort((a, b) => rank(a) - rank(b));
  } catch (e) { return []; }
}
async function orModels() {
  try {
    const j = await (await fetch(`${OR}/models`)).json();
    return (j.data || []).filter((m) => m.id.endsWith(':free') && (m.architecture?.input_modalities || []).includes('image')).map((m) => m.id);
  } catch (e) { return []; }
}
async function callGemini(model, b64, key) {
  const r = await fetch(`${GAPI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  });
  const body = await asText(r);
  if (!r.ok) return { status: r.status, body };
  let j = {}; try { j = JSON.parse(body); } catch (e) { /* respuesta rara */ }
  return { status: 200, text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') };
}
async function callOR(model, b64, key) {
  const r = await fetch(`${OR}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Mi comida' },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] }] }),
  });
  const body = await asText(r);
  let j = {}; try { j = JSON.parse(body); } catch (e) { /* respuesta rara */ }
  const status = j.error ? Number(j.error.code) || 500 : r.status; // a veces el error llega con estado 200
  if (status !== 200) return { status, body };
  const c = j.choices?.[0]?.message?.content;
  return { status: 200, text: Array.isArray(c) ? c.map((x) => x.text || '').join('') : c };
}

export async function makeAI(env = process.env, f = { geminiModels, orModels, callGemini, callOR }) {
  const list = [];
  if (env.GEMINI_API_KEY) for (const m of await f.geminiModels(env.GEMINI_API_KEY)) list.push({ via: 'gemini', model: m, call: (b) => f.callGemini(m, b, env.GEMINI_API_KEY) });
  if (env.OPENROUTER_API_KEY) for (const m of await f.orModels()) list.push({ via: 'openrouter', model: m, call: (b) => f.callOR(m, b, env.OPENROUTER_API_KEY) });
  let i = 0;
  return {
    size: list.length,
    // Devuelve {text, via, model} o null si ya no queda ningún modelo con cuota hoy.
    async read(b64, wait = sleep) {
      let minuteWaits = 0, busyWaits = 0;
      while (i < list.length) {
        const m = list[i];
        const r = await m.call(b64);
        if (r.status === 200) return { text: r.text, via: m.via, model: m.model };
        // 429 por minuto: se espera y se repite. 429 por día: ese modelo ya no sirve hoy.
        if (r.status === 429 && !/per ?day|daily|PerDay/i.test(r.body || '') && minuteWaits < 2) { minuteWaits++; await wait(65000); continue; }
        if ((r.status === 503 || r.status === 500) && busyWaits < 2) { busyWaits++; await wait(15000); continue; }
        console.log(`  ${m.via} ${m.model}: ${r.status}; paso al siguiente modelo`);
        i++; minuteWaits = 0; busyWaits = 0;
      }
      return null;
    },
  };
}

async function labelB64(img, label) {
  const r = await fetch(`${img}${label}?fit=max&w=1200&h=1200&fm=jpg`);
  if (!r.ok) throw new Error(`foto ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

export const toText = (data) => `{${Object.entries(data).filter(([k]) => k !== 'products').map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')},"products":[\n${data.products.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`;

async function main() {
  const MAX_OFF = opt('--max-off', Infinity), MAX_IA = opt('--max-ia', Infinity), deadline = Date.now() + opt('--minutos', 150) * 60000;
  const data = JSON.parse(await readFile(FILE, 'utf8'));
  const ai = await makeAI();
  console.log(ai.size ? `IA: ${ai.size} modelos disponibles` : 'Sin claves de IA: solo Open Food Facts');
  let aiOn = ai.size > 0;
  const st = { off: 0, offOk: 0, ia: 0, iaOk: 0, dud: 0, fail: 0 };
  // Open Food Facts: con 429 espera un minuto, duplica la pausa (máx. 8 s) y repite. undefined = sin respuesta (se reintenta otro día).
  let offPause = OFF_PAUSE;
  const offLookup = async (ean) => {
    for (let i = 0; i < 3; i++) {
      try { return await fromOFF(ean); } catch (e) {
        if (e.status !== 429) { console.warn(`  OFF ${ean}: ${e.message}`); return undefined; }
        offPause = Math.min(offPause * 2, 8000);
        console.log(`  Open Food Facts pide ir más despacio: espero 1 min (pausa ${offPause / 1000} s)`);
        await sleep(60000);
      }
    }
    return undefined;
  };
  const put = (p, n, src) => { p.nut = { ...n, src, ...(plausible(n) ? {} : { dud: true }) }; delete p.off; delete p.iaFail; if (p.nut.dud) st.dud++; };

  for (const p of data.products) {
    if (p.nut) continue;
    if (Date.now() > deadline) { console.log('Se acabó el tiempo de hoy; sigo en la próxima ejecución.'); break; }
    // 1) Open Food Facts (una sola vez por producto)
    if (p.ean && p.off === undefined) {
      if (st.off >= MAX_OFF) continue; // primero OFF, para no gastar IA en lo que OFF ya tiene
      st.off++;
      const n = await offLookup(p.ean);
      if (n) { put(p, n, 'off'); st.offOk++; } else if (n === null) p.off = false;
      await sleep(offPause);
      if (p.nut || n === undefined) continue; // sin respuesta de OFF: no se gasta IA, se reintenta otro día
    }
    // 2) IA con la foto de la tabla
    if (!aiOn || !p.label || (p.iaFail || 0) >= MAX_FAILS || st.ia >= MAX_IA) continue;
    st.ia++;
    try {
      const r = await ai.read(await labelB64(data.img, p.label));
      if (!r) { aiOn = false; console.log('La IA no tiene más cuota hoy; sigo en la próxima ejecución.'); continue; }
      const n = clean(parseAI(r.text));
      if (n) { put(p, n, r.via); st.iaOk++; } else { p.iaFail = (p.iaFail || 0) + 1; st.fail++; }
    } catch (e) { p.iaFail = (p.iaFail || 0) + 1; st.fail++; console.warn(`  IA ${p.id}: ${e.message}`); }
    if (st.ia % 50 === 0) console.log(`  IA: ${st.ia} leídas`);
    await sleep(IA_PAUSE);
  }

  await writeFile(FILE, toText(data));
  const total = data.products.length, con = data.products.filter((p) => p.nut).length;
  console.log(`Open Food Facts: ${st.offOk} de ${st.off} · IA: ${st.iaOk} de ${st.ia} (fallos ${st.fail}) · dudosos nuevos: ${st.dud}`);
  console.log(`Con datos nutricionales: ${con} de ${total} (${Math.round((con / total) * 100)} %)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
