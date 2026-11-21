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

  const L = { iso, parse, addDays, weekStart, dayRO, tot, gymDelta, plan };
  if (typeof module !== 'undefined') module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
