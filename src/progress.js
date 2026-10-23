// Watch drill progress, shared by the server (SayBetter Drill watch app) and the CLI (nightly review).
// Bee owns both halves of the loop: its todos say what to practise ("Say it: …"), and when the watch
// app passes a drill the todo is completed and the pattern's Bee fact records the progress.
import { labelFor } from './patterns.js';

const SAY_IT = /^\s*say it:\s*/i;
const WATCH_PART = /, practised out loud on my Apple Watch \d+× \(latest pronunciation score \d+\)/;

const toIso = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const toMs = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Turn `bee todos list --json` todos into watch drills. Only "Say it: …" todos count; open ones are
 * always kept, completed ones only while recent (so today's passes still show as done).
 * Details SayBetter knows locally (original sentence, mistake pattern) are merged in by todo id.
 */
export function drillsFromBeeTodos(todos, local = [], { now = Date.now(), keepDoneMs = 2 * 86400000, done = {} } = {}) {
  const byId = new Map((Array.isArray(local) ? local : []).filter((d) => d && d.todo_id != null).map((d) => [Number(d.todo_id), d]));
  const recent = (ms) => ms == null || now - ms <= keepDoneMs;
  const fromBee = (Array.isArray(todos) ? todos : [])
    .filter((t) => t && t.id != null && typeof t.text === 'string' && SAY_IT.test(t.text))
    .filter((t) => !t.completed || recent(toMs(t.completed_at ?? t.updated_at ?? t.created_at)))
    .map((t) => {
      const mine = byId.get(Number(t.id)) || {};
      return {
        todo_id: Number(t.id),
        text: t.text,
        natural: t.text.replace(SAY_IT, '').trim(),
        original: mine.original || '',
        pattern: mine.pattern || '',
        alarm_at: toIso(t.alarm_at) || mine.alarm_at || null,
        completed: !!t.completed,
      };
    });
  // Bee may leave completed todos out of the list: keep today's watch passes visible as done.
  const seen = new Set(fromBee.map((d) => d.todo_id));
  const passed = Object.entries(done && typeof done === 'object' ? done : {})
    .filter(([id, rec]) => !seen.has(Number(id)) && byId.has(Number(id)) && rec && recent(rec.ts))
    .map(([id]) => ({ ...byId.get(Number(id)), todo_id: Number(id), completed: true }));
  return [...fromBee, ...passed];
}

/** Passed watch drills per mistake pattern: Map(pattern -> { count, score, ts }). */
export function watchPasses(drills, done) {
  const pattern = new Map((Array.isArray(drills) ? drills : []).filter((d) => d && d.todo_id != null).map((d) => [String(d.todo_id), d.pattern]));
  const out = new Map();
  const recs = Object.entries(done && typeof done === 'object' ? done : {}).sort((a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0));
  for (const [id, rec] of recs) {
    const p = pattern.get(id);
    if (!p || !rec) continue;
    const cur = out.get(p) || { count: 0, score: null, ts: null };
    out.set(p, { count: cur.count + 1, score: rec.score ?? cur.score, ts: rec.ts ?? cur.ts });
  }
  return out;
}

/** Add (or refresh) the watch-practice clause in a SayBetter fact, keeping the trailing "as of DATE." */
export function withWatchProgress(text, progress, date) {
  const base = String(text || '').replace(WATCH_PART, '').replace(/\s+as of \d{4}-\d{2}-\d{2}\.?\s*$/, '').replace(/[.\s]+$/, '');
  if (!progress || !progress.count) return `${base} as of ${date}.`;
  const score = progress.score == null ? '' : ` (latest pronunciation score ${progress.score})`;
  const part = score ? `, practised out loud on my Apple Watch ${progress.count}×${score}` : `, practised out loud on my Apple Watch ${progress.count}×`;
  return `${base}${part} as of ${date}.`;
}

/** A first fact for a pattern that so far was only drilled on the watch. */
export function watchFactText(pattern, natural, progress, date) {
  const label = labelFor(pattern).label.toLowerCase();
  const ex = String(natural || '').replace(/[.!?]+$/, '');
  return withWatchProgress(`English coach: I'm practising ${label} out loud — e.g. "${ex}"`, progress, date);
}
