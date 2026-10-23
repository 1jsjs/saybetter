// Everything SayBetter remembers lives in ~/.saybetter (SAYBETTER_HOME) as plain files the web UI reads.
import fs from 'node:fs';
import path from 'node:path';
import { SAYBETTER_DIR as HOME, ensureDir, warn } from './log.js';
import { localDate } from './schedule.js';

export const home = () => HOME;
const file = (...p) => path.join(HOME, ...p);

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, value) {
  ensureDir();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, p);
}

// ---- state: what has already been coached / drilled / saved as a fact ----
export function loadState() {
  const s = readJson(file('state.json'), {});
  return { reviewed: s.reviewed || [], drilled: s.drilled || [], factPatterns: s.factPatterns || [] };
}
export function saveState(s) {
  s.reviewed = s.reviewed.slice(-5000);
  s.drilled = s.drilled.slice(-500);
  writeJson(file('state.json'), s);
}

// ---- history: one line per coached sentence ----
export function appendHistory(items, ts = Date.now()) {
  if (!items.length) return;
  ensureDir();
  const lines = items.map((it) => JSON.stringify({ ts, date: localDate(ts), ...it })).join('\n') + '\n';
  fs.appendFileSync(file('history.jsonl'), lines);
}
export function loadHistory() {
  try {
    return fs
      .readFileSync(file('history.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
export function patternCounts(history = loadHistory()) {
  const counts = new Map();
  for (const h of history) counts.set(h.pattern, (counts.get(h.pattern) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ---- real-life wins: a known weak pattern used correctly in real conversation ----
export function appendWins(wins, ts = Date.now()) {
  if (!wins.length) return;
  ensureDir();
  fs.appendFileSync(file('wins.jsonl'), wins.map((w) => JSON.stringify({ ts, date: localDate(ts), ...w })).join('\n') + '\n');
}
export function loadWins() {
  try {
    return fs.readFileSync(file('wins.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

// ---- drills and facts, mirrored locally for the UI ----
export const loadDrills = () => readJson(file('drills.json'), []);
export const saveDrills = (d) => writeJson(file('drills.json'), d);
export const loadFacts = () => readJson(file('facts.json'), []);
export const saveFacts = (f) => writeJson(file('facts.json'), f);
export const loadDrillsDone = () => readJson(file('drills_done.json'), {});

// ---- daily report: JSON for the UI, Markdown for humans ----
export function writeReport(date, { items, praise_ko, takeaway_ko, takeaway_pattern, used_correctly = [] }) {
  const jsonPath = file('reports', `${date}.json`);
  const prev = readJson(jsonPath, { date, items: [] });
  const report = {
    date,
    praise_ko: praise_ko || prev.praise_ko || '',
    takeaway_ko: takeaway_ko || prev.takeaway_ko || '',
    takeaway_pattern: takeaway_pattern || prev.takeaway_pattern || '',
    items: [...(prev.items || []), ...items],
    used_correctly: [...(prev.used_correctly || []), ...used_correctly],
  };
  writeJson(jsonPath, report);
  const md = [`# SayBetter — ${date}`, '', report.takeaway_ko ? `**Today's one thing:** ${report.takeaway_ko}` : '', report.praise_ko ? `> ${report.praise_ko}` : '', ''];
  for (const w of report.used_correctly) md.push(`- ✓ real-life win (${w.pattern}): ${w.text}`);
  for (const it of report.items) {
    md.push(`- **${it.pattern}** (${it.severity})`, `  - said: ${it.original}`, `  - fix: ${it.corrected}`, `  - say: ${it.natural}`, it.explanation_ko ? `  - ${it.explanation_ko}` : '', '');
  }
  fs.writeFileSync(file('reports', `${date}.md`), md.filter((l) => l !== null).join('\n'));
  return { jsonPath, mdPath: file('reports', `${date}.md`) };
}

export { warn };
