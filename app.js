/* Mi comida — fase 1. Todo se guarda en el móvil (localStorage). */
const KEY = 'dieta.v1';
const DEF = {
  settings: { target: 2150, p: 140, c: 220, f: 65, gymKcal: 350, gymDays: [1, 2, 3, 4], floor: 1500, apiKey: '', model: 'gemini-flash-latest', startWeight: 100, goalWeight: 85 },
  days: {},
  weights: {},
  products: {},
};
let db = load();
let view = 'hoy';
let photo = null;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return { ...structuredClone(DEF), ...d, settings: { ...DEF.settings, ...d.settings } };
  } catch (e) { /* datos corruptos: se empieza de cero */ }
  return structuredClone(DEF);
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
const dayRW = (k) => db.days[k] || (db.days[k] = { entries: [] });
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (n) => Math.round(n).toLocaleString('es-ES');
const n1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es-ES');
const todayKey = () => L.iso(new Date());
const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100));
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DOWFULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/* ---------- Vistas ---------- */
function viewHoy() {
  const k = todayKey(), now = new Date(), s = db.settings;
  const p = L.plan(db, k), t = L.tot(db, k), d = L.dayRO(db, k);
  const left = p.todayTarget - t.kcal;
  const sched = s.gymDays.includes(now.getDay());
  let gym = '';
  if (sched && !d.gym) {
    gym = `<section class="card gym row"><div style="flex:1"><h2>¿Fuiste al gimnasio?</h2><p class="mut">Se guardan ${n0(s.gymKcal)} kcal</p></div>
      <button class="btn primary" data-act="gym" data-v="yes">Sí</button><button class="btn" data-act="gym" data-v="no">No</button></section>`;
  } else if (d.gym) {
    const txt = d.gym === 'yes' ? (sched ? 'Gimnasio hecho' : `Sesión extra · +${n0(s.gymKcal)} kcal de margen`) : `Gimnasio saltado · −${n0(s.gymKcal)} kcal de margen`;
    gym = `<section class="card row between"><span style="font-size:14px;font-weight:600">${txt}</span><button class="btn ghost" data-act="gym" data-v="">Cambiar</button></section>`;
  } else {
    gym = `<section class="card row between"><span class="mut">Hoy no toca gimnasio</span><button class="btn ghost" data-act="gym" data-v="yes">Hice una sesión extra</button></section>`;
  }
  const meals = [...d.entries].sort((a, b) => a.t.localeCompare(b.t)).map((e) => `
    <div class="meal ${e.extra ? 'extra' : ''}"><span class="t">${esc(e.t)}</span>
      <div class="n">${esc(e.name)}<span class="mut" style="font-weight:400;display:block">${esc(e.meal)}${e.extra ? '' : ''}</span>${e.extra ? '<span class="tag">FUERA DE DIETA</span>' : ''}</div>
      <span class="k">${e.extra ? '+' : ''}${n0(e.kcal)} kcal</span>
      <button class="del" data-act="del" data-id="${e.id}" aria-label="Borrar ${esc(e.name)}">✕</button></div>`).join('');
  const adj = p.adjust === 0 ? 'Sin ajuste esta semana' : `Base ${n0(s.target)} · ajuste semanal ${p.adjust > 0 ? '+' : '−'}${n0(Math.abs(p.adjust))} kcal${p.floored ? ' (límite mínimo)' : ''}`;
  const mac = (lab, v, goal) => `<div><span class="mut">${lab}</span><b>${n0(v)} / ${n0(goal)} g</b><div class="bar thin"><i style="width:${pct(v, goal)}%"></i></div></div>`;
  return `<p class="sub">${DOWFULL[now.getDay()]}${sched ? ' · día de gimnasio' : ''}</p><h1>Hoy</h1>
  <section class="card">
    <div class="row between" style="align-items:flex-end"><div><span class="big-n">${n0(t.kcal)}</span> <span class="mut" style="font-size:15px">/ ${n0(p.todayTarget)} kcal</span></div>
    <span class="${left < 0 ? 'mut' : 'ok'}" style="${left < 0 ? 'color:var(--orange);font-weight:600;font-size:13px' : ''}">${left >= 0 ? n0(left) + ' restantes' : n0(-left) + ' de más'}</span></div>
    <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct(t.kcal, p.todayTarget)}%"></i></div>
    <p class="mut" style="margin:0">${adj}</p>
    <div class="macros">${mac('Proteína', t.p, s.p)}${mac('Carbohidratos', t.c, s.c)}${mac('Grasa', t.f, s.f)}</div>
  </section>
  ${gym}
  <h2 style="margin:18px 0 0">Comidas</h2>
  ${meals || '<p class="mut">Todavía no has añadido nada hoy.</p>'}
  <button class="btn primary big" data-act="add">Añadir comida o extra</button>`;
}

function viewSemana() {
  const k = todayKey(), s = db.settings, p = L.plan(db, k);
  const tots = p.keys.map((kk) => L.tot(db, kk).kcal);
  const max = Math.max(2600, ...tots) * 1.05, H = 140;
  const bars = p.keys.map((kk, i) => {
    const d = L.dayRO(db, kk), hasExtra = d.entries.some((e) => e.extra);
    if (!d.entries.length) return '<div class="b e"></div>';
    return `<div class="b ${kk === k ? 'now' : hasExtra ? 'x' : ''}" style="height:${Math.round((tots[i] / max) * H)}px" title="${n0(tots[i])} kcal"></div>`;
  }).join('');
  const lbl = p.keys.map((kk, i) => `<span style="${kk === k ? 'font-weight:700;color:var(--ink)' : ''}">${DOW[i]}</span>`).join('');
  const extras = p.keys.flatMap((kk) => L.dayRO(db, kk).entries.filter((e) => e.extra));
  const gymDone = p.keys.filter((kk) => L.dayRO(db, kk).gym === 'yes').length;
  const gymPlan = s.gymDays.length;
  const wk = Object.keys(db.weights).sort();
  const wLast = wk.length ? db.weights[wk[wk.length - 1]] : null;
  const lost = wLast !== null ? s.startWeight - wLast : 0;
  return `<p class="sub">Semana actual</p><h1>Semana</h1>
  <section class="card"><div class="row between"><h2>Calorías por día</h2><span class="mut">Línea: ${n0(s.target)} kcal</span></div>
    <div class="chart"><div class="line" style="bottom:${Math.round((s.target / max) * H)}px"></div>${bars}</div>
    <div class="days">${lbl}</div>
    <p class="mut" style="margin:10px 0 0">Naranja: día con extra · verde claro: hoy</p></section>
  <div class="two">
    <section class="card"><p class="mut" style="margin:0">Presupuesto semanal</p><b style="font-size:22px">${n0(p.weekly)}</b><p class="mut" style="margin:2px 0 0">kcal · quedan ${n0(p.weekly - p.eaten)}</p></section>
    <section class="card"><p class="mut" style="margin:0">Extras de la semana</p><b style="font-size:22px;color:var(--orange)">${extras.length}</b><p class="mut" style="margin:2px 0 0">${n0(extras.reduce((a, e) => a + e.kcal, 0))} kcal en total</p></section>
  </div>
  <section class="card"><div class="row between"><h2>Gimnasio</h2><span class="mut" style="font-size:13px">${gymDone} sesiones (previstas: ${gymPlan})</span></div></section>
  <section class="card"><div class="row between"><h2>Peso</h2><span class="mut" style="font-size:13px">${n0(s.startWeight)} kg → ${n0(s.goalWeight)} kg</span></div>
    ${wLast !== null ? `<p style="margin:8px 0 0"><b style="font-size:22px">${n1(wLast)} kg</b> <span class="ok">${lost >= 0 ? '−' : '+'}${n1(Math.abs(lost))} kg desde el inicio</span></p>
    <div class="bar"><i style="width:${pct(lost, s.startWeight - s.goalWeight)}%"></i></div>` : '<p class="mut">Registra tu peso en Ajustes.</p>'}</section>`;
}

function viewAjustes() {
  const s = db.settings;
  const num = (id, lab, v, step = 1) => `<div><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="${step}" value="${v}"></div>`;
  return `<h1>Ajustes</h1>
  <form id="setForm" class="card">
    <h2>Objetivos diarios</h2>
    <div class="two">${num('sTarget', 'Calorías base', s.target)}${num('sFloor', 'Mínimo diario', s.floor)}${num('sP', 'Proteína g', s.p)}${num('sC', 'Carbohidratos g', s.c)}${num('sF', 'Grasa g', s.f)}${num('sGym', 'kcal por sesión', s.gymKcal)}</div>
    <p class="mut">El mínimo evita que el ajuste semanal te deje un objetivo demasiado bajo en un día.</p>
    <div class="two">${num('sW0', 'Peso inicial kg', s.startWeight, 0.1)}${num('sW1', 'Peso objetivo kg', s.goalWeight, 0.1)}</div>
    <h2 style="margin-top:18px">Estimación con IA (Gemini)</h2>
    <label for="sKey">Clave de API de Gemini</label><input id="sKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="Pégala aquí (se guarda solo en este móvil)">
    <label for="sModel">Modelo</label><input id="sModel" type="text" value="${esc(s.model)}">
    <button class="btn primary big" type="submit">Guardar ajustes</button>
  </form>
  <form id="wForm" class="card"><h2>Peso de hoy</h2>
    <div class="row"><input id="wVal" type="number" inputmode="decimal" step="0.1" placeholder="kg" style="flex:1"><button class="btn" type="submit">Guardar peso</button></div></form>
  <section class="card"><h2>Copia de seguridad</h2><p class="mut">Tus datos viven solo en este móvil. Descarga una copia de vez en cuando.</p>
    <div class="row"><button class="btn" data-act="export">Descargar copia</button>
    <label class="btn" for="imp" style="margin:0">Restaurar copia</label><input id="imp" type="file" accept="application/json" hidden></div></section>`;
}

function render() {
  $('#app').innerHTML = { hoy: viewHoy, semana: viewSemana, ajustes: viewAjustes }[view]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
}

/* ---------- Acciones ---------- */
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) { view = nav.dataset.nav; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const k = todayKey();
  switch (el.dataset.act) {
    case 'gym': dayRW(k).gym = el.dataset.v || undefined; save(); render(); break;
    case 'del': { const d = dayRW(k); d.entries = d.entries.filter((e) => String(e.id) !== el.dataset.id); save(); render(); break; }
    case 'add': openDialog(); break;
    case 'export': exportData(); break;
  }
});

document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'setForm') {
    ev.preventDefault();
    const g = (id) => Number($('#' + id).value);
    Object.assign(db.settings, { target: g('sTarget'), floor: g('sFloor'), p: g('sP'), c: g('sC'), f: g('sF'), gymKcal: g('sGym'), startWeight: g('sW0'), goalWeight: g('sW1'), apiKey: $('#sKey').value.trim(), model: $('#sModel').value.trim() || DEF.settings.model });
    save(); render();
  } else if (ev.target.id === 'wForm') {
    ev.preventDefault();
    const v = Number($('#wVal').value);
    if (v > 0) { db.weights[todayKey()] = v; save(); view = 'semana'; render(); }
  }
});

document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'imp') {
    try {
      const d = JSON.parse(await ev.target.files[0].text());
      if (!d.settings || !d.days) throw new Error('formato');
      db = { ...structuredClone(DEF), ...d, settings: { ...DEF.settings, ...d.settings } }; save(); render();
    } catch (e) { alert('No he podido leer esa copia.'); }
  }
});

function exportData() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = `mi-comida-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Añadir ---------- */
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mode = 'prod', cur = null, scanning = false, camStream = null;
let merc = null; // producto de Mercadona elegido en «Nuevo» (número, precio y tamaño del envase)

function show(m) {
  mode = m; stopScan();
  for (const s of ['prod', 'new', 'ia', 'qty']) $('#m-' + s).hidden = s !== m;
  $('#common').hidden = !(m === 'qty' || m === 'ia');
  document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === (m === 'qty' ? 'prod' : m)));
  if (m === 'prod') renderProducts();
}
function guessMeal(h) { return h < 11.5 ? 'Desayuno' : h < 16 ? 'Comida' : 'Cena'; }
function openDialog() {
  $('#addForm').reset(); photo = null; cur = null; merc = null; $('#mList').innerHTML = ''; setMsg(''); setNew('');
  const n = new Date();
  $('#fMeal').value = guessMeal(n.getHours() + n.getMinutes() / 60);
  show(Object.keys(db.products).length ? 'prod' : 'new');
  $('#dlg').showModal();
}
function setMsg(t, err) { const m = $('#estMsg'); m.textContent = t; m.className = 'hint' + (err ? ' err' : ''); }
function setNew(t, err) { const m = $('#newMsg'); m.textContent = t; m.className = 'hint' + (err ? ' err' : ''); }

$('#dlgClose').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('close', stopScan);
$('#seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.mode); });

/* --- Mis productos --- */
function renderProducts() {
  const q = $('#pSearch').value.trim().toLowerCase();
  const list = Object.values(db.products).filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => (b.last || 0) - (a.last || 0) || a.name.localeCompare(b.name));
  $('#pList').innerHTML = list.length
    ? list.map((p) => `<button type="button" class="meal pick" data-pid="${p.id}"><span class="n">${esc(p.name)}<span class="mut" style="font-weight:400;display:block">${n0(p.kcal)} kcal · P ${n1(p.p)} · C ${n1(p.c)} · G ${n1(p.f)} por 100 g</span></span></button>`).join('')
    : '<p class="mut">Todavía no tienes productos guardados. Pulsa «Nuevo» para añadir el primero.</p>';
}
$('#pSearch').addEventListener('input', renderProducts);
$('#pList').addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) selectProduct(b.dataset.pid); });

function selectProduct(id) {
  cur = db.products[id]; if (!cur) return;
  $('#qName').textContent = cur.name;
  $('#qInfo').textContent = `${n0(cur.kcal)} kcal · P ${n1(cur.p)} · C ${n1(cur.c)} · G ${n1(cur.f)} por 100 g`;
  $('#qUwrap').hidden = !cur.unitG;
  $('#qG').value = cur.unitG || 100;
  $('#qU').value = cur.unitG ? 1 : '';
  updateQty(); show('qty');
}
const qtyG = () => Number($('#qG').value) || 0;
function updateQty() {
  const k = qtyG() / 100;
  $('#qCalc').textContent = `${n0(cur.kcal * k)} kcal · P ${n1(cur.p * k)} g · C ${n1(cur.c * k)} g · G ${n1(cur.f * k)} g`;
}
$('#qG').addEventListener('input', () => { if (cur?.unitG) $('#qU').value = r1(qtyG() / cur.unitG); updateQty(); });
$('#qU').addEventListener('input', () => { if (cur?.unitG) { $('#qG').value = Math.round(Number($('#qU').value) * cur.unitG); updateQty(); } });
$('#btnDelProd').addEventListener('click', () => {
  if (cur && confirm(`¿Borrar «${cur.name}» de tu lista de productos? Lo ya registrado no cambia.`)) { delete db.products[cur.id]; save(); cur = null; show('prod'); }
});

/* --- Nuevo producto --- */
const num = (id) => Number($(id).value);
function fillNew(o) {
  if (o.name) $('#nName').value = o.name;
  $('#nKcal').value = Math.round(o.kcal); $('#nP').value = r1(o.p || 0); $('#nC').value = r1(o.c || 0); $('#nF').value = r1(o.f || 0);
  $('#nUnit').value = o.unitG > 0 ? o.unitG : '';
}
$('#btnSaveProd').addEventListener('click', () => {
  const name = $('#nName').value.trim();
  if (!name || $('#nKcal').value === '') return setNew('Falta el nombre y las kcal por 100 g.', true);
  const barcode = $('#nCode').value.replace(/\D/g, '') || undefined;
  const all = Object.values(db.products);
  const old = (merc && all.find((p) => p.mid === merc.mid)) || (barcode && all.find((p) => p.barcode === barcode));
  const id = old ? old.id : String(Date.now());
  db.products[id] = { id, barcode, name, kcal: num('#nKcal'), p: num('#nP') || 0, c: num('#nC') || 0, f: num('#nF') || 0, unitG: num('#nUnit') || undefined, last: Date.now(), ...(merc || {}) };
  save(); $('#nCode').value = ''; selectProduct(id);
});

async function lookup() {
  const code = $('#nCode').value.replace(/\D/g, '');
  if (code.length < 8) return setNew('Escribe un código de 8 a 13 cifras.', true);
  const ex = Object.values(db.products).find((p) => p.barcode === code);
  if (ex) return selectProduct(ex.id);
  setNew('Buscando en Open Food Facts…');
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
    const j = await r.json();
    if (j.status !== 1) return setNew('Ese código no está en la base. Haz una foto de la etiqueta.', true);
    const n = j.product.nutriments || {};
    const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : NaN);
    if (!(kcal >= 0)) return setNew('El producto no trae datos nutricionales. Haz una foto de la etiqueta.', true);
    fillNew({ name: [j.product.product_name, j.product.brands].filter(Boolean).join(' · '), kcal, p: n['proteins_100g'], c: n['carbohydrates_100g'], f: n['fat_100g'], unitG: Number(j.product.serving_quantity) });
    setNew('Datos de Open Food Facts. Compáralos con tu etiqueta antes de guardar.');
  } catch (e) { setNew('Sin conexión. Rellena los datos a mano o usa la foto de la etiqueta.', true); }
}
$('#btnLookup').addEventListener('click', lookup);
$('#nCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });

function stopScan() {
  scanning = false;
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  const v = $('#scanVideo'); if (v) { v.srcObject = null; v.hidden = true; }
}
$('#btnScan').addEventListener('click', async () => {
  if (scanning) return stopScan();
  if (!('BarcodeDetector' in window)) return setNew('Este navegador no puede escanear. Escribe el número o haz una foto de la etiqueta.', true);
  try {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#scanVideo'); v.srcObject = camStream; v.hidden = false; await v.play();
    scanning = true; setNew('Apunta al código de barras…');
    while (scanning) {
      const found = await det.detect(v).catch(() => []);
      if (found.length) { $('#nCode').value = found[0].rawValue; stopScan(); return lookup(); }
      await sleep(250);
    }
  } catch (e) { stopScan(); setNew('No he podido usar la cámara. Revisa el permiso o escribe el número.', true); }
});

const LABEL_PROMPT = 'Lee la tabla de información nutricional de esta etiqueta de un producto de supermercado. ' +
  'Responde SOLO con JSON: {"name": string o null, "kcal": number, "p": number, "c": number, "f": number, "unitG": number o null}. ' +
  'Los valores deben ser POR 100 g (si la tabla solo da valores por ración, conviértelos a 100 g usando el peso de la ración). ' +
  'kcal = energía en kcal (no kJ), p = proteínas, c = hidratos de carbono, f = grasas, en gramos. ' +
  'unitG = peso en gramos de una unidad o ración si aparece, si no null. Si la tabla no se lee bien, devuelve kcal = -1.';
$('#nPhoto').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  setNew('Leyendo la etiqueta…');
  try {
    const o = await gemini([{ text: LABEL_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: await shrink(f, 1600) } }]);
    if (!(o.kcal >= 0)) throw new Error('No he podido leer la tabla. Prueba con más luz y la etiqueta recta.');
    fillNew({ name: o.name, kcal: +o.kcal, p: +o.p, c: +o.c, f: +o.f, unitG: +o.unitG });
    setNew('Leído de la etiqueta. Compruébalo con la tabla antes de guardar.');
  } catch (err) { setNew(err.message, true); }
  e.target.value = '';
});

/* --- Catálogo de Mercadona (datos/mercadona.json, lo actualiza GitHub Actions cada jueves) --- */
let catalog = null;
const eur = (n) => (n == null ? '' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
async function loadCatalog() {
  if (!catalog) catalog = fetch('datos/mercadona.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => { catalog = null; return null; });
  return catalog;
}
async function renderMerc() {
  const q = $('#mSearch').value.trim();
  if (!q) { $('#mList').innerHTML = ''; return; }
  if (!catalog) $('#mList').innerHTML = '<p class="mut">Cargando catálogo…</p>';
  const c = await loadCatalog();
  if (q !== $('#mSearch').value.trim()) return; // ya se ha escrito otra cosa
  if (!c) { $('#mList').innerHTML = '<p class="mut">No he podido cargar el catálogo. Revisa la conexión.</p>'; return; }
  const list = L.search(c.products, q, 30);
  const date = new Date(c.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  $('#mList').innerHTML = (list.length
    ? list.map((p) => `<button type="button" class="meal pick" data-mid="${esc(p.id)}"><span class="n">${esc(p.name)}<span class="mut" style="font-weight:400;display:block">${esc(p.fmt)} · ${eur(p.price)}${p.ref != null && p.refUnit ? ` (${eur(p.ref)}/${esc(p.refUnit)})` : ''}</span></span></button>`).join('')
    : '<p class="mut">No hay productos con ese nombre.</p>') + `<p class="mut" style="font-size:12px">Precios de Mercadona del ${date}.</p>`;
}
$('#mSearch').addEventListener('input', renderMerc);
$('#mList').addEventListener('click', (e) => { const b = e.target.closest('[data-mid]'); if (b) pickMerc(b.dataset.mid); });

async function pickMerc(mid) {
  const c = await loadCatalog(); const p = c?.products.find((x) => x.id === mid); if (!p) return;
  const info = { mid: p.id, price: p.price, size: p.size || undefined };
  const ex = Object.values(db.products).find((x) => x.mid === p.id);
  if (ex) { Object.assign(ex, info); save(); return selectProduct(ex.id); } // ya lo tenías: solo se actualiza el precio
  merc = info; const mine = merc;
  $('#mList').innerHTML = ''; // se deja el texto buscado para poder reintentar
  fillNew({ name: `${p.name} · ${p.fmt}`, kcal: NaN }); $('#nKcal').value = '';
  if (!p.label) return setNew('Este producto no tiene foto de la tabla nutricional. Escanea el envase, haz una foto de la etiqueta o escribe los datos.', true);
  setNew('Leyendo la tabla nutricional de Mercadona…');
  try {
    let blob;
    try { blob = await (await fetch(`${c.img}${p.label}?fit=max&w=1600&h=1600`)).blob(); } catch (e) { throw new Error('No he podido descargar la foto de la etiqueta. Revisa la conexión.'); }
    const o = await gemini([{ text: LABEL_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: await shrink(blob, 1600) } }]);
    if (merc !== mine) return; // se ha elegido otro producto mientras tanto
    if (!(o.kcal >= 0)) throw new Error('No he podido leer la tabla en la foto de Mercadona. Escanea el envase o escribe los datos.');
    fillNew({ kcal: +o.kcal, p: +o.p, c: +o.c, f: +o.f, unitG: +o.unitG });
    setNew('Leído de la foto de Mercadona. Compruébalo antes de guardar.');
  } catch (err) {
    if (merc !== mine) return;
    setNew(`${err.message} Para reintentarlo, toca otra vez el producto en la lista.`, true);
    renderMerc(); // vuelve a mostrar la lista
  }
}

/* --- Comida con IA --- */
$('#fPhoto').addEventListener('change', (e) => { photo = e.target.files[0] || null; setMsg(photo ? 'Foto lista. Pulsa «Estimar con IA».' : ''); });
$('#btnEst').addEventListener('click', async () => {
  const text = $('#fText').value.trim();
  if (!text && !photo) return setMsg('Escribe qué has comido o haz una foto.', true);
  setMsg('Estimando…');
  try {
    const parts = [{ text: 'Eres nutricionista. Estima calorías y macros de lo que describe el usuario o se ve en la foto, para la cantidad indicada o, si no se indica, una ración habitual en España. ' +
      'Responde SOLO con JSON: {"name": string, "kcal": number, "p": number, "c": number, "f": number} (p, c, f = gramos de proteína, carbohidratos y grasa). ' +
      'Descripción: ' + (text || '(mira la foto)') }];
    if (photo) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await shrink(photo) } });
    const r = await gemini(parts);
    if (!(r.kcal >= 0)) throw new Error('No he entendido la respuesta de la IA. Inténtalo otra vez.');
    $('#fName').value = r.name || text || 'Comida';
    $('#fKcal').value = Math.round(r.kcal); $('#fP').value = Math.round(r.p || 0); $('#fC').value = Math.round(r.c || 0); $('#fF').value = Math.round(r.f || 0);
    setMsg('Estimación de la IA: revísala y corrígela si hace falta.');
  } catch (e) { setMsg(e.message, true); }
});

/* --- Guardar --- */
$('#addForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const now = new Date();
  const base = { id: Date.now(), t: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, meal: $('#fMeal').value, extra: $('#fExtra').checked };
  let entry;
  if (mode === 'qty' && cur) {
    const g = qtyG(); if (!(g > 0)) return alert('Indica la cantidad en gramos.');
    const k = g / 100;
    entry = { ...base, name: `${cur.name} · ${n0(g)} g`, kcal: Math.round(cur.kcal * k), p: r1(cur.p * k), c: r1(cur.c * k), f: r1(cur.f * k) };
    cur.last = Date.now();
  } else if (mode === 'ia') {
    if (!$('#fName').value.trim() || $('#fKcal').value === '') return setMsg('Falta el nombre y las kcal.', true);
    entry = { ...base, name: $('#fName').value.trim(), kcal: Number($('#fKcal').value) || 0, p: Number($('#fP').value) || 0, c: Number($('#fC').value) || 0, f: Number($('#fF').value) || 0 };
  } else return;
  dayRW(todayKey()).entries.push(entry);
  save(); $('#dlg').close(); view = 'hoy'; render();
});

/* ---------- Gemini ---------- */
const API = 'https://generativelanguage.googleapis.com/v1beta';
async function shrink(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
}
const callGemini = (model, parts, key) => fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
});
// Si el modelo guardado ya no existe (404), busca uno "flash" disponible y lo guarda.
async function pickModel(key) {
  try {
    const j = await (await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } })).json();
    const ok = (j.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/.test(m.name) && !/(lite|image|tts|live|audio|embedding)/.test(m.name)).map((m) => m.name.replace('models/', ''));
    return ok.find((n) => /latest/.test(n)) || ok.sort().pop();
  } catch (e) { return undefined; }
}
async function gemini(parts) {
  const s = db.settings;
  if (!s.apiKey) throw new Error('Falta la clave de Gemini en Ajustes. Mientras tanto, rellena los campos a mano.');
  const call = async (m) => { try { return await callGemini(m, parts, s.apiKey); } catch (e) { throw new Error('Sin conexión. Rellena los campos a mano.'); } };
  let r = await call(s.model);
  if (r.status === 404) {
    const m = await pickModel(s.apiKey);
    if (m) { s.model = m; save(); r = await call(m); }
  }
  // 503/500: Gemini saturado; 429: límite por minuto. Suele pasarse en unos segundos: se reintenta dos veces.
  for (const wait of [3000, 8000]) {
    if (![429, 500, 503].includes(r.status)) break;
    await sleep(wait); r = await call(s.model);
  }
  if (r.status === 503 || r.status === 500) throw new Error('Gemini está saturado ahora mismo. Inténtalo otra vez en unos minutos.');
  if (r.status === 429) throw new Error('Has llegado al límite gratuito de Gemini por ahora. Espera un rato o rellena los datos a mano.');
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}. Revisa la clave y el modelo en Ajustes.`);
  const j = await r.json();
  const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  try { return JSON.parse(raw.replace(/^```json|```$/g, '').trim()); } catch (e) { throw new Error('No he entendido la respuesta de la IA. Inténtalo otra vez.'); }
}

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
