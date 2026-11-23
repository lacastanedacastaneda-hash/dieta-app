/* Mi comida — fase 1. Todo se guarda en el móvil (localStorage). */
const KEY = 'dieta.v1';
const DEF = {
  settings: { target: 2150, p: 140, c: 220, f: 65, gymKcal: 350, gymDays: [1, 2, 3, 4], floor: 1500, apiKey: '', model: 'gemini-flash-latest', orKey: '', orModel: 'google/gemma-4-31b-it:free', rem: { desayuno: '08:45', almuerzo: '13:30', cena: '19:15', gym: '18:15', compra: '15:30' }, startWeight: 100, goalWeight: 85 },
  days: {},
  weights: {},
  products: {},
  plan: null, // plan de comidas importado (L.readPlan); planSel en settings dice qué semana toca
  shop: { map: {}, weeks: {} }, // compra: map = ingrediente → producto de Mercadona (id); weeks[viernes] = {have, got, qty}
  workout: { ex: {}, log: {} }, // entreno: ex[día de la semana] = [{id, name}]; log['YYYY-MM-DD'][id] = {n, s, r, kg}
};
let db = load();
let view = 'hoy';
let hoyOff = 0; // «Hoy» con plan: días respecto a hoy (−7 a +7); los futuros solo se leen
const HOY_MAX = 7;
const hoyKey = () => L.iso(L.addDays(L.parse(todayKey()), hoyOff));
let semOff = 0; // «Semana»: semanas respecto a la actual (≤ 0)
const SEM_MAX = 52; // hasta cuántas semanas hacia atrás
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
// Tarjeta «¿Fuiste al gimnasio?» (igual con o sin plan).
function gymCard(d, now) {
  const s = db.settings, sched = s.gymDays.includes(now.getDay()), rt = L.routineOf(s)[now.getDay()];
  const what = `${rt.txt ? `<p class="mut" style="margin:2px 0 0">Hoy: ${esc(rt.txt)}</p>` : ''}<button class="link" data-nav="entreno">Apuntar ejercicios ›</button>`;
  // Día ligero (estiramientos, glúteos…): se cuenta aparte y no cambia las calorías.
  if (rt.t === 'ligera') {
    if (!d.light) {
      return `<section class="card gym row"><div style="flex:1"><h2>¿Fuiste a la sesión ligera?</h2>${what}</div>
        <button class="btn primary" data-act="light" data-v="yes">Sí</button><button class="btn" data-act="light" data-v="no">No</button></section>`;
    }
    return `<section class="card row between"><div><span style="font-size:14px;font-weight:600">${d.light === 'yes' ? 'Sesión ligera hecha' : 'Sesión ligera saltada'}</span>${what}</div><button class="btn ghost" data-act="light" data-v="">Cambiar</button></section>`;
  }
  if (sched && !d.gym) {
    return `<section class="card gym row"><div style="flex:1"><h2>¿Fuiste al gimnasio?</h2>${what}<p class="mut" style="margin:2px 0 0">Si no vas, se restan ${n0(s.gymKcal)} kcal de margen</p></div>
      <button class="btn primary" data-act="gym" data-v="yes">Sí</button><button class="btn" data-act="gym" data-v="no">No</button></section>`;
  }
  if (d.gym) {
    const txt = d.gym === 'yes' ? (sched ? 'Gimnasio hecho' : `Sesión extra · +${n0(s.gymKcal)} kcal de margen`) : `Gimnasio saltado · −${n0(s.gymKcal)} kcal de margen`;
    return `<section class="card row between"><div><span style="font-size:14px;font-weight:600">${txt}</span>${sched ? what : ''}</div><button class="btn ghost" data-act="gym" data-v="">Cambiar</button></section>`;
  }
  return `<section class="card row between"><span class="mut">Hoy descansas</span><button class="btn ghost" data-act="gym" data-v="yes">Hice una sesión extra</button></section>`;
}
// Lista de lo registrado hoy (comidas, cambios y extras).
const entriesHtml = (d) => [...d.entries].sort((a, b) => a.t.localeCompare(b.t)).map((e) => `
    <div class="meal ${e.extra ? 'extra' : ''}"><span class="t">${esc(e.t)}</span>
      <div class="n">${esc(e.name)}<span class="mut" style="font-weight:400;display:block">${esc(e.meal)}</span>${e.extra ? '<span class="tag">FUERA DE DIETA</span>' : ''}</div>
      <span class="k">${e.extra ? '+' : ''}${n0(e.kcal)} kcal</span>
      <button class="del" data-act="del" data-id="${e.id}" aria-label="Borrar ${esc(e.name)}">✕</button></div>`).join('');

// «Hoy» con plan: menú del día con seguida / cambiada / me la salté, y contadores de las reglas diarias.
const PSTATE = [['ok', 'Seguida'], ['swap', 'Seguida con cambio'], ['cambio', 'Cambiada'], ['salto', 'Me la salté']];
// «Seguida con cambio»: toca el ingrediente que te faltó y, si quieres, escribe por qué lo cambiaste.
function swapBox(m, d) {
  const sw = (d.swap || {})[m.key] || {}, miss = sw.miss || [];
  return `<div class="swapbox"><p class="mut" style="margin:0 0 6px">¿Qué te faltó?</p>
    <div class="chips">${L.mealIngredients(m).map((x) => `<button class="chip ${miss.includes(x) ? 'on' : ''}" data-act="swMiss" data-m="${m.key}" data-i="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <label for="swPor_${m.key}">Lo cambié por (opcional)</label>
    <input id="swPor_${m.key}" type="text" autocomplete="off" placeholder="Ej.: atún, 2 huevos" value="${esc(sw.por || '')}"></div>`;
}
const COUNTERS = [['agua', 'Agua', 'vasos'], ['fruta', 'Fruta', 'piezas'], ['lacteo', 'Lácteos', ''], ['ensalada', 'Ensaladas', '']];
// Botones para moverse de día en «Hoy».
function hoyNav() {
  const b = (d, lab, extra = '') => `<button class="btn ghost" data-act="hoyDay" data-d="${d}" ${extra}>${lab}</button>`;
  return `<div class="row" style="margin-top:10px">${b(-1, hoyOff === 0 ? '‹ Ayer' : '‹ Anterior', hoyOff <= -HOY_MAX ? 'disabled' : '')}
    ${hoyOff ? b(0, 'Hoy') : ''}${b(1, hoyOff === 0 ? 'Mañana ›' : 'Siguiente ›', `style="margin-left:auto" ${hoyOff >= HOY_MAX ? 'disabled' : ''}`)}</div>`;
}
const hoyTitle = () => (hoyOff === 0 ? 'Hoy' : hoyOff === 1 ? 'Mañana' : hoyOff === -1 ? 'Ayer' : cap(fdate(hoyKey(), { weekday: 'long', day: 'numeric' })));
// Día futuro: el menú solo para leer y prepararlo (ingredientes, legumbres, gimnasio).
function viewDiaPlan(k) {
  const s = db.settings, day = L.parse(k), pd = L.planDay(db.plan, s.planSel, k), rt = L.routineOf(s)[day.getDay()];
  const tipCena = L.isStrength(rt.t) ? `Día de ${rt.t === 'piernas' ? 'piernas' : 'fuerza'}: cena con proteína${rt.t === 'piernas' ? ' y sin quedarte corto de hidratos' : ''}.` : '';
  const meals = pd.meals.map((m) => {
    const ing = L.mealIngredients(m);
    return `<div class="pmeal">
      <div class="row between"><h2>${m.meal}</h2>${m.libre ? '<span class="pill">Libre, con moderación</span>' : m.legumbres ? '<span class="pill">Legumbres</span>' : ''}</div>
      <p class="ptext">${esc(m.text)}</p>
      ${ing.length ? `<p class="mut" style="margin:0 0 8px">Ingredientes: ${esc(ing.join(', '))}</p>` : ''}
      ${m.key === 'cena' && tipCena ? `<p class="tip">${tipCena}</p>` : ''}
      ${db.plan.racionMaxG && m.key !== 'desayuno' ? `<p class="mut" style="margin:0 0 8px">Carne o pescado: hasta ${n0(db.plan.racionMaxG)} g</p>` : ''}
    </div>`;
  }).join('');
  const gym = rt.t === 'descanso' ? 'Descanso' : `${RTLABEL[rt.t]}${rt.txt ? ` · ${esc(rt.txt)}` : ''}`;
  return `<p class="sub">${cap(fdate(k, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(pd.weekName)}</p><h1>${hoyTitle()}</h1>${hoyNav()}
  <section class="card"><h2>Menú ${hoyOff === 1 ? 'de mañana' : 'del día'}</h2>${meals}</section>
  <section class="card"><p class="mut" style="margin:0">Gimnasio</p><p style="margin:2px 0 0;font-size:14px;font-weight:600">${gym}</p></section>
  <p class="mut" style="margin:12px 0 0">Es un día futuro: podrás marcar las comidas cuando llegue.</p>`;
}
function viewHoyPlan() {
  const k = hoyKey();
  if (hoyOff > 0) return viewDiaPlan(k);
  const isToday = hoyOff === 0, now = isToday ? new Date() : L.parse(k), s = db.settings, d = L.dayRO(db, k);
  const pd = L.planDay(db.plan, s.planSel, k), st = d.plan || {}, cnt = d.cnt || {};
  const sched = s.gymDays.includes(now.getDay());
  // Avisos al abrir la app: comidas cuya hora ya pasó sin marcar, y la compra del viernes.
  const r = remOf(), mins = (hhmm) => { const [h, mm] = hhmm.split(':').map(Number); return h * 60 + mm; };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const due = new Set(isToday ? pd.meals.filter((m) => !st[m.key] && nowMin >= mins(r[m.key])).map((m) => m.key) : []);
  const dueNames = pd.meals.filter((m) => due.has(m.key)).map((m) => m.meal.toLowerCase());
  const yList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}` : a[0]);
  const avisos = (dueNames.length ? `<section class="card due"><h2>Te falta marcar: ${yList(dueNames)}</h2><p class="mut" style="margin:4px 0 0">Pulsa «Seguida», «Cambiada» o «Me la salté» en el menú.</p></section>` : '')
    + (isToday && now.getDay() === 5 && nowMin >= mins(r.compra) ? `<section class="card due row between"><div><h2>Hoy toca la compra</h2><p class="mut" style="margin:4px 0 0">Tu lista está en «Compra».</p></div><button class="btn primary" data-nav="compra">Ver lista</button></section>` : '');
  // Días de fuerza: la cena es la comida después de entrenar (y el día de piernas, sin quedarse corto de hidratos).
  const rt = L.routineOf(s)[now.getDay()];
  const tipCena = L.isStrength(rt.t) && d.gym !== 'no'
    ? `Cena después de entrenar: no te la saltes y que lleve proteína.${rt.t === 'piernas' ? ' Día de piernas: no te quedes corto de hidratos (arroz, patata, boniato o pan).' : ''}` : '';
  const meals = pd.meals.map((m) => `
    <div class="pmeal ${st[m.key] || ''} ${due.has(m.key) ? 'due' : ''}">
      <div class="row between"><h2>${m.meal}</h2>${m.libre ? '<span class="pill">Libre, con moderación</span>' : m.legumbres ? '<span class="pill">Legumbres</span>' : ''}</div>
      <p class="ptext">${esc(m.text)}</p>
      ${m.key === 'cena' && tipCena ? `<p class="tip">${tipCena}</p>` : ''}
      ${db.plan.racionMaxG && m.key !== 'desayuno' ? `<p class="mut" style="margin:0 0 8px">Carne o pescado: hasta ${n0(db.plan.racionMaxG)} g</p>` : ''}
      <div class="pbtns">${PSTATE.map(([v, lab]) => `<button class="btn ${st[m.key] === v ? 'on ' + v : ''}" data-act="pm" data-m="${m.key}" data-v="${v}">${lab}</button>`).join('')}</div>
      ${st[m.key] === 'swap' ? swapBox(m, d) : ''}
    </div>`).join('');
  const rules = COUNTERS.map(([key, lab, unit]) => {
    const goal = db.plan.reglas[key], v = cnt[key] || 0;
    return `<div class="cnt ${v >= goal ? 'done' : ''}"><span class="cl">${lab}</span><b>${v} / ${goal}${unit ? ` <span class="mut">${unit}</span>` : ''}</b>
      <button class="btn" data-act="cnt" data-k="${key}" data-d="-1" aria-label="Quitar ${lab}">−</button><button class="btn" data-act="cnt" data-k="${key}" data-d="1" aria-label="Añadir ${lab}">+</button></div>`;
  }).join('');
  const t = L.tot(db, k), list = entriesHtml(d);
  return `<p class="sub">${isToday ? DOWFULL[now.getDay()] : cap(fdate(k, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(pd.weekName)}${sched ? ' · día de gimnasio' : ''}</p><h1>${hoyTitle()}</h1>
  ${hoyNav()}${avisos}
  <section class="card"><h2>Menú ${isToday ? 'de hoy' : hoyOff === -1 ? 'de ayer' : 'del día'}</h2>${meals}</section>
  <section class="card"><h2>Reglas del día</h2>${rules}</section>
  ${gymCard(d, now)}
  <div class="row between" style="margin:18px 0 0"><h2>Cambios y extras</h2>${d.entries.length ? `<span class="mut">${n0(t.kcal)} kcal registradas</span>` : ''}</div>
  ${list || '<p class="mut">Si te sales del menú, pulsa «Cambiada» o añade un extra.</p>'}
  <button class="btn primary big" data-act="add">Añadir extra o comida</button>`;
}

function viewHoy() {
  if (db.plan) return viewHoyPlan();
  const k = todayKey(), now = new Date(), s = db.settings;
  const p = L.plan(db, k), t = L.tot(db, k), d = L.dayRO(db, k);
  const left = p.todayTarget - t.kcal;
  const sched = s.gymDays.includes(now.getDay());
  const gym = gymCard(d, now), meals = entriesHtml(d);
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
  // t0 = hoy; k = día de referencia de la semana que se ve (en semanas pasadas, su domingo: cuentan los 7 días).
  const t0 = todayKey(), s = db.settings;
  const k = semOff ? L.iso(L.addDays(L.weekStart(L.parse(t0)), 7 * semOff + 6)) : t0, p = L.plan(db, k);
  const ws = L.weekStart(L.parse(k)), we = L.addDays(ws, 6);
  const sub = semOff ? `Semana del ${ws.getMonth() === we.getMonth() ? ws.getDate() : ws.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} al ${we.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : 'Semana actual';
  const navBtns = `<div class="row" style="margin-top:10px"><button class="btn ghost" data-act="semWk" data-d="-1" ${semOff <= -SEM_MAX ? 'disabled' : ''}>‹ Anterior</button>
    ${semOff < 0 ? '<button class="btn ghost" data-act="semWk" data-d="0">Actual</button><button class="btn ghost" style="margin-left:auto" data-act="semWk" data-d="1">Siguiente ›</button>' : ''}</div>`;
  const tots = p.keys.map((kk) => L.tot(db, kk).kcal);
  const max = Math.max(2600, ...tots) * 1.05, H = 140;
  const bars = p.keys.map((kk, i) => {
    const d = L.dayRO(db, kk), hasExtra = d.entries.some((e) => e.extra);
    if (!d.entries.length) return '<div class="b e"></div>';
    return `<div class="b ${kk === t0 ? 'now' : hasExtra ? 'x' : ''}" style="height:${Math.round((tots[i] / max) * H)}px" title="${n0(tots[i])} kcal"></div>`;
  }).join('');
  const lbl = p.keys.map((kk, i) => `<span style="${kk === t0 ? 'font-weight:700;color:var(--ink)' : ''}">${DOW[i]}</span>`).join('');
  const extras = p.keys.flatMap((kk) => L.dayRO(db, kk).entries.filter((e) => e.extra));
  const gw = L.gymWeek(db, k);
  const lw = L.lastWeight(db, t0), wLast = lw ? lw.kg : null;
  const lost = wLast !== null ? s.startWeight - wLast : 0;
  const cal = `<section class="card"><div class="row between"><h2>Calorías por día</h2><span class="mut">Línea: ${n0(s.target)} kcal</span></div>
    <div class="chart"><div class="line" style="bottom:${Math.round((s.target / max) * H)}px"></div>${bars}</div>
    <div class="days">${lbl}</div>
    <p class="mut" style="margin:10px 0 0">Naranja: día con extra · verde claro: hoy</p></section>
  <div class="two">
    <section class="card"><p class="mut" style="margin:0">Presupuesto semanal</p><b style="font-size:22px">${n0(p.weekly)}</b><p class="mut" style="margin:2px 0 0">kcal · quedan ${n0(p.weekly - p.eaten)}</p></section>
    ${db.plan ? '' : `<section class="card"><p class="mut" style="margin:0">Extras de la semana</p><b style="font-size:22px;color:var(--orange)">${extras.length}</b><p class="mut" style="margin:2px 0 0">${n0(extras.reduce((a, e) => a + e.kcal, 0))} kcal en total</p></section>`}
  </div>`;
  const gym = `<section class="card"><div class="row between"><h2>Gimnasio</h2><span class="mut" style="font-size:13px">${gw.fuerza.done} de fuerza (previstas: ${gw.fuerza.plan})</span></div>
    ${gw.ligera.plan || gw.ligera.done ? `<p class="mut" style="margin:4px 0 0;text-align:right">${gw.ligera.done} ligeras (previstas: ${gw.ligera.plan})</p>` : ''}${musclesHtml(k)}</section>`;
  // Con plan: aviso de pesarse cada N días (por defecto 15).
  const every = db.plan ? db.plan.pesoCadaDias || 15 : 0;
  const due = every && (!lw || lw.days >= every);
  const peso = `<section class="card"><div class="row between"><h2>Peso</h2><span class="mut" style="font-size:13px">${n0(s.startWeight)} kg → ${n0(s.goalWeight)} kg</span></div>
    ${wLast !== null ? `<p style="margin:8px 0 0"><b style="font-size:22px">${n1(wLast)} kg</b> <span class="ok">${lost >= 0 ? '−' : '+'}${n1(Math.abs(lost))} kg desde el inicio</span></p>
    <div class="bar"><i style="width:${pct(lost, s.startWeight - s.goalWeight)}%"></i></div>` : '<p class="mut">Registra tu peso en Ajustes.</p>'}
    ${every ? `<p class="${due ? 'hint err' : 'mut'}" style="margin:4px 0 0">${due
    ? `Toca pesarte (cada ${every} días)${lw ? `: la última vez fue hace ${lw.days} días` : ''}. Hazlo en Ajustes > Peso de hoy.`
    : `Última pesada hace ${lw.days} ${lw.days === 1 ? 'día' : 'días'}; la siguiente, dentro de ${every - lw.days}.`}</p>` : ''}</section>`;
  if (!db.plan) return `<p class="sub">${sub}</p><h1>Semana</h1>${navBtns}${cal}${gym}${peso}`;
  return `<p class="sub">${sub} · ${esc(L.planDay(db.plan, s.planSel, k).weekName)}</p><h1>Semana</h1>${navBtns}
  ${planWeekHtml(k)}${gym}${peso}
  <h2 style="margin:22px 0 0">Calorías</h2><p class="mut" style="margin:2px 0 0">Solo cuentan las comidas y extras que apuntas con kcal.</p>${cal}`;
}

// «Semana» con plan: cumplimiento, desvíos y reglas.
function planWeekHtml(k) {
  const p = db.plan, st = L.planWeekStats(db, k, semOff < 0);
  const dots = st.dias.map((d, i) => `<div class="pday ${d.today ? 'now' : ''}">${d.meals.map((v) => `<i class="dot ${d.fut || d.pre ? 'fut' : v}"></i>`).join('')}<span>${DOW[i]}</span></div>`).join('');
  const RL = [['agua', 'Agua'], ['fruta', 'Fruta'], ['lacteo', 'Lácteos'], ['ensalada', 'Ensaladas']];
  const reglas = RL.map(([r, lab]) => `<div class="row between rl"><span>${lab} <span class="mut">(${p.reglas[r]} al día)</span></span><b>${st.reglas[r]} de ${st.elapsed} ${st.elapsed === 1 ? 'día' : 'días'}</b></div>`).join('');
  const legOver = st.legumbres > p.legumbresMax;
  const ws = L.weekStart(L.parse(k)), we = L.addDays(ws, 6);
  const extras = st.dias.flatMap((d) => L.dayRO(db, d.key).entries).filter((e) => e.extra);
  return `<section class="card"><div class="row between"><h2>Cumplimiento del plan</h2><b class="big-pct">${st.pct === null ? '—' : st.pct + ' %'}</b></div>
    <p class="mut" style="margin:2px 0 0">${st.pct === null ? `${semOff < 0 ? 'No marcaste' : 'Aún no has marcado'} ninguna comida ${semOff < 0 ? 'esa' : 'esta'} semana.` : `${st.ok + st.swap} de ${st.total} comidas seguidas${st.swap ? ` (${st.swap} con cambio)` : ''}`}</p>
    <div class="pweek">${dots}</div>
    <p class="mut" style="margin:8px 0 0"><i class="dot ok"></i> seguida · <i class="dot swap"></i> con cambio · <i class="dot cambio"></i> cambiada o saltada · <i class="dot"></i> sin marcar</p></section>
  ${st.cambios.length ? `<section class="card"><h2>Seguidas con cambio</h2>
    ${Object.keys(st.faltas).length ? `<p style="margin:8px 0 0;font-size:14px"><b>Te faltó:</b> ${Object.entries(st.faltas).sort((x, y) => y[1] - x[1]).map(([x, n]) => `${esc(x)}${n > 1 ? ` (${n} veces)` : ''}`).join(', ')}</p>` : ''}
    ${st.cambios.map((c) => `<p class="mut" style="margin:6px 0 0">${DSHORT[c.day]}, ${c.meal.toLowerCase()}: ${c.miss.length ? `faltó ${esc(c.miss.join(', '))}` : 'sin indicar qué faltó'}${c.por ? ` → ${esc(c.por)}` : ''}</p>`).join('')}
    <p class="mut" style="margin:8px 0 0">Si te falta algo a menudo, revisa que esté en la lista de la compra.</p></section>` : ''}
  <div class="two">
    <section class="card"><p class="mut" style="margin:0">Desvíos</p><b style="font-size:22px;color:var(--orange)">${st.cambio + st.salto}</b>
      <p class="mut" style="margin:2px 0 0">${st.cambio} cambiadas · ${st.salto} saltadas${st.sin ? ` · ${st.sin} sin marcar` : ''}</p></section>
    <section class="card"><p class="mut" style="margin:0">Extras</p><b style="font-size:22px;color:var(--orange)">${extras.length}</b>
      <p class="mut" style="margin:2px 0 0">${n0(extras.reduce((a, e) => a + (e.kcal || 0), 0))} kcal apuntadas</p></section>
  </div>
  <section class="card"><h2>Reglas</h2>${reglas}
    <div class="row between rl"><span>Legumbres <span class="mut">(máximo ${p.legumbresMax} a la semana)</span></span><b style="${legOver ? 'color:var(--orange)' : ''}">${st.legumbres} de ${p.legumbresMax}</b></div>
    <p class="mut" style="margin:6px 0 0">Las legumbres cuentan al marcar «Seguida» una comida con legumbres (en el menú de ${semOff < 0 ? 'esa' : 'esta'} semana hay ${st.legumbresMenu}). Semana del ${ws.getDate()} al ${we.getDate()}.</p></section>`;
}

// Ajustes > Plan de comidas: importar, elegir qué semana toca y quitar.
function planCard() {
  const imp = `<label class="btn" for="planFile" style="margin:0">${db.plan ? 'Cambiar plan' : 'Importar plan (JSON)'}</label><input id="planFile" type="file" accept="application/json,.json" hidden>`;
  if (!db.plan) {
    return `<section class="card"><h2>Plan de comidas</h2>
    <p class="mut">Importa tu plan (menús por semanas y reglas). Se guarda solo en este móvil. Sin plan, «Hoy» funciona por calorías.</p>
    <div class="row">${imp}</div></section>`;
  }
  const p = db.plan, k = todayKey(), cur = L.planWeek(p, db.settings.planSel, k), alt = db.settings.planSel?.mode === 'alt';
  const opts = p.semanas.flatMap((w, i) => [[`alt:${i}`, `Alternar: esta semana, ${w.name}`], [`fixed:${i}`, `Siempre ${w.name}`]]);
  const val = alt ? `alt:${cur}` : `fixed:${cur}`;
  return `<section class="card"><h2>Plan de comidas</h2>
    <p class="mut">${p.semanas.length} semanas · reglas diarias: ${p.reglas.agua} vasos de agua, ${p.reglas.fruta} frutas, ${p.reglas.lacteo} lácteos, ${p.reglas.ensalada} ensaladas · legumbres: máximo ${p.legumbresMax} a la semana${p.racionMaxG ? ` · carne o pescado: hasta ${n0(p.racionMaxG)} g por comida` : ''}.</p>
    <label for="planSel">Qué semana toca</label>
    <select id="planSel">${opts.map(([v, t]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
    ${p.prohibido.length ? `<p class="mut"><b>Fuera de las comidas, nada de:</b> ${esc(p.prohibido.join(', '))}.</p>` : ''}
    ${p.permitido.length ? `<p class="mut"><b>Permitido:</b> ${esc(p.permitido.join('; '))}.</p>` : ''}
    ${p.nota ? `<p class="mut">${esc(p.nota)}</p>` : ''}
    <div class="row">${imp}<button class="btn ghost" data-act="planDel">Quitar plan</button></div></section>`;
}

// Ajustes > Rutina de gimnasio: tipo de día y qué toca (se guarda solo en el móvil). Los días de fuerza son los «días de gimnasio».
const RTLABEL = { descanso: 'Descanso', fuerza: 'Fuerza', piernas: 'Fuerza: piernas', ligera: 'Ligera (estirar…)' };
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
function rutCard() {
  const r = L.routineOf(db.settings);
  return `<form id="rutForm" class="card"><h2>Rutina de gimnasio</h2>
    <p class="mut">Lo que pongas sale en «Hoy». Los días de fuerza cuentan como días de gimnasio; los ligeros, aparte y sin cambiar las calorías.</p>
    ${WEEK.map((i) => `<div class="rut"><label for="rt_${i}">${cap(DOWFULL[i])}</label>
      <select id="rt_${i}">${L.RTYPES.map((t) => `<option value="${t}"${r[i].t === t ? ' selected' : ''}>${RTLABEL[t]}</option>`).join('')}</select>
      <input id="rx_${i}" type="text" autocomplete="off" placeholder="Qué haces (opcional)" value="${esc(r[i].txt)}" aria-label="Qué haces el ${DOWFULL[i]}"></div>`).join('')}
    <button class="btn primary big" type="submit">Guardar rutina</button></form>`;
}

// Ajustes > Recordatorios: horas y archivo para el calendario del móvil.
const REM = [['desayuno', 'Desayuno'], ['almuerzo', 'Comida'], ['cena', 'Cena'], ['gym', 'Gimnasio'], ['compra', 'Compra (viernes)']];
const remOf = () => ({ ...DEF.settings.rem, ...db.settings.rem });
function remCard() {
  const r = remOf(), days = db.settings.gymDays.map((d) => DOWFULL[d]).join(', ');
  return `<form id="remForm" class="card"><h2>Recordatorios</h2>
    <div class="two">${REM.map(([k, lab]) => `<div><label for="r_${k}">${lab}</label><input id="r_${k}" type="time" value="${esc(r[k])}"></div>`).join('')}</div>
    <p class="mut">Gimnasio: ${esc(days || 'ningún día')}. Las horas también sirven para los avisos de «Hoy» al abrir la app.</p>
    <button class="btn" type="submit">Guardar horas</button>
    <button class="btn primary big" type="button" data-act="ics">Descargar recordatorios para el calendario</button>
    <details class="how"><summary>Cómo añadirlos a Outlook</summary>
      <p class="mut">Desde Outlook en la web (outlook.com o el de tu empresa), en un ordenador:</p>
      <ol class="mut"><li>Pasa el archivo descargado al ordenador.</li>
      <li>En Calendario, pulsa «Agregar calendario» y crea un calendario en blanco llamado «Mi comida».</li>
      <li>En «Agregar calendario», elige «Cargar desde archivo», selecciona el archivo y el calendario «Mi comida».</li>
      <li>Abre un evento y comprueba que el recordatorio es «En el momento del evento». Si no, edita la serie y cámbialo (son 5 series).</li></ol>
      <p class="mut">Usa un calendario aparte, no el principal: para cambiar las horas, borra «Mi comida» y vuelve a importar el archivo. Los nombres de los botones pueden variar un poco según la versión de Outlook.</p></details>
  </form>`;
}
function downloadIcs() {
  const ics = L.icsReminders(remOf(), db.settings.gymDays, todayKey(), new Date());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = 'mi-comida-recordatorios.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function viewAjustes() {
  const s = db.settings;
  const num = (id, lab, v, step = 1) => `<div><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="${step}" value="${v}"></div>`;
  return `<h1>Ajustes</h1>
  ${planCard()}
  ${rutCard()}
  ${remCard()}
  <form id="setForm" class="card">
    <h2>Objetivos diarios</h2>
    <div class="two">${num('sTarget', 'Calorías base', s.target)}${num('sFloor', 'Mínimo diario', s.floor)}${num('sP', 'Proteína g', s.p)}${num('sC', 'Carbohidratos g', s.c)}${num('sF', 'Grasa g', s.f)}${num('sGym', 'kcal por sesión', s.gymKcal)}</div>
    <p class="mut">El mínimo evita que el ajuste semanal te deje un objetivo demasiado bajo en un día.</p>
    <div class="two">${num('sW0', 'Peso inicial kg', s.startWeight, 0.1)}${num('sW1', 'Peso objetivo kg', s.goalWeight, 0.1)}</div>
    <h2 style="margin-top:18px">Inteligencia artificial: Gemini</h2>
    <label for="sKey">Clave de API de Gemini</label><input id="sKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="Pégala aquí (se guarda solo en este móvil)">
    <label for="sModel">Modelo</label><input id="sModel" type="text" value="${esc(s.model)}">
    <h2 style="margin-top:18px">Alternativa: OpenRouter (opcional)</h2>
    <p class="mut">Se usa solo si Gemini llega al límite gratuito o está saturado. Modelos gratuitos (terminan en «:free»); algunos proveedores gratuitos pueden guardar lo que envías.</p>
    <label for="sOrKey">Clave de API de OpenRouter</label><input id="sOrKey" type="password" autocomplete="off" value="${esc(s.orKey)}" placeholder="Pégala aquí (se guarda solo en este móvil)">
    <label for="sOrModel">Modelo</label><input id="sOrModel" type="text" value="${esc(s.orModel)}">
    <button class="btn primary big" type="submit">Guardar ajustes</button>
  </form>
  <form id="wForm" class="card"><h2>Peso de hoy</h2>
    <div class="row"><input id="wVal" type="number" inputmode="decimal" step="0.1" placeholder="kg" style="flex:1"><button class="btn" type="submit">Guardar peso</button></div></form>
  <section class="card"><h2>Copia de seguridad</h2><p class="mut">Tus datos viven solo en este móvil. Descarga una copia de vez en cuando.</p>
    <div class="row"><button class="btn" data-act="export">Descargar copia</button>
    <label class="btn" for="imp" style="margin:0">Restaurar copia</label><input id="imp" type="file" accept="application/json" hidden></div></section>`;
}

function render() {
  $('#app').innerHTML = { hoy: viewHoy, semana: viewSemana, compra: viewCompra, entreno: viewEntreno, ajustes: viewAjustes }[view]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
}

/* ---------- Acciones ---------- */
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) { view = nav.dataset.nav; semOff = 0; hoyOff = 0; if (view === 'entreno') { woOff = 0; woEdit = false; woOpen = null; woRows = {}; } render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const k = view === 'hoy' ? hoyKey() : todayKey(); // en «Hoy» se puede marcar un día pasado
  switch (el.dataset.act) {
    case 'hoyDay': { const dd = Number(el.dataset.d); hoyOff = dd ? Math.max(-HOY_MAX, Math.min(HOY_MAX, hoyOff + dd)) : 0; render(); window.scrollTo(0, 0); break; }
    case 'gym': dayRW(k).gym = el.dataset.v || undefined; save(); render(); break;
    case 'light': dayRW(k).light = el.dataset.v || undefined; save(); render(); break;
    case 'del': { const d = dayRW(k); d.entries = d.entries.filter((e) => String(e.id) !== el.dataset.id); save(); render(); break; }
    case 'add': openDialog(); break;
    case 'export': exportData(); break;
    case 'ics': downloadIcs(); break;
    case 'pm': { // comida del plan: seguida / cambiada / me la salté (pulsar otra vez la quita)
      const d = dayRW(k), m = el.dataset.m, v = el.dataset.v;
      d.plan = d.plan || {};
      if (d.plan[m] === v) delete d.plan[m]; else d.plan[m] = v;
      if (d.plan[m] !== 'swap' && d.swap) delete d.swap[m]; // al dejar «Seguida con cambio» se olvida qué faltó
      save(); render();
      if (d.plan[m] === 'cambio') openDialog(L.PMEALS.find(([key]) => key === m)?.[1]); // qué comiste (las kcal son opcionales)
      break;
    }
    case 'swMiss': { // «¿Qué te faltó?»: tocar un ingrediente lo marca o lo desmarca
      const d = dayRW(k), m = el.dataset.m, i = el.dataset.i;
      d.swap = d.swap || {}; const sw = d.swap[m] = d.swap[m] || {};
      const miss = new Set(sw.miss || []); if (miss.has(i)) miss.delete(i); else miss.add(i);
      sw.miss = [...miss]; save(); render(); break;
    }
    case 'cnt': { // contadores de agua, fruta, lácteos y ensaladas
      const d = dayRW(k), key = el.dataset.k;
      d.cnt = d.cnt || {};
      d.cnt[key] = Math.max(0, (d.cnt[key] || 0) + Number(el.dataset.d));
      save(); render(); break;
    }
    case 'semWk': { const dd = Number(el.dataset.d); semOff = dd ? Math.max(-SEM_MAX, Math.min(0, semOff + dd)) : 0; render(); window.scrollTo(0, 0); break; }
    case 'shopWk': { const dd = Number(el.dataset.d); shopOff = dd ? shopOff + dd : 0; shopPick = null; render(); window.scrollTo(0, 0); break; }
    case 'shopGot': case 'shopHave': { // en el carro / lo tengo en casa (tocar otra vez lo quita)
      const w = shopWeek(el.dataset.f), key = el.dataset.act === 'shopGot' ? 'got' : 'have', i = el.dataset.i;
      if (w[key][i]) delete w[key][i]; else w[key][i] = true;
      if (shopPick === i) shopPick = null;
      save(); render(); break;
    }
    case 'shopQty': { const w = shopWeek(el.dataset.f), i = el.dataset.i; w.qty[i] = Math.max(1, (w.qty[i] || 1) + Number(el.dataset.d)); save(); render(); break; }
    case 'shopPick': {
      shopPick = shopPick === el.dataset.i ? null : el.dataset.i; render();
      const q = $('#shopQ'); if (q) { q.focus(); renderShopRes(); }
      break;
    }
    case 'shopSet': db.shop.map[el.dataset.i] = el.dataset.mid; shopPick = null; save(); render(); break;
    case 'shopUnset': delete db.shop.map[el.dataset.i]; shopPick = null; save(); render(); break;
    // --- Entreno ---
    case 'woDay': { const dd = Number(el.dataset.d); woOff = dd ? Math.min(0, woOff + dd) : 0; woEdit = false; woOpen = null; woRows = {}; render(); window.scrollTo(0, 0); break; }
    case 'woEdit': woEdit = !woEdit; render(); break;
    case 'woHist': woOpen = woOpen === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'woGrp': woGrp[L.parse(woKey()).getDay()] = el.dataset.g; render(); break;
    case 'woRowAdd': case 'woRowDel': { // añadir una serie (copia la última) o quitar una
      const x = woFind(el.dataset.id); if (!x) break;
      const rows = woRaw(x);
      if (el.dataset.act === 'woRowAdd') rows.push({ ...(rows[rows.length - 1] || { r: '12', kg: '' }) });
      else if (rows.length > 1) rows.splice(Number(el.dataset.i), 1);
      woRows[x.id] = rows; woSaveDone(x); render(); break;
    }
    case 'woDone': {
      const x = woFind(el.dataset.id); if (!x) break;
      const e = L.cleanRows(x.name, woRaw(x));
      if (!e) { alert('Escribe las repeticiones de cada serie con un número entero, por ejemplo 12.'); break; }
      const wk = woKey(), w = wo(); (w.log[wk] = w.log[wk] || {})[x.id] = e; delete woRows[x.id];
      // Al apuntar el entreno, la tarjeta del gimnasio (o la de la sesión ligera) se marca sola.
      const d = dayRW(wk), rt = L.routineOf(db.settings)[L.parse(wk).getDay()];
      if (rt.t === 'ligera') d.light = d.light || 'yes'; else d.gym = d.gym || 'yes';
      save(); render(); break;
    }
    case 'woUndo': {
      const wk = woKey(), w = wo();
      if (w.log[wk]) { delete w.log[wk][el.dataset.id]; if (!Object.keys(w.log[wk]).length) delete w.log[wk]; }
      delete woRows[el.dataset.id];
      save(); render(); break;
    }
    case 'woAdd': {
      const name = $('#woNew').value.trim().slice(0, 60); if (!name) break;
      const w = wo(), dow = L.parse(woKey()).getDay();
      (w.ex[dow] = w.ex[dow] || []).push({ id: woId(), name });
      save(); render(); const inp = $('#woNew'); if (inp) inp.focus(); break;
    }
    case 'woMove': {
      const w = wo(), list = w.ex[L.parse(woKey()).getDay()] || [], i = list.findIndex((x) => x.id === el.dataset.id), j = i + Number(el.dataset.d);
      if (i >= 0 && j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; save(); render(); }
      break;
    }
    case 'woDel': {
      const w = wo(), dow = L.parse(woKey()).getDay(), x = woFind(el.dataset.id);
      if (x && confirm(`¿Quitar «${x.name}» del ${DOWFULL[dow]}? Lo que ya apuntaste se conserva.`)) { w.ex[dow] = w.ex[dow].filter((y) => y.id !== x.id); save(); render(); }
      break;
    }
    case 'woCopy': { // copia los ejercicios de otro día (mismos ejercicios = mismo historial)
      const w = wo(), dow = L.parse(woKey()).getDay(), list = w.ex[dow] = w.ex[dow] || [];
      for (const x of w.ex[el.dataset.from] || []) if (!list.some((y) => y.id === x.id)) list.push({ ...x });
      save(); render(); break;
    }
    case 'planDel':
      if (confirm('¿Quitar el plan de este móvil? Lo que ya has marcado en los días no se borra.')) { db.plan = null; save(); render(); }
      break;
  }
});

document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'setForm') {
    ev.preventDefault();
    const g = (id) => Number($('#' + id).value);
    Object.assign(db.settings, { target: g('sTarget'), floor: g('sFloor'), p: g('sP'), c: g('sC'), f: g('sF'), gymKcal: g('sGym'), startWeight: g('sW0'), goalWeight: g('sW1'), apiKey: $('#sKey').value.trim(), model: $('#sModel').value.trim() || DEF.settings.model, orKey: $('#sOrKey').value.trim(), orModel: $('#sOrModel').value.trim() || DEF.settings.orModel });
    save(); render();
  } else if (ev.target.id === 'rutForm') {
    ev.preventDefault();
    const r = Array.from({ length: 7 }, (_, i) => {
      const t = $('#rt_' + i).value;
      return { t: L.RTYPES.includes(t) ? t : 'descanso', txt: $('#rx_' + i).value.trim().slice(0, 120) };
    });
    db.settings.routine = r;
    db.settings.gymDays = r.map((x, i) => (L.isStrength(x.t) ? i : -1)).filter((i) => i >= 0); // días de fuerza = días de gimnasio
    save(); render();
    alert('Rutina guardada. Si cambiaron los días de fuerza, descarga otra vez los recordatorios del calendario.');
  } else if (ev.target.id === 'remForm') {
    ev.preventDefault();
    const r = remOf();
    for (const [k] of REM) { const v = $('#r_' + k).value; if (/^\d{2}:\d{2}$/.test(v)) r[k] = v; }
    db.settings.rem = r; save(); render(); alert('Horas guardadas. Si ya importaste el calendario, descarga el archivo otra vez e impórtalo de nuevo.');
  } else if (ev.target.id === 'wForm') {
    ev.preventDefault();
    const v = Number($('#wVal').value);
    if (v > 0) { db.weights[todayKey()] = v; save(); view = 'semana'; semOff = 0; render(); }
  }
});

document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'imp') {
    try {
      const d = JSON.parse(await ev.target.files[0].text());
      if (!d.settings || !d.days) throw new Error('formato');
      db = { ...structuredClone(DEF), ...d, settings: { ...DEF.settings, ...d.settings } }; save(); render();
    } catch (e) { alert('No he podido leer esa copia.'); }
  } else if (ev.target.id === 'planFile') {
    const f = ev.target.files[0]; if (!f) return;
    try {
      let j;
      try { j = JSON.parse(await f.text()); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
      // `desde`: los días anteriores a importar el plan no cuentan en «Semana» (al cambiar de plan se conserva).
      db.plan = { ...L.readPlan(j), desde: db.plan?.desde || todayKey() };
      // Primera vez: alternar empezando esta semana por la primera.
      if (!db.settings.planSel) db.settings.planSel = { mode: 'alt', week: 0, start: L.iso(L.weekStart(new Date())) };
      save(); render();
      alert(`Plan importado: ${db.plan.semanas.map((w) => w.name).join(' y ')}.`);
    } catch (e) { alert(`No he podido importar el plan. ${e.message}`); }
    ev.target.value = '';
  } else if (ev.target.id.startsWith('wo_n_')) { // renombrar un ejercicio (en todos los días que lo tengan)
    const id = ev.target.id.slice(5), name = ev.target.value.trim().slice(0, 60);
    if (name) { for (const list of Object.values(wo().ex)) for (const x of list) if (x.id === id) x.name = name; save(); }
  } else if (ev.target.id === 'woMq') { // añadir un ejercicio desde una máquina
    const m = mqData && mqData.by[ev.target.value];
    if (m) { const w = wo(), dow = L.parse(woKey()).getDay(); (w.ex[dow] = w.ex[dow] || []).push({ id: woId(), name: m.nombre.slice(0, 60), mq: m.id }); save(); render(); }
  } else if (ev.target.id.startsWith('wo_m_')) { // cambiar la máquina de un ejercicio (en todos los días que lo tengan)
    const id = ev.target.id.slice(5), mq = ev.target.value;
    for (const list of Object.values(wo().ex)) for (const x of list) if (x.id === id) { if (mq) x.mq = mq; else delete x.mq; }
    save();
  } else if (/^wo_[rk]_/.test(ev.target.id)) { // una serie: se recuerda lo escrito y, si ya estaba hecho, se corrige
    const x = woFind(ev.target.id.slice(5).split('_')[0]);
    if (x) { woRows[x.id] = woRaw(x); woSaveDone(x); }
  } else if (ev.target.id.startsWith('swPor_')) { // «Lo cambié por» (se guarda al salir del campo, sin repintar)
    const d = dayRW(hoyKey()), m = ev.target.id.slice(6);
    d.swap = d.swap || {}; (d.swap[m] = d.swap[m] || {}).por = ev.target.value.trim(); save();
  } else if (ev.target.id === 'planSel') {
    const [mode, w] = ev.target.value.split(':');
    db.settings.planSel = mode === 'alt' ? { mode, week: Number(w), start: L.iso(L.weekStart(new Date())) } : { mode: 'fixed', week: Number(w) };
    save(); render();
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
function openDialog(meal) {
  $('#addForm').reset(); photo = null; cur = null; merc = null; mercLabel = ''; $('#btnReadLabel').hidden = true; $('#mList').innerHTML = ''; setMerc(''); setMsg(''); setNew('');
  const n = new Date();
  $('#fMeal').value = meal || guessMeal(n.getHours() + n.getMinutes() / 60);
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
  if (o.unitG > 0 && !$('#nUnit').value) $('#nUnit').value = o.unitG; // si lo has escrito tú, no se toca
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
    const o = await ia([{ text: LABEL_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: await shrink(f, 1600) } }]);
    if (!(o.kcal >= 0)) throw new Error('No he podido leer la tabla. Prueba con más luz y la etiqueta recta.');
    fillNew({ name: o.name, kcal: +o.kcal, p: +o.p, c: +o.c, f: +o.f, unitG: +o.unitG });
    setNew(`Leído de la etiqueta con ${aiVia}. Compruébalo con la tabla antes de guardar.`);
  } catch (err) { setNew(err.message, true); }
  e.target.value = '';
});

/* --- Catálogo de Mercadona (datos/mercadona.json, lo actualiza GitHub Actions cada jueves) --- */
let catalog = null, catalogData = null, catIndex = null; // promesa, datos ya cargados y productos por id
const eur = (n) => (n == null ? '' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
async function loadCatalog() {
  if (!catalog) {
    catalog = fetch('datos/mercadona.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((j) => { catalogData = j; catIndex = new Map(j.products.map((p) => [p.id, p])); return j; })
      .catch(() => { catalog = null; return null; });
  }
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
function setMerc(t, err) { const m = $('#mMsg'); m.textContent = t; m.className = 'hint' + (err ? ' err' : ''); }
$('#mSearch').addEventListener('input', () => { setMerc(''); renderMerc(); });
$('#mList').addEventListener('click', (e) => { const b = e.target.closest('[data-mid]'); if (b) pickMerc(b.dataset.mid); });

async function pickMerc(mid) {
  const c = await loadCatalog(); const p = c?.products.find((x) => x.id === mid); if (!p) return;
  const info = { mid: p.id, price: p.price, size: p.size || undefined };
  const ex = Object.values(db.products).find((x) => x.mid === p.id);
  if (ex) { Object.assign(ex, info); save(); return selectProduct(ex.id); } // ya lo tenías: solo se actualiza el precio
  // Paso 1: solo se rellena el nombre. La IA no se usa hasta pulsar «Leer información nutricional».
  merc = info; mercLabel = p.label ? `${c.img}${p.label}?fit=max&w=1600&h=1600` : '';
  $('#mList').innerHTML = ''; setMerc('');
  $('#nName').value = `${p.name} · ${p.fmt}`;
  $('#nKcal').value = ''; $('#nP').value = 0; $('#nC').value = 0; $('#nF').value = 0; $('#nUnit').value = '';
  $('#btnReadLabel').hidden = !mercLabel;
  // Datos ya leídos por el script semanal (Open Food Facts o IA): se rellenan al momento.
  const n = p.nut;
  if (n) {
    fillNew({ kcal: n.kcal, p: n.p, c: n.c, f: n.f, unitG: n.u });
    const src = n.src === 'off' ? 'Open Food Facts' : 'la IA, de la foto de Mercadona';
    return setNew(n.dud
      ? `Datos de ${src}, pero las kcal no cuadran con los macros: revísalos con la etiqueta${mercLabel ? ' o pulsa «Leer información nutricional»' : ''}.`
      : `Datos de ${src}. Revísalos antes de guardar.`, !!n.dud);
  }
  if (!mercLabel) return setNew('Este producto no tiene foto de la tabla nutricional. Escanea el envase, haz una foto de la etiqueta o escribe los datos.', true);
  setNew('Escribe el peso de una unidad o ración si lo sabes (opcional) y pulsa «Leer información nutricional».');
  $('#nUnit').focus();
}

// Paso 2: Gemini (u OpenRouter) lee la foto de la tabla de Mercadona.
let mercLabel = '';
$('#btnReadLabel').addEventListener('click', async () => {
  if (!mercLabel) return;
  const mine = merc, btn = $('#btnReadLabel');
  btn.disabled = true;
  setNew('Leyendo la información nutricional… (puede tardar unos segundos)');
  try {
    let blob;
    try { blob = await (await fetch(mercLabel)).blob(); } catch (e) { throw new Error('No he podido descargar la foto de la etiqueta. Revisa la conexión.'); }
    const o = await ia([{ text: LABEL_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: await shrink(blob, 1600) } }]);
    if (merc !== mine) return; // se ha elegido otro producto mientras tanto
    if (!(o.kcal >= 0)) throw new Error('No he podido leer la tabla en la foto de Mercadona. Escanea el envase o escribe los datos.');
    fillNew({ kcal: +o.kcal, p: +o.p, c: +o.c, f: +o.f, unitG: +o.unitG });
    setNew(`Leído de la foto de Mercadona con ${aiVia}. Compruébalo antes de guardar.`);
  } catch (err) {
    if (merc === mine) setNew(`${err.message} Puedes volver a pulsar «Leer información nutricional».`, true);
  } finally { btn.disabled = false; }
});

/* ---------- Compra: lista del viernes (sábado a viernes) desde los ingredientes del menú ---------- */
let shopOff = 0, shopPick = null; // semanas respecto a la próxima compra; ingrediente con el buscador abierto
const DSHORT = { lun: 'lun', mar: 'mar', mie: 'mié', jue: 'jue', vie: 'vie', sab: 'sáb', dom: 'dom' };
const fdate = (k, o = { weekday: 'short', day: 'numeric', month: 'short' }) => L.parse(k).toLocaleDateString('es-ES', o);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shopEmpty = () => ({ have: {}, got: {}, qty: {} });
// Estado de la compra del viernes `f` (se crea al tocar algo; se borran las de hace más de 2 meses).
function shopWeek(f) {
  const ws = db.shop.weeks;
  for (const old of Object.keys(ws)) if (old < L.iso(L.addDays(L.parse(f), -60))) delete ws[old];
  return ws[f] || (ws[f] = shopEmpty());
}
function viewCompra() {
  if (!db.plan) return '<h1>Compra</h1><section class="card"><p class="mut" style="margin:0">Importa tu plan en Ajustes > Plan de comidas y aquí saldrá la lista de la compra del viernes.</p></section>';
  if (!catalogData) loadCatalog().then((c) => { if (c && view === 'compra') render(); });
  const f = L.shopFriday(todayKey(), shopOff), days = L.shopDays(f), w = db.shop.weeks[f] || shopEmpty();
  const items = L.shopItems(db.plan, db.settings.planSel, f);
  const prod = (name) => catIndex?.get(db.shop.map[name]);
  const need = items.filter((it) => !w.have[it.name]), have = items.filter((it) => w.have[it.name]);
  let total = 0, sinProd = 0;
  for (const it of need) { const pr = prod(it.name); if (pr?.price != null) total += pr.price * (w.qty[it.name] || 1); else sinProd++; }
  const uses = (it) => `${it.n ? `${it.n} ${it.n === 1 ? 'comida' : 'comidas'}` : ''}${it.n && it.alt ? ' + ' : ''}${it.alt ? `${it.alt} a elegir` : ''}`;
  const row = (it) => {
    const nm = esc(it.name), mid = db.shop.map[it.name], pr = prod(it.name), q = w.qty[it.name] || 1, got = !!w.got[it.name];
    let prodHtml;
    if (pr) {
      prodHtml = `<div class="prow"><span>${esc(pr.name)} <span class="mut">· ${esc(pr.fmt)}</span></span><b>${eur(pr.price * q)}</b></div>
        <div class="row" style="margin-top:6px"><button class="btn sq" data-act="shopQty" data-f="${f}" data-i="${nm}" data-d="-1" aria-label="Uno menos">−</button><span class="qty">${q}</span><button class="btn sq" data-act="shopQty" data-f="${f}" data-i="${nm}" data-d="1" aria-label="Uno más">+</button>
        <button class="btn ghost" style="margin-left:auto" data-act="shopPick" data-i="${nm}">Cambiar</button></div>`;
    } else if (mid && !catalogData) {
      prodHtml = '<p class="mut" style="margin:6px 0 0">Cargando precio…</p>';
    } else {
      prodHtml = `${mid ? '<p class="hint err" style="margin:6px 0 0">El producto que elegiste ya no está en Mercadona.</p>' : ''}
        <button class="btn" style="margin-top:6px" data-act="shopPick" data-i="${nm}">Elegir producto de Mercadona</button>`;
    }
    const picker = shopPick === it.name ? `<div class="picker"><label for="shopQ">Buscar en Mercadona</label>
        <input id="shopQ" type="text" autocomplete="off" value="${nm}" data-i="${nm}"><div id="shopRes"></div>
        ${mid ? `<button class="btn ghost" data-act="shopUnset" data-i="${nm}">Quitar producto</button>` : ''}</div>` : '';
    return `<div class="shop ${got ? 'got' : ''}"><div class="row">
      <button class="chk ${got ? 'on' : ''}" data-act="shopGot" data-f="${f}" data-i="${nm}" aria-label="${got ? 'Quitar del carro' : 'En el carro'}: ${nm}">✓</button>
      <div style="flex:1"><b>${esc(cap(it.name))}</b><span class="mut" style="display:block">${uses(it)} · ${it.days.map((d) => DSHORT[d]).join(', ')}</span></div>
      <button class="btn ghost" data-act="shopHave" data-f="${f}" data-i="${nm}">Lo tengo</button></div>${prodHtml}${picker}</div>`;
  };
  const when = shopOff === 0 ? (f === todayKey() ? 'Compra de hoy' : 'Próxima compra') : shopOff < 0 ? 'Compra anterior' : 'Compra siguiente';
  return `<p class="sub">${when} · viernes ${fdate(f, { day: 'numeric', month: 'long' })}</p><h1>Compra</h1>
  <div class="row" style="margin-top:10px"><button class="btn ghost" data-act="shopWk" data-d="-1">‹ Anterior</button>
    ${shopOff ? '<button class="btn ghost" data-act="shopWk" data-d="0">Próxima</button>' : ''}
    <button class="btn ghost" style="margin-left:auto" data-act="shopWk" data-d="1">Siguiente ›</button></div>
  <section class="card"><div class="row between"><h2>Total estimado</h2><b class="big-pct">${eur(total)}</b></div>
    <p class="mut" style="margin:4px 0 0">Menú del ${fdate(days[0])} al ${fdate(days[6])} · ${need.length} ingredientes${sinProd ? ` · ${sinProd} sin producto elegido` : ''}${catalogData ? ` · precios de Mercadona del ${new Date(catalogData.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}.</p>
    <p class="mut" style="margin:4px 0 0">El plan no da gramos: cada línea dice en cuántas comidas sale. Ajusta tú cuántos envases compras.</p></section>
  ${need.map(row).join('')}
  ${have.length ? `<h2 style="margin:18px 0 0">Lo tienes en casa</h2>${have.map((it) => `<div class="shop have row"><span style="flex:1">${esc(cap(it.name))}</span>
    <button class="btn ghost" data-act="shopHave" data-f="${f}" data-i="${esc(it.name)}">Necesito</button></div>`).join('')}` : ''}`;
}
// Resultados del buscador de un ingrediente (sin repintar toda la pantalla, para no perder el teclado).
function renderShopRes() {
  const inp = $('#shopQ'), box = $('#shopRes'); if (!inp || !box) return;
  if (!catalogData) { box.innerHTML = '<p class="mut">Cargando catálogo…</p>'; loadCatalog().then((c) => { if (c) renderShopRes(); }); return; }
  const q = inp.value.trim();
  let r = L.search(catalogData.products, q, 20);
  if (!r.length && q.includes(' ')) r = L.search(catalogData.products, q.split(/\s+/).sort((a, b) => b.length - a.length)[0], 20); // prueba con la palabra más larga
  box.innerHTML = r.length
    ? r.map((p) => `<button type="button" class="meal pick" data-act="shopSet" data-i="${esc(inp.dataset.i)}" data-mid="${esc(p.id)}"><span class="n">${esc(p.name)}<span class="mut" style="font-weight:400;display:block">${esc(p.fmt)} · ${eur(p.price)}</span></span></button>`).join('')
    : '<p class="mut">No hay productos con ese nombre. Prueba con otra palabra.</p>';
}
document.addEventListener('input', (ev) => { if (ev.target.id === 'shopQ') renderShopRes(); });

/* ---------- Entreno: tus ejercicios por día de la semana, con series, repeticiones y peso ---------- */
let woOff = 0, woEdit = false, woOpen = null, woRows = {}, woShown = {}; // días respecto a hoy (≤ 0); editando ejercicios; ejercicio con el progreso abierto;
// series escritas y aún sin guardar por ejercicio; cuántas filas de series se pintaron por ejercicio
const wo = () => { db.workout = db.workout || {}; db.workout.ex = db.workout.ex || {}; db.workout.log = db.workout.log || {}; return db.workout; };
const woKey = () => L.iso(L.addDays(L.parse(todayKey()), woOff));
const woId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const kgTxt = (kg) => (kg ? String(kg).replace('.', ',') : '');
// Máquinas del gimnasio (datos/maquinas.json). Cada ejercicio puede llevar `mq` = id de la máquina.
let mqP = null, mqData = null; // promesa; {list, by: {id: máquina}}
function loadMq() {
  if (!mqP) {
    mqP = fetch('datos/maquinas.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((j) => { mqData = { list: j.maquinas, by: Object.fromEntries(j.maquinas.map((m) => [m.id, m])) }; return mqData; })
      .catch(() => { mqP = null; return null; });
  }
  return mqP;
}
const mqOf = (x) => (x && x.mq && mqData ? mqData.by[x.mq] || null : null);
const MQLOAD = { discos: 'Kg: solo los discos que pones, sin contar la máquina.', selectorizada: 'Kg: el número de la pila de placas.' };
// «¿Qué vas a trabajar?»: grupos para elegir máquina, según la categoría de cada máquina (datos/maquinas.json).
const MQGROUPS = ['Pecho', 'Espalda', 'Hombro', 'Brazos', 'Pierna', 'Glúteos', 'Cardio', 'Otros'];
const MQCAT = { pecho: 'Pecho', espalda: 'Espalda', hombro: 'Hombro', brazos: 'Brazos', pierna: 'Pierna', 'glúteos': 'Glúteos', cardio: 'Cardio',
  'espalda baja': 'Otros', abdomen: 'Otros', banco: 'Otros', 'multiestación': 'Otros', 'peso libre': 'Otros' };
const mqGroup = (m) => MQCAT[m.cat] || 'Otros'; // una categoría nueva sin mapa cae en «Otros»: ninguna máquina se queda fuera
// Grupo de la rutina (L.groupsIn) → grupo de máquinas. Estiramientos no tiene máquinas.
const RT2MQ = { Pecho: 'Pecho', Espalda: 'Espalda', Hombros: 'Hombro', 'Tríceps': 'Brazos', 'Bíceps': 'Brazos', Piernas: 'Pierna', 'Glúteos': 'Glúteos', Cardio: 'Cardio', Abdominales: 'Otros', Lumbares: 'Otros' };
let woGrp = {}; // último grupo elegido en esta sesión, por día de la semana
// Grupo que toca ese día: el primero que nombra el texto de la rutina («piernas, glúteos…» → Pierna); «Otros» solo si no hay otro.
function dayMqGroup(txt) {
  const gs = String(txt || '').split(/[\s,;.()/]+/).flatMap((wd) => L.groupsIn(wd)).map((g) => RT2MQ[g]).filter(Boolean);
  return gs.find((g) => g !== 'Otros') || gs[0] || '';
}
const curMqGroup = (dow, rt) => (woGrp[dow] !== undefined ? woGrp[dow] : dayMqGroup(rt.txt));
// Botones de grupo, grandes para el dedo.
function mqGroupChips(grp, dayDef) {
  return `<div class="chips mqg" role="group" aria-label="¿Qué vas a trabajar?">${MQGROUPS.map((g) => `<button class="chip ${g === grp ? 'on' : ''}" data-act="woGrp" data-g="${g}" aria-pressed="${g === grp}">${g}${g === dayDef ? ' ·&nbsp;hoy' : ''}</button>`).join('')}</div>`;
}
// Lista desplegable con las máquinas del grupo; la ya elegida (`cur`) sale siempre, aunque sea de otro grupo.
function mqSelect(id, cur, grp, first) {
  if (!mqData) return '<p class="mut" style="margin:6px 0 0">Cargando máquinas…</p>';
  const opt = (m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.nombre)} · ${esc(m.marca.split(' ')[0])} ${esc(m.modelo || '')}</option>`;
  const inG = mqData.list.filter((m) => grp && mqGroup(m) === grp), sel = cur && mqData.by[cur];
  const extra = sel && !inG.includes(sel) ? `<optgroup label="Elegida (${mqGroup(sel)})">${opt(sel)}</optgroup>` : '';
  return `<select id="${id}">${first}${extra}${inG.length ? `<optgroup label="${grp}">${inG.map(opt).join('')}</optgroup>` : ''}</select>`;
}
function viewEntreno() {
  if (!mqData) loadMq().then((r) => { if (r && view === 'entreno') render(); });
  const k = woKey(), dow = L.parse(k).getDay(), w = wo(), rt = L.routineOf(db.settings)[dow];
  const list = w.ex[dow] || [], dayLog = w.log[k] || {}, grp = curMqGroup(dow, rt), dayDef = dayMqGroup(rt.txt);
  const others = WEEK.filter((i) => i !== dow && (w.ex[i] || []).length);
  const copyBtns = others.length ? `<p class="mut" style="margin:10px 0 4px">O copia los de otro día (comparten historial):</p><div class="chips">${others.map((i) => `<button class="chip" data-act="woCopy" data-from="${i}">${cap(DOWFULL[i])}</button>`).join('')}</div>` : '';
  const head = `<p class="sub">${woOff === 0 ? 'Hoy' : cap(fdate(k, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${RTLABEL[rt.t]}</p><h1>Entreno</h1>
    <div class="row" style="margin-top:10px"><button class="btn ghost" data-act="woDay" data-d="-1">‹ Día anterior</button>
    ${woOff ? '<button class="btn ghost" data-act="woDay" data-d="0">Hoy</button><button class="btn ghost" style="margin-left:auto" data-act="woDay" data-d="1">Siguiente ›</button>' : ''}</div>
    ${rt.txt ? `<section class="card"><p style="margin:0;font-size:14px"><b>${esc(rt.txt)}</b></p></section>` : ''}`;

  if (woEdit) {
    return `${head}<section class="card"><h2>Ejercicios del ${DOWFULL[dow]}</h2>
      ${list.map((x, i) => `<div class="exedit"><input id="wo_n_${x.id}" type="text" autocomplete="off" value="${esc(x.name)}" aria-label="Nombre del ejercicio">
        <button class="btn sq" data-act="woMove" data-id="${x.id}" data-d="-1" aria-label="Subir" ${i ? '' : 'disabled'}>↑</button>
        <button class="btn sq" data-act="woMove" data-id="${x.id}" data-d="1" aria-label="Bajar" ${i < list.length - 1 ? '' : 'disabled'}>↓</button>
        <button class="btn sq" data-act="woDel" data-id="${x.id}" aria-label="Quitar ${esc(x.name)}">✕</button></div>
        <div class="exmq">${mqOf(x) && mqOf(x).img ? `<img src="${esc(mqOf(x).img)}" alt="" loading="lazy">` : ''}${mqSelect('wo_m_' + x.id, x.mq, grp, '<option value="">Sin máquina</option>')}</div>`).join('')}
      <p class="lbl">¿Qué vas a trabajar?</p>
      ${mqGroupChips(grp, dayDef)}
      <label for="woMq">Añadir una máquina${grp ? ` de ${grp.toLowerCase()}` : ''}</label>
      ${grp ? mqSelect('woMq', '', grp, '<option value="">Elige una máquina…</option>') : '<p class="mut" style="margin:0">Elige primero qué vas a trabajar.</p>'}
      <label for="woNew">O escribe un ejercicio sin máquina</label>
      <div class="row"><input id="woNew" type="text" autocomplete="off" placeholder="Ej.: Press francés con mancuernas" style="flex:1"><button class="btn" data-act="woAdd">Añadir</button></div>
      ${copyBtns}
      <button class="btn primary big" data-act="woEdit">Listo</button></section>`;
  }
  if (!list.length) {
    return `${head}<section class="card"><p class="mut" style="margin:0">${rt.t === 'descanso' ? 'Hoy descansas. Si entrenas igualmente, añade los ejercicios de este día.' : `Todavía no has añadido los ejercicios del ${DOWFULL[dow]}.`}</p>
      ${copyBtns}<button class="btn primary big" data-act="woEdit">Añadir ejercicios</button></section>`;
  }
  const cards = list.map((x) => {
    const e = dayLog[x.id], last = L.exHistory(w.log, x.id, k)[0], base = e || (last && last.e), m = mqOf(x);
    const musc = m && m.principal ? `${cap(m.principal)}${m.secundarios.length ? `; también ${m.secundarios.join(', ')}` : ''}` : '';
    const hist = woOpen === x.id ? (() => {
      const all = L.exHistory(w.log, x.id), best = L.exBest(w.log, x.id);
      return `<div class="exhist">${best ? `<p style="margin:0 0 6px;font-size:13px"><b>Mejor marca:</b> ${L.fmtSet(best.e)} <span class="mut">(${fdate(best.key)})</span></p>` : ''}
        ${all.length ? all.slice(0, 8).map((h) => `<div class="row between hrow"><span class="mut">${fdate(h.key)}</span><span>${L.fmtSet(h.e)}</span></div>`).join('') : '<p class="mut" style="margin:0">Aún no hay sesiones.</p>'}</div>`;
    })() : '';
    // Filas de series: lo escrito sin guardar; si no, lo de hoy o lo de la última vez; si no, 3 series de 12.
    const noKg = m && m.carga === 'sin carga';
    const rows = woRows[x.id] || (base ? L.setRows(base).map((y) => ({ r: String(y.r), kg: kgTxt(y.kg) })) : [1, 2, 3].map(() => ({ r: '12', kg: '' })));
    woShown[x.id] = rows.length;
    const srows = rows.map((y, i) => `<div class="srow${noKg ? ' nokg' : ''}"><span class="mut">${i + 1}.ª</span>
        <input id="wo_r_${x.id}_${i}" type="text" inputmode="numeric" autocomplete="off" value="${esc(y.r)}" aria-label="Repeticiones de la serie ${i + 1}">
        ${noKg ? '' : `<input id="wo_k_${x.id}_${i}" type="text" inputmode="decimal" autocomplete="off" placeholder="sin peso" value="${esc(y.kg)}" aria-label="Kg de la serie ${i + 1}">`}
        <button class="del" data-act="woRowDel" data-id="${x.id}" data-i="${i}" aria-label="Quitar la serie ${i + 1}" ${rows.length > 1 ? '' : 'disabled'}>✕</button></div>`).join('');
    return `<div class="ex ${e ? 'done' : ''}">
      ${m && m.img ? `<div class="exphoto"><img src="${esc(m.img)}" alt="${esc(m.nombre)}" loading="lazy"></div>` : ''}
      <div class="row between"><b>${esc(x.name)}</b>${e ? '<span class="ok">✓ Hecho</span>' : ''}</div>
      ${m ? `<p class="mut" style="margin:2px 0 0">${esc(m.marca)} ${esc(m.modelo || '')}${musc ? ` · ${esc(musc)}` : ''}</p>` : ''}
      <p class="mut" style="margin:2px 0 0">${last ? `Última vez (${fdate(last.key)}): ${L.fmtSet(last.e)}` : 'Primera vez: escribe lo que haces.'}</p>
      <div class="srow${noKg ? ' nokg' : ''} shead"><span></span><span>Repeticiones</span>${noKg ? '' : '<span>Kg</span>'}<span></span></div>
      ${srows}
      <button class="link" data-act="woRowAdd" data-id="${x.id}">+ Serie</button>
      ${m && MQLOAD[m.carga] ? `<p class="mut" style="margin:4px 0 0">${MQLOAD[m.carga]}</p>` : ''}
      <div class="row" style="margin-top:8px">${e ? `<button class="btn ghost" data-act="woUndo" data-id="${x.id}">Deshacer</button>` : `<button class="btn primary" data-act="woDone" data-id="${x.id}">Hecho</button>`}
        <button class="btn ghost" style="margin-left:auto" data-act="woHist" data-id="${x.id}">${woOpen === x.id ? 'Ocultar progreso' : 'Progreso'}</button></div>
      ${hist}</div>`;
  }).join('');
  const done = list.filter((x) => dayLog[x.id]).length;
  return `${head}<div class="row between" style="margin:16px 0 0"><h2>${done} de ${list.length} hechos</h2><button class="btn ghost" data-act="woEdit">Editar ejercicios</button></div>
    <p class="mut" style="margin:4px 0 0">Cada fila es una serie, con sus repeticiones y su peso. Si repites lo de la última vez, pulsa «Hecho».</p>
    ${cards}`;
}
// Lo que hay escrito en las filas de series de un ejercicio, [{r, kg}] como texto.
function woRaw(x) {
  return Array.from({ length: woShown[x.id] || 0 }, (_, i) => {
    const k = $(`#wo_k_${x.id}_${i}`);
    return { r: $(`#wo_r_${x.id}_${i}`).value, kg: k ? k.value : '' };
  });
}
// Si el ejercicio ya estaba hecho ese día, guarda los cambios de sus series (si se entienden).
function woSaveDone(x) {
  const wk = woKey(), w = wo();
  if (!w.log[wk] || !w.log[wk][x.id]) return;
  const e = L.cleanRows(x.name, woRows[x.id] || woRaw(x));
  if (e) { w.log[wk][x.id] = e; save(); }
}
const woFind = (id) => (wo().ex[L.parse(woKey()).getDay()] || []).find((x) => x.id === id);

// «Semana»: grupos musculares trabajados según los ejercicios marcados como hechos en «Entreno».
function musclesHtml(k) {
  const w = db.workout;
  if (!w || !w.log || !Object.keys(w.log).length) return '';
  if (!mqData) loadMq().then((r) => { if (r && view === 'semana') render(); });
  const mg = L.muscleWeek(w, k, mqData && mqData.by);
  if (!mg.length) return '<p class="mut" style="margin:10px 0 0">Esta semana aún no has marcado ejercicios en «Entreno».</p>';
  return `<p style="margin:12px 0 2px;font-size:13px;font-weight:600">Músculos trabajados</p>
    ${mg.map((x) => `<div class="row between hrow"><span>${x.g}</span><span class="mut">${x.n} ${x.n === 1 ? 'ejercicio' : 'ejercicios'} · ${x.s} series</span></div>`).join('')}`;
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
    const r = await ia(parts);
    if (!(r.kcal >= 0)) throw new Error('No he entendido la respuesta de la IA. Inténtalo otra vez.');
    $('#fName').value = r.name || text || 'Comida';
    $('#fKcal').value = Math.round(r.kcal); $('#fP').value = Math.round(r.p || 0); $('#fC').value = Math.round(r.c || 0); $('#fF').value = Math.round(r.f || 0);
    setMsg(`Estimación de la IA (${aiVia}): revísala y corrígela si hace falta.`);
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
  dayRW(view === 'hoy' && hoyOff < 0 ? hoyKey() : todayKey()).entries.push(entry); // un extra de ayer va a ayer
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
// Modelos "flash" disponibles para la clave: el "latest" primero, luego los más nuevos y los "lite" al final.
async function flashModels(key) {
  try {
    const j = await (await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } })).json();
    const ok = (j.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/.test(m.name) && !/(image|tts|live|audio|embedding)/.test(m.name)).map((m) => m.name.replace('models/', ''));
    const rank = (n) => (/latest/.test(n) ? 0 : /lite/.test(n) ? 2 : 1);
    return ok.sort().reverse().sort((a, b) => rank(a) - rank(b));
  } catch (e) { return []; }
}
const BUSY = [429, 500, 503]; // límite de uso o servicio saturado
// Error que permite pasar a OpenRouter (límite o saturación); los demás (clave mal, etc.) se enseñan tal cual.
const busyErr = (msg) => Object.assign(new Error(msg), { busy: true });
// Lee la respuesta de la IA aunque venga entre ```json ... ``` o con texto alrededor.
function parseAI(raw) {
  const t = String(raw || '').replace(/```(json)?/g, '').trim();
  let o;
  try { o = JSON.parse(t); } catch (e) { const m = t.match(/[[{][\s\S]*[\]}]/); try { o = m && JSON.parse(m[0]); } catch (e2) { o = null; } }
  if (!o) throw new Error('No he entendido la respuesta de la IA. Inténtalo otra vez.');
  return Array.isArray(o) ? o[0] || {} : o;
}

async function askGemini(parts) {
  const s = db.settings;
  const call = async (m) => { try { return await callGemini(m, parts, s.apiKey); } catch (e) { throw new Error('Sin conexión. Rellena los campos a mano.'); } };
  let r = await call(s.model);
  // Si el modelo guardado ya no existe (404), busca uno "flash" disponible y lo guarda.
  if (r.status === 404) {
    const m = (await flashModels(s.apiKey))[0];
    if (m) { s.model = m; save(); r = await call(m); }
  }
  // Saturado (503/500): un reintento tras 3 s. Con 429 (límite) no se reintenta el mismo modelo: solo gastaría cuota.
  if (r.status === 503 || r.status === 500) { await sleep(3000); r = await call(s.model); }
  // Cada modelo de Gemini tiene su propia cuota gratuita: se prueba con otros dos (sin cambiar el de Ajustes).
  if (BUSY.includes(r.status)) {
    for (const m of (await flashModels(s.apiKey)).filter((x) => x !== s.model).slice(0, 2)) {
      r = await call(m);
      if (!BUSY.includes(r.status)) break;
    }
  }
  if (r.status === 429) throw busyErr('Has llegado al límite gratuito de Gemini por ahora.');
  if (r.status === 503 || r.status === 500) throw busyErr('Gemini está saturado ahora mismo.');
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}. Revisa la clave y el modelo en Ajustes.`);
  const j = await r.json();
  return parseAI(j.candidates?.[0]?.content?.parts?.[0]?.text);
}

/* ---------- OpenRouter (modelos gratuitos ":free"; se usa si Gemini llega al límite o está saturado) ---------- */
const OR = 'https://openrouter.ai/api/v1';
// Pasa el formato de Gemini ({text} / {inline_data}) al de OpenRouter.
const orContent = (parts) => parts.map((p) => (p.inline_data
  ? { type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } }
  : { type: 'text', text: p.text }));
const callOR = (model, parts, key) => fetch(`${OR}/chat/completions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Mi comida' },
  body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: orContent(parts) }] }),
});
// Modelos gratuitos que aceptan imágenes (la lista de OpenRouter es pública).
async function freeVisionModels() {
  try {
    const j = await (await fetch(`${OR}/models`)).json();
    return (j.data || []).filter((m) => m.id.endsWith(':free') && (m.architecture?.input_modalities || []).includes('image')).map((m) => m.id);
  } catch (e) { return []; }
}
async function askOpenRouter(parts) {
  const s = db.settings;
  const call = async (m) => {
    let r;
    try { r = await callOR(m, parts, s.orKey); } catch (e) { throw new Error('Sin conexión. Rellena los campos a mano.'); }
    const j = await r.json().catch(() => ({}));
    // A veces el error llega con estado 200 y un objeto "error".
    return { status: j.error ? Number(j.error.code) || 500 : r.status, j };
  };
  let { status, j } = await call(s.orModel);
  // Modelo que ya no existe o no está disponible (400/404) o con límite/saturado: se prueba con otros dos gratuitos.
  if ([400, 404, ...BUSY].includes(status)) {
    const wasGone = status === 400 || status === 404; // el modelo de Ajustes no sirve: se guarda el que funcione
    for (const m of (await freeVisionModels()).filter((x) => x !== s.orModel).slice(0, 2)) {
      ({ status, j } = await call(m));
      if (status === 200) { if (wasGone) { s.orModel = m; save(); } break; }
    }
  }
  if (status === 401) throw new Error('La clave de OpenRouter no es válida. Revísala en Ajustes.');
  if (status === 429) throw new Error('También has llegado al límite gratuito de OpenRouter por hoy.');
  if (status !== 200) throw new Error(`OpenRouter respondió ${status}. Revisa la clave y el modelo en Ajustes.`);
  const c = j.choices?.[0]?.message?.content;
  return parseAI(Array.isArray(c) ? c.map((x) => x.text || '').join('') : c);
}

// Pregunta a la IA: primero Gemini y, si llega al límite o está saturado, OpenRouter. aiVia dice cuál respondió.
let aiVia = '';
async function ia(parts) {
  const s = db.settings;
  if (!s.apiKey && !s.orKey) throw new Error('Falta una clave de IA en Ajustes (Gemini u OpenRouter). Mientras tanto, rellena los campos a mano.');
  if (s.apiKey) {
    try { const o = await askGemini(parts); aiVia = 'Gemini'; return o; } catch (e) {
      if (!e.busy) throw e;
      if (!s.orKey) throw new Error(`${e.message} Inténtalo más tarde, rellena los datos a mano o añade una clave de OpenRouter en Ajustes.`);
    }
  }
  const o = await askOpenRouter(parts); aiVia = 'OpenRouter'; return o;
}

// Planes importados con la versión anterior no tenían `desde`: se cuenta desde hoy.
if (db.plan && !db.plan.desde) { db.plan.desde = todayKey(); save(); }
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
