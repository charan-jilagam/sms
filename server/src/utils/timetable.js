/**
 * Automatic timetable generator.
 * Round-robin over subjects so lessons spread across the week; picks, for each lesson, the free slot that
 *  1) keeps the subject to at most ~1 lesson a day, 2) avoids the same period every day,
 *  3) balances the load across days, and never double-books a teacher (globally).
 * Deterministic: same input => same output.
 */
export function generateTimetable({ classes, periods, days, busy = new Set() }) {
  const entries = [], unplaced = [];
  for (const cls of classes) {
    const grid = new Set();                       // `${day}:${periodId}` taken for this class
    const perDay = Array(days + 1).fill(0);
    const subjCount = new Map();                  // `${subject}:${day}` -> n
    const subjPeriod = new Map();                 // `${subject}:${periodId}` -> n
    const demands = cls.subjects.filter((s) => s.periods_per_week > 0).map((s) => ({ ...s, left: s.periods_per_week }));
    demands.sort((a, b) => b.periods_per_week - a.periods_per_week || a.subject_id - b.subject_id);
    let progress = true;
    while (progress) {
      progress = false;
      for (const d of demands) {
        if (d.left <= 0) continue;
        let best = null;
        for (let day = 1; day <= days; day++) {
          for (const p of periods) {
            const key = `${day}:${p.id}`;
            if (grid.has(key)) continue;
            if (d.teacher_id && busy.has(`${d.teacher_id}:${key}`)) continue;
            const score = (subjCount.get(`${d.subject_id}:${day}`) || 0) * 1000
              + (subjPeriod.get(`${d.subject_id}:${p.id}`) || 0) * 10
              + perDay[day] * 3 + p.seq * 0.01 + day * 0.001;
            if (!best || score < best.score) best = { day, p, score, key };
          }
        }
        if (!best) { unplaced.push({ class_id: cls.id, subject_id: d.subject_id, missing: d.left }); d.left = 0; continue; }
        grid.add(best.key); perDay[best.day]++;
        subjCount.set(`${d.subject_id}:${best.day}`, (subjCount.get(`${d.subject_id}:${best.day}`) || 0) + 1);
        subjPeriod.set(`${d.subject_id}:${best.p.id}`, (subjPeriod.get(`${d.subject_id}:${best.p.id}`) || 0) + 1);
        if (d.teacher_id) busy.add(`${d.teacher_id}:${best.key}`);
        entries.push({ class_id: cls.id, day: best.day, period_id: best.p.id, subject_id: d.subject_id, teacher_id: d.teacher_id || null });
        d.left--; progress = true;
      }
    }
  }
  return { entries, unplaced };
}
