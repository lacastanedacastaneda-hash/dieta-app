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
  const PST = ['ok', 'cambio', 'salto'];
  function planWeekStats(db, k) {
    const p = db.plan, sel = db.settings.planSel, ws = weekStart(parse(k));
    const keys = Array.from({ length: 7 }, (_, i) => iso(addDays(ws, i))), idx = keys.indexOf(k);
    const st = { ok: 0, cambio: 0, salto: 0, sin: 0, total: 0, legumbres: 0, legumbresMenu: 0, reglas: {}, dias: [], elapsed: 0 };
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
        if (v === 'ok' && m.legumbres) st.legumbres++;
      }
      for (const r of Object.keys(p.reglas)) if (((d.cnt || {})[r] || 0) >= p.reglas[r]) st.reglas[r]++;
    });
    st.pct = st.total ? Math.round((st.ok / st.total) * 100) : null;
    return st;
  }

  // Último peso registrado y días que han pasado desde entonces hasta `k` (null si no hay ninguno).
  function lastWeight(db, k) {
    const ks = Object.keys(db.weights || {}).filter((x) => x <= k).sort();
    if (!ks.length) return null;
    const last = ks[ks.length - 1];
    return { key: last, kg: db.weights[last], days: Math.round((parse(k) - parse(last)) / 864e5) };
  }

  const L = { iso, parse, addDays, weekStart, dayRO, tot, gymDelta, plan, norm, search, PDAYS, PMEALS, readPlan, planWeek, planDay, planWeekStats, lastWeight };
  if (typeof module !== 'undefined') module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
