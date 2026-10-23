// When tomorrow's wrist drills fire: 09:00, 13:00, 19:00, 21:00 local, then the day after.
export const DRILL_HOURS = [9, 13, 19, 21];

export function drillTimes(count, now = new Date()) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const day = Math.floor(i / DRILL_HOURS.length) + 1;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, DRILL_HOURS[i % DRILL_HOURS.length], 0, 0, 0);
    out.push(d.toISOString());
  }
  return out;
}

export function localDate(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
