/* Mi comida — fase 1. Todo se guarda en el móvil (localStorage). */
const KEY = 'dieta.v1';
const DEF = {
  settings: { target: 2150, p: 140, c: 220, f: 65, gymKcal: 350, gymDays: [1, 2, 3, 4], floor: 1500, apiKey: '', model: 'gemini-2.5-flash', startWeight: 100, goalWeight: 85 },
  days: {},
  weights: {},
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
function guessMeal(h) { return h < 11.5 ? 'Desayuno' : h < 16 ? 'Comida' : 'Cena'; }
function openDialog() {
  $('#addForm').reset(); photo = null; setMsg('');
  const n = new Date();
  $('#fMeal').value = guessMeal(n.getHours() + n.getMinutes() / 60);
  $('#dlg').showModal();
}
$('#dlgClose').addEventListener('click', () => $('#dlg').close());
$('#fPhoto').addEventListener('change', (e) => { photo = e.target.files[0] || null; setMsg(photo ? 'Foto lista. Pulsa «Estimar con IA».' : ''); });
function setMsg(t, err) { const m = $('#estMsg'); m.textContent = t; m.className = 'hint' + (err ? ' err' : ''); }

$('#btnEst').addEventListener('click', async () => {
  const text = $('#fText').value.trim();
  if (!text && !photo) return setMsg('Escribe qué has comido o haz una foto.', true);
  setMsg('Estimando…');
  try {
    const r = await estimate(text, photo);
    $('#fName').value = r.name || text || 'Comida';
    $('#fKcal').value = Math.round(r.kcal);
    $('#fP').value = Math.round(r.p); $('#fC').value = Math.round(r.c); $('#fF').value = Math.round(r.f);
    setMsg('Estimación de la IA: revísala y corrígela si hace falta.');
  } catch (e) { setMsg(e.message, true); }
});

$('#addForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const now = new Date();
  dayRW(todayKey()).entries.push({
    id: Date.now(), t: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    meal: $('#fMeal').value, name: $('#fName').value.trim(),
    kcal: Number($('#fKcal').value) || 0, p: Number($('#fP').value) || 0, c: Number($('#fC').value) || 0, f: Number($('#fF').value) || 0,
    extra: $('#fExtra').checked,
  });
  save(); $('#dlg').close(); view = 'hoy'; render();
});

/* ---------- Estimación con Gemini ---------- */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.8).split(',')[1];
}
async function estimate(text, file) {
  const s = db.settings;
  if (!s.apiKey) throw new Error('Falta la clave de Gemini en Ajustes. Mientras tanto, rellena los campos a mano.');
  const parts = [{ text: 'Eres nutricionista. Estima calorías y macros de lo que describe el usuario o se ve en la foto, para una ración habitual en España. ' +
    'Responde SOLO con JSON: {"name": string, "kcal": number, "p": number, "c": number, "f": number} (p, c, f = gramos de proteína, carbohidratos y grasa). ' +
    'Descripción: ' + (text || '(mira la foto)') }];
  if (file) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await shrink(file) } });
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    });
  } catch (e) { throw new Error('Sin conexión. Rellena los campos a mano.'); }
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}. Revisa la clave y el modelo en Ajustes.`);
  const j = await r.json();
  const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  try {
    const o = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
    if (!(o.kcal >= 0)) throw 0;
    return { name: o.name, kcal: +o.kcal, p: +o.p || 0, c: +o.c || 0, f: +o.f || 0 };
  } catch (e) { throw new Error('No he entendido la respuesta de la IA. Inténtalo otra vez.'); }
}

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
