export function gradeOf(pct) {
  if (pct >= 90) return { grade: 'A+', point: 10 };
  if (pct >= 80) return { grade: 'A', point: 9 };
  if (pct >= 70) return { grade: 'B', point: 8 };
  if (pct >= 60) return { grade: 'C', point: 7 };
  if (pct >= 50) return { grade: 'D', point: 6 };
  if (pct >= 40) return { grade: 'E', point: 5 };
  return { grade: 'F', point: 0 };
}
export const PASS_PERCENT = 40;
