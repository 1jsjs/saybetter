// SayBetter local web UI server. Node built-ins only.
//
//   import { startServer } from '../src/server.js';
//   const { url, close } = await startServer({ port: 4173, home });

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { labelFor } from './patterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UI_DIR = path.resolve(__dirname, '..', 'ui');

export function defaultHome() {
  return process.env.SAYBETTER_HOME || path.join(os.homedir(), '.saybetter');
}

// ---------- date helpers (local time) ----------
const pad = (n) => String(n).padStart(2, '0');
export function localDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + delta));
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- defensive readers ----------
function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
function readJson(file, fallback) {
  const t = readText(file);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
}
function readJsonl(file) {
  const t = readText(file);
  if (!t) return [];
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
    } catch { /* skip bad line */ }
  }
  return out;
}
const asArray = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// ---------- normalisation ----------
const SEVERITIES = new Set(['high', 'medium', 'low']);
export function normalizeItem(raw, i = 0) {
  const ts = Number.isFinite(Number(raw.ts)) && raw.ts !== '' && raw.ts != null ? Number(raw.ts) : null;
  const date = isDate(raw.date) ? raw.date : ts != null ? localDate(new Date(ts)) : null;
  const corrected = str(raw.corrected);
  const natural = str(raw.natural) || corrected;
  const lab = labelFor(raw.pattern);
  return {
    id: str(raw.utterance_id) || `${ts ?? 'x'}-${i}`,
    utterance_id: str(raw.utterance_id) || null,
    ts,
    date,
    pattern: lab.pattern,
    pattern_label: lab.label,
    pattern_label_ko: lab.label_ko,
    original: str(raw.original),
    corrected: corrected || natural,
    natural,
    explanation_ko: str(raw.explanation_ko),
    kind: raw.kind === 'tutor' ? 'tutor' : 'fix',
    severity: SEVERITIES.has(raw.severity) ? raw.severity : 'medium',
  };
}

export function loadHistory(home) {
  return readJsonl(path.join(home, 'history.jsonl'))
    .map(normalizeItem)
    .filter((it) => it.date && it.original);
}

export function itemsForDate(history, date) {
  return history
    .filter((it) => it.date === date)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

export function aggregatePatterns(history, wins = []) {
  const map = new Map();
  const get = (pattern) => {
    let p = map.get(pattern);
    if (!p) {
      const lab = labelFor(pattern);
      p = { pattern: lab.pattern, label: lab.label, label_ko: lab.label_ko, count: 0, wins: 0, last: null, _ts: -Infinity, examples: [], win_examples: [] };
      map.set(lab.pattern, p);
    }
    return p;
  };
  for (const it of history) {
    const p = get(it.pattern);
    p.count++;
    p.examples.push({ original: it.original, natural: it.natural, date: it.date, ts: it.ts, kind: it.kind });
    const t = it.ts ?? (Date.parse(it.date) || 0);
    if (t >= p._ts) { p._ts = t; p.last = { original: it.original, natural: it.natural }; }
  }
  for (const w of wins) {
    const p = get(w.pattern);
    p.wins++;
    p.win_examples.push({ text: w.text, date: w.date, ts: w.ts });
  }
  const byTs = (a, b) => (b.ts ?? 0) - (a.ts ?? 0);
  return [...map.values()]
    .map(({ _ts, examples, win_examples, ...p }) => ({
      ...p,
      examples: examples.sort(byTs).slice(0, 5).map(({ ts, ...e }) => e),
      win_examples: win_examples.sort(byTs).slice(0, 3).map(({ ts, ...e }) => e),
    }))
    .sort((a, b) => b.count - a.count || b.wins - a.wins || a.label.localeCompare(b.label));
}

// ---------- real-life wins ----------
export function loadWins(home) {
  return readJsonl(path.join(home, 'wins.jsonl'))
    .map((w) => {
      const ts = Number.isFinite(Number(w.ts)) && w.ts != null && w.ts !== '' ? Number(w.ts) : null;
      return {
        ts,
        date: isDate(w.date) ? w.date : ts != null ? localDate(new Date(ts)) : null,
        pattern: labelFor(w.pattern).pattern,
        text: str(w.text),
        utterance_id: str(w.utterance_id) || null,
      };
    })
    .filter((w) => w.date && w.text);
}

export function winsStats(wins, today) {
  const weekStart = addDays(today, -6);
  return { wins_total: wins.length, wins_week: wins.filter((w) => w.date >= weekStart && w.date <= today).length };
}

// ---------- today's one thing ----------
const SEV_WEIGHT = { high: 3, medium: 2, low: 1 };
export function deriveTakeaway(items, report = null) {
  const fromReport = report && typeof report.takeaway_ko === 'string' && report.takeaway_ko.trim();
  const scores = new Map();
  for (const it of items) scores.set(it.pattern, (scores.get(it.pattern) || 0) + (SEV_WEIGHT[it.severity] || 2));
  let pattern = report && typeof report.takeaway_pattern === 'string' && report.takeaway_pattern.trim()
    ? labelFor(report.takeaway_pattern).pattern : null;
  if (!pattern && scores.size) pattern = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (!pattern && !fromReport) return null;
  const lab = labelFor(pattern);
  const ex = [...items].reverse().find((it) => it.pattern === pattern) || null;
  const count = items.filter((it) => it.pattern === pattern).length;
  const name = lab.label_ko || lab.label;
  const text_ko = fromReport
    ? report.takeaway_ko.trim()
    : ex && ex.explanation_ko ? ex.explanation_ko : `오늘 하나만 기억하세요 — ${name}.${count > 1 ? ` 오늘 ${count}번 나왔어요.` : ''}`;
  return {
    text_ko, pattern: lab.pattern, label: lab.label, label_ko: lab.label_ko, count,
    example: ex ? { original: ex.original, natural: ex.natural, kind: ex.kind } : null,
    derived: !fromReport,
  };
}

// ---------- spaced repetition (Leitner, derived from practice.jsonl) ----------
export const LEITNER_DAYS = [0, 1, 3, 7, 14]; // index = box (1..4)

/** Replay practice records → { [itemId]: {box, last_date} } */
export function leitnerState(practice) {
  const st = {};
  const recs = practice.filter((p) => p.utterance_id).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  for (const r of recs) {
    const cur = st[r.utterance_id] || { box: 1, last_date: null, reps: 0 };
    const revealed = Number(r.hint) >= 2;
    cur.box = r.ok && !revealed ? Math.min(cur.box + 1, 4) : 1;
    cur.last_date = r.date;
    cur.reps++;
    st[r.utterance_id] = cur;
  }
  return st;
}

export function reviewQueue(history, practice, today, limit = 10) {
  const st = leitnerState(practice);
  const counts = { box1: 0, box2: 0, box3: 0, box4: 0 };
  const due = [];
  for (const it of history) {
    const s = st[it.id] || st[it.utterance_id];
    const box = s ? s.box : 1;
    counts[`box${box}`]++;
    if (it.date >= today) continue; // today's items are practised anyway
    const from = s && s.last_date ? s.last_date : it.date;
    const due_date = addDays(from, LEITNER_DAYS[box]);
    if (due_date <= today) due.push({ ...it, box, due_date, review: true });
  }
  due.sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.ts ?? 0) - (b.ts ?? 0));
  return { due: due.slice(0, limit), due_total: due.length, counts };
}

export function aggregateDays(history, today, span = 7) {
  const counts = new Map();
  for (const it of history) counts.set(it.date, (counts.get(it.date) || 0) + 1);
  for (let i = span - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    if (!counts.has(d)) counts.set(d, 0);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function loadPractice(home) {
  return readJsonl(path.join(home, 'practice.jsonl')).map((p) => ({
    ...p,
    date: isDate(p.date) ? p.date : Number.isFinite(Number(p.ts)) ? localDate(new Date(Number(p.ts))) : null,
    ok: p.ok === true,
  })).filter((p) => p.date);
}

export function practiceStats(practice, today) {
  const todays = practice.filter((p) => p.date === today);
  const okDays = new Set(practice.filter((p) => p.ok).map((p) => p.date));
  // Streak counts back from today; if today has no pass yet, start from yesterday.
  let cursor = okDays.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (okDays.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return { today_ok: todays.filter((p) => p.ok).length, today_total: todays.length, streak_days: streak };
}

export function loadDrills(home) {
  return asArray(readJson(path.join(home, 'drills.json'), []))
    .map((d) => ({
      todo_id: d.todo_id ?? null,
      text: str(d.text),
      natural: str(d.natural),
      alarm_at: str(d.alarm_at) || null,
      created_at: str(d.created_at) || null,
    }))
    .sort((a, b) => str(a.alarm_at).localeCompare(str(b.alarm_at)));
}

export function loadFacts(home) {
  return asArray(readJson(path.join(home, 'facts.json'), [])).map((f) => {
    const lab = labelFor(f.pattern);
    return {
      fact_id: f.fact_id ?? null,
      pattern: lab.pattern,
      label: lab.label,
      label_ko: lab.label_ko,
      text: str(f.text),
      created_at: str(f.created_at) || null,
    };
  });
}

function loadReport(home, date) {
  const r = readJson(path.join(home, 'reports', `${date}.json`), null);
  return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
}

function loadPraise(home, dates) {
  for (const d of dates) {
    const r = readJson(path.join(home, 'reports', `${d}.json`), null);
    if (r && typeof r.praise_ko === 'string' && r.praise_ko.trim()) return r.praise_ko.trim();
  }
  return '';
}

export function buildSummary(home, now = new Date()) {
  const today = localDate(now);
  const history = loadHistory(home);
  const wins = loadWins(home);
  const practice = loadPractice(home);
  const days = aggregateDays(history, today);
  const withItems = days.filter((d) => d.count > 0).map((d) => d.date);
  const latest_date = withItems.length ? withItems[withItems.length - 1] : null;
  const todayItems = itemsForDate(history, today);
  const focusDate = todayItems.length ? today : latest_date;
  const report = (focusDate && loadReport(home, focusDate)) || loadReport(home, today);
  const focusItems = focusDate ? itemsForDate(history, focusDate) : [];
  const used = report && Array.isArray(report.used_correctly) ? report.used_correctly : [];
  return {
    today: { date: today, items: todayItems },
    latest_date,
    total_items: history.length,
    days,
    patterns: aggregatePatterns(history, wins),
    drills: loadDrills(home),
    facts: loadFacts(home),
    praise_ko: loadPraise(home, [today, ...(latest_date ? [latest_date] : [])]),
    takeaway: deriveTakeaway(focusItems, report),
    used_correctly: used
      .filter((u) => u && typeof u === 'object' && u.text)
      .map((u) => ({ utterance_id: str(u.utterance_id) || null, pattern: labelFor(u.pattern).pattern, label: labelFor(u.pattern).label, text: str(u.text) })),
    wins: wins.filter((w) => w.date === today).map((w) => ({ ...w, label: labelFor(w.pattern).label })),
    ...winsStats(wins, today),
    review: reviewQueue(history, practice, today),
    practice: practiceStats(practice, today),
  };
}

export function appendPractice(home, body, now = new Date()) {
  const rec = {
    ts: now.getTime(),
    date: localDate(now),
    utterance_id: str(body.utterance_id).slice(0, 200) || null,
    said: str(body.said).slice(0, 1000),
    ok: body.ok === true,
    hint: [0, 1, 2].includes(Number(body.hint)) ? Number(body.hint) : 0,
  };
  fs.mkdirSync(home, { recursive: true });
  fs.appendFileSync(path.join(home, 'practice.jsonl'), JSON.stringify(rec) + '\n');
  return rec;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(body);
}

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(UI_DIR, '.' + rel);
  if (!file.startsWith(UI_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHandler(home) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p === '/api/summary' && req.method === 'GET') return sendJson(res, 200, buildSummary(home));
      if (p === '/api/items' && req.method === 'GET') {
        const date = url.searchParams.get('date') || localDate();
        if (!isDate(date)) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' });
        return sendJson(res, 200, { date, items: itemsForDate(loadHistory(home), date) });
      }
      if (p === '/api/practice' && req.method === 'POST') {
        let body;
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid body' });
        const rec = appendPractice(home, body);
        return sendJson(res, 200, { saved: rec, practice: practiceStats(loadPractice(home), localDate()) });
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
      if (p === '/lib/patterns.js') {
        // Share the label map with the browser (used for sample data).
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' });
        return res.end(fs.readFileSync(path.join(__dirname, 'patterns.js')));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(res, p);
    } catch (err) {
      sendJson(res, 500, { error: String(err && err.message || err) });
    }
  };
}

/**
 * Start the SayBetter UI server.
 * @returns {Promise<{server: http.Server, url: string, port: number, home: string, close: () => Promise<void>}>}
 */
export function startServer({ port = 4173, home = defaultHome(), host = '127.0.0.1' } = {}) {
  const server = http.createServer(createHandler(home));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      const url = `http://localhost:${actual}/`;
      resolve({ server, url, port: actual, home, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
