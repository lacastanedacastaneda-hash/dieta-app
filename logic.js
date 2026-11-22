// Lógica pura (sin DOM): fechas, totales y presupuesto semanal con ajuste.
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const weekStart = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
  const dayRO = (db, k) => db.days[k] || { entries: [] };

  function tot(db, k) {
    return dayRO(db, k).entries.reduce(
      (a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }),
      { kcal: 0, p: 0, c: 0, f: 0 }
    );
  }

  // Cuenta solo lo que se desvía de tu rutina: sesión programada y no hecha resta; sesión en día libre suma.
  function gymDelta(db, k) {
    const s = db.settings, d = parse(k), st = dayRO(db, k).gym;
    const scheduled = s.gymDays.includes(d.getDay());
    if (scheduled && st === 'no') return -s.gymKcal;
    if (!scheduled && st === 'yes') return s.gymKcal;
    return 0;
  }

  /* ---------- Rutina de gimnasio (se escribe en Ajustes; vive solo en el móvil) ---------- */
  // Tipos de día: descanso; fuerza; piernas (fuerza de tren inferior: conviene no quedarse corto de hidratos); ligera (estiramientos…).
  const RTYPES = ['descanso', 'fuerza', 'piernas', 'ligera'];
  const isStrength = (t) => t === 'fuerza' || t === 'piernas';
  // Rutina de los 7 días (índice = getDay()). Sin rutina guardada: fuerza los días de gimnasio y descanso el resto.
  function routineOf(s) {
    const r = Array.isArray(s.routine) && s.routine.length === 7 ? s.routine : null;
    return Array.from({ length: 7 }, (_, i) => {
      const x = (r && r[i]) || {};
      return { t: RTYPES.includes(x.t) ? x.t : (s.gymDays || []).includes(i) ? 'fuerza' : 'descanso', txt: String(x.txt || '').trim() };
    });
  }
  // Sesiones de la semana de `k`: de fuerza (day.gym) y ligeras (day.light), hechas y previstas según la rutina.
  function gymWeek(db, k) {
    const ws = weekStart(parse(k)), r = routineOf(db.settings);
    const w = { fuerza: { done: 0, plan: 0 }, ligera: { done: 0, plan: 0 } };
    for (let i = 0; i < 7; i++) {
      const kk = iso(addDays(ws, i)), d = dayRO(db, kk), t = r[parse(kk).getDay()].t;
      if (isStrength(t)) w.fuerza.plan++;
      if (t === 'ligera') w.ligera.plan++;
      if (d.gym === 'yes') w.fuerza.done++;
      if (d.light === 'yes') w.ligera.done++;
    }
    return w;
  }

  /* ---------- Entreno: series, repeticiones y peso por ejercicio (db.workout, solo en el móvil) ---------- */
  // Registro de un ejercicio en un día: {n: nombre, s: series, r: [repeticiones], kg}. r con un valor = igual en todas las series.
  // «10» → [10]; «10, 8, 6» o «10/8/6» → [10, 8, 6]; vacío o sin números → null.
  function parseReps(t) {
    const r = String(t ?? '').split(/[\s,/;x×-]+/).filter(Boolean).map(Number);
    return r.length && r.every((x) => Number.isInteger(x) && x > 0 && x < 1000) ? r : null;
  }
  // Deja un registro coherente: si hay varias repeticiones, las series son tantas como valores.
  function cleanSet(n, s, r, kg) {
    const reps = Array.isArray(r) ? r : parseReps(r);
    if (!reps) return null;
    const series = reps.length > 1 ? reps.length : Math.max(1, Math.min(50, Math.round(Number(s) || 1)));
    const w = Number(String(kg ?? '').replace(',', '.'));
    return { n: String(n || ''), s: series, r: reps, kg: w > 0 && w < 1000 ? Math.round(w * 100) / 100 : 0 };
  }
  // «3 × 10 · 40 kg», «10/8/6 · 40 kg», «3 × 15 · sin peso».
  function fmtSet(e) {
    if (!e) return '';
    const reps = e.r.length > 1 ? e.r.join('/') : `${e.s} × ${e.r[0]}`;
    return `${reps} · ${e.kg ? `${String(e.kg).replace('.', ',')} kg` : 'sin peso'}`;
  }
  // Sesiones de un ejercicio, de la más reciente a la más antigua (antes de `before` si se indica).
  function exHistory(log, id, before) {
    return Object.keys(log || {}).filter((k) => log[k][id] && (!before || k < before)).sort().reverse().map((k) => ({ key: k, e: log[k][id] }));
  }
  // Mejor marca: el mayor peso (y, a igual peso, más repeticiones en una serie).
  function exBest(log, id) {
    let best = null;
    for (const h of exHistory(log, id)) {
      const top = Math.max(...h.e.r);
      if (!best || h.e.kg > best.e.kg || (h.e.kg === best.e.kg && top > Math.max(...best.e.r))) best = h;
    }
    return best;
  }

  // Presupuesto de la semana de `todayKey` y objetivo de hoy tras repartir lo gastado.
  function plan(db, todayKey) {
    const s = db.settings;
    const ws = weekStart(parse(todayKey));
    const keys = Array.from({ length: 7 }, (_, i) => iso(addDays(ws, i)));
    const weekly = s.target * 7 + keys.reduce((a, k) => a + gymDelta(db, k), 0);
    const idx = Math.max(0, keys.indexOf(todayKey));
    // Los días pasados sin ningún registro cuentan como "objetivo" para no regalar margen.
    const past = keys.slice(0, idx).reduce((a, k) => a + (dayRO(db, k).entries.length ? tot(db, k).kcal : s.target), 0);
    const raw = Math.round((weekly - past) / (7 - idx));
    const todayTarget = Math.max(s.floor, raw);
    const eaten = keys.reduce((a, k) => a + tot(db, k).kcal, 0);
    return { keys, weekly, past, raw, todayTarget, eaten, adjust: todayTarget - s.target, floored: raw < s.floor };
  }

  // Texto en minúsculas y sin acentos, para buscar sin que importen.
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Productos del catálogo cuyo nombre (o formato) contiene todas las palabras buscadas.
  function search(list, q, max = 30) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const p of list) {
      const t = norm(`${p.name} ${p.fmt || ''}`);
      if (words.every((w) => t.includes(w))) { out.push(p); if (out.length >= max) break; }
    }
    return out;
  }

  /* ---------- Plan de comidas (menús por semanas; se importa desde Ajustes y vive solo en el móvil) ---------- */
  const PDAYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']; // índice = getDay()
  const PMEALS = [['desayuno', 'Desayuno'], ['almuerzo', 'Comida'], ['cena', 'Cena']]; // clave del plan → nombre en la app

  // Comprueba el JSON del plan y lo deja en el formato que usa la app. Lanza un Error en español si no sirve.
  function readPlan(j) {
    if (!j || !Array.isArray(j.semanas) || !j.semanas.length) throw new Error('El archivo no tiene «semanas».');
    const semanas = j.semanas.map((w, i) => {
      const days = {};
      for (const d of PDAYS.slice(1).concat('dom')) {
        const src = w?.days?.[d];
        if (!src) throw new Error(`A la semana ${i + 1} le falta el día «${d}».`);
        days[d] = {};
        for (const [m] of PMEALS) {
          const x = src[m];
          if (!x || typeof x.text !== 'string' || !x.text.trim()) throw new Error(`A la semana ${i + 1}, «${d}», le falta el texto de «${m}».`);
          days[d][m] = { text: x.text.trim(), tags: Array.isArray(x.tags) ? x.tags.map(String) : [], ...(x.libre ? { libre: true } : {}), ...(x.legumbres ? { legumbres: true } : {}) };
        }
      }
      return { name: String(w.name || `Semana ${String.fromCharCode(65 + i)}`), days };
    });
    const r = j.reglasDiarias || {}, n = (v, def) => (Number(v) > 0 ? Number(v) : def);
    return {
      semanas,
      reglas: { agua: n(r.aguaVasos ?? r.agua, 14), fruta: n(r.frutas ?? r.fruta, 3), lacteo: n(r.lacteos ?? r.lacteo, 2), ensalada: n(r.ensaladasCrudas ?? r.ensaladas, 2) },
      legumbresMax: n(j.reglasSemanales?.legumbresMaxVeces, 2),
      pesoCadaDias: n(j.reglasSemanales?.controlPesoYGrasaCadaDias, 15),
      racionMaxG: n(j.racionCarnePescadoMaxGramos ?? j.proteinaMaxGramosComidaYCena, 0) || null,
      prohibido: Array.isArray(j.prohibidoFueraDeComidas) ? j.prohibidoFueraDeComidas.map(String) : [],
      permitido: Array.isArray(j.permitido) ? j.permitido.map(String) : [],
      nota: typeof j.revisarConProfesional === 'string' ? j.revisarConProfesional : '',
    };
  }

  // Qué semana del plan toca en la fecha `k`. sel = {mode:'alt'|'fixed', week, start}: con 'alt', `week` es la que tocaba la semana de `start`.
  function planWeek(p, sel, k) {
    const n = p.semanas.length, w0 = (sel && Number(sel.week)) || 0;
    if (!sel || sel.mode !== 'alt' || !sel.start) return ((w0 % n) + n) % n;
    const weeks = Math.round((weekStart(parse(k)) - weekStart(parse(sel.start))) / (7 * 864e5));
    return (((w0 + weeks) % n) + n) % n;
  }

  // Menú del día `k`: [{key, meal, text, tags, libre, legumbres}].
  function planDay(p, sel, k) {
    const wi = planWeek(p, sel, k), d = p.semanas[wi].days[PDAYS[parse(k).getDay()]];
    return { week: wi, weekName: p.semanas[wi].name, meals: PMEALS.map(([key, meal]) => ({ key, meal, ...d[key] })) };
  }

  // Resumen de la semana de `k` con el plan. Los días pasados cuentan sus 3 comidas (sin marcar = «sin marcar»);
  // de hoy solo cuentan las ya marcadas. No cuentan los días futuros ni los anteriores a importar el plan (p.desde).
  // Estados de una comida: ok = seguida; swap = seguida con cambio (cuenta como seguida y guarda qué faltó en day.swap);
  // cambio = cambiada; salto = me la salté.
  const PST = ['ok', 'swap', 'cambio', 'salto'];
  function planWeekStats(db, k) {
    const p = db.plan, sel = db.settings.planSel, ws = weekStart(parse(k));
    const keys = Array.from({ length: 7 }, (_, i) => iso(addDays(ws, i))), idx = keys.indexOf(k);
    const st = { ok: 0, swap: 0, cambio: 0, salto: 0, sin: 0, total: 0, legumbres: 0, legumbresMenu: 0, reglas: {}, dias: [], elapsed: 0, faltas: {}, cambios: [] };
    for (const r of Object.keys(p.reglas)) st.reglas[r] = 0;
    keys.forEach((kk, i) => {
      const d = dayRO(db, kk), pd = planDay(p, sel, kk), marks = d.plan || {};
      const fut = i > idx, pre = !!p.desde && kk < p.desde;
      st.dias.push({ key: kk, fut, pre, today: i === idx, meals: pd.meals.map((m) => (PST.includes(marks[m.key]) ? marks[m.key] : '')) });
      st.legumbresMenu += pd.meals.filter((m) => m.legumbres).length;
      if (fut || pre) return;
      st.elapsed++;
      for (const m of pd.meals) {
        const v = PST.includes(marks[m.key]) ? marks[m.key] : '';
        if (v) st[v]++; else if (i < idx) st.sin++;
        if (v || i < idx) st.total++;
        if ((v === 'ok' || v === 'swap') && m.legumbres) st.legumbres++;
        if (v === 'swap') { // qué faltó y por qué se cambió
          const sw = (d.swap || {})[m.key] || {}, miss = Array.isArray(sw.miss) ? sw.miss : [];
          for (const x of miss) st.faltas[x] = (st.faltas[x] || 0) + 1;
          st.cambios.push({ key: kk, day: PDAYS[parse(kk).getDay()], meal: m.meal, miss, por: sw.por || '' });
        }
      }
      for (const r of Object.keys(p.reglas)) if (((d.cnt || {})[r] || 0) >= p.reglas[r]) st.reglas[r]++;
    });
    st.pct = st.total ? Math.round(((st.ok + st.swap) / st.total) * 100) : null;
    return st;
  }

  // Ingredientes de una comida del plan, con las alternativas separadas y sin repetir (para «¿qué te faltó?»).
  const mealIngredients = (m) => [...new Set((m.tags || []).flatMap(splitTag))];

  // Último peso registrado y días que han pasado desde entonces hasta `k` (null si no hay ninguno).
  function lastWeight(db, k) {
    const ks = Object.keys(db.weights || {}).filter((x) => x <= k).sort();
    if (!ks.length) return null;
    const last = ks[ks.length - 1];
    return { key: last, kg: db.weights[last], days: Math.round((parse(k) - parse(last)) / 864e5) };
  }

  /* ---------- Lista de la compra (se compra el viernes para los 7 días siguientes: sábado a viernes) ---------- */
  // Viernes de compra de la fecha `k` (`off` semanas antes o después): el mismo día si es viernes, si no, el siguiente.
  function shopFriday(k, off = 0) {
    const d = parse(k);
    return iso(addDays(d, ((5 - d.getDay() + 7) % 7) + 7 * off));
  }
  const shopDays = (f) => Array.from({ length: 7 }, (_, i) => iso(addDays(parse(f), i + 1)));

  // «Pescado, pollo o pavo» → ['pescado', 'pollo', 'pavo']. Un solo elemento si no hay alternativas.
  const splitTag = (t) => String(t).toLowerCase().split(/\s*,\s*|\s+y\/o\s+|\s+o\s+/).map((x) => x.trim()).filter(Boolean);

  // Ingredientes del menú de los días de la compra del viernes `f`.
  // n = comidas en las que va seguro; alt = comidas en las que es una de varias opciones; days = días (lun, mar…).
  function shopItems(p, sel, f) {
    const items = new Map();
    for (const k of shopDays(f)) {
      const dk = PDAYS[parse(k).getDay()];
      for (const m of planDay(p, sel, k).meals) {
        const seen = new Set(); // un ingrediente cuenta una vez por comida
        for (const tag of m.tags) {
          const parts = splitTag(tag);
          for (const name of parts) {
            if (seen.has(name)) continue;
            seen.add(name);
            const it = items.get(name) || { name, n: 0, alt: 0, days: [] };
            if (parts.length > 1) it.alt++; else it.n++;
            if (!it.days.includes(dk)) it.days.push(dk);
            items.set(name, it);
          }
        }
      }
    }
    return [...items.values()].sort((a, b) => b.n + b.alt - (a.n + a.alt) || a.name.localeCompare(b.name, 'es'));
  }

  /* ---------- Recordatorios: archivo de calendario (.ics) con eventos que se repiten y alarma a la hora ---------- */
  // rem = {desayuno, almuerzo, cena, gym, compra} en 'HH:MM'; gymDays = días de getDay(); start = 'YYYY-MM-DD'; stamp = Date.
  // Horas «flotantes» (sin zona): el calendario las toma en la hora local del móvil, también tras el cambio de hora.
  const RRDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function icsReminders(rem, gymDays, start, stamp) {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const dt = (hhmm) => `${start.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
    const utc = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ev = (id, title, hhmm, rrule, desc, min = 10) => (/^\d{2}:\d{2}$/.test(hhmm || '') ? [
      'BEGIN:VEVENT', `UID:mi-comida-${id}@recordatorios`, `DTSTAMP:${utc}`, `DTSTART:${dt(hhmm)}`, `DURATION:PT${min}M`,
      `RRULE:${rrule}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT',
    ] : []);
    const meal = 'Abre Mi comida y marca si has seguido el menú.';
    const gd = [...new Set(gymDays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => RRDAY[d]);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi comida//Recordatorios//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mi comida',
      // Duración de cada comida: desayuno 15 minutos; comida y cena, 45.
      ...ev('desayuno', 'Desayuno', rem.desayuno, 'FREQ=DAILY', meal, 15),
      ...ev('comida', 'Comida', rem.almuerzo, 'FREQ=DAILY', meal, 45),
      ...ev('cena', 'Cena', rem.cena, 'FREQ=DAILY', meal, 45),
      ...(gd.length ? ev('gimnasio', 'Gimnasio', rem.gym, `FREQ=WEEKLY;BYDAY=${gd.join(',')}`, 'Toca gimnasio. Después, márcalo en Mi comida.') : []),
      ...ev('compra', 'Lista de la compra', rem.compra, 'FREQ=WEEKLY;BYDAY=FR', 'Abre la pestaña Compra de Mi comida.'),
      'END:VCALENDAR',
    ];
    return lines.join('\r\n') + '\r\n';
  }

  const L = { iso, parse, addDays, weekStart, dayRO, tot, gymDelta, plan, norm, search, PDAYS, PMEALS, readPlan, planWeek, planDay, planWeekStats, lastWeight, shopFriday, shopDays, splitTag, shopItems, icsReminders, mealIngredients, RTYPES, isStrength, routineOf, gymWeek, parseReps, cleanSet, fmtSet, exHistory, exBest };
  if (typeof module !== 'undefined') module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
