#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, numberFlag } from '../src/cli.js';
import * as bee from '../src/bee.js';
import { UtteranceBuffer } from '../src/buffer.js';
import { englishUtterances } from '../src/english.js';
import { coach, bySeverity } from '../src/coach.js';
import { drillTimes, localDate, startOfToday } from '../src/schedule.js';
import * as store from '../src/store.js';
import { labelFor } from '../src/patterns.js';
import { watchPasses, withWatchProgress } from '../src/progress.js';
import { appendRawEvent, log, warn } from '../src/log.js';
import { runCommand } from '../src/proc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `saybetter — an English speaking coach built on what you actually said (via Bee)

Usage:
  saybetter review   [--today | --since HH:MM | --minutes N | --conversation <id>] [--drills 3] [--all] [--dry-run] [--json]
  saybetter watch    [--window 8] [--dry-run] [--input events.jsonl]
  saybetter check    "<an English sentence>" [--json]
  saybetter patterns
  saybetter serve    [--port 4173] [--open]
  saybetter schedule [--at 22:00] [--remove]      nightly review via macOS launchd
  saybetter version

Environment:
  SAYBETTER_LLM          claude (default) | gemini | fake
  SAYBETTER_HOME         data directory (default ~/.saybetter)
  GEMINI_API_KEY         for the gemini backend`;

const { command, positional, flags } = parseArgs(process.argv.slice(2));
const dryRun = Boolean(flags['dry-run']);
const asJson = Boolean(flags.json);
const say = (...a) => (asJson ? null : console.log(...a));

const knownPatterns = () => store.patternCounts().map(([p]) => p).slice(0, 12);

function printItems(items, praise, extra = {}) {
  if (asJson) return;
  for (const w of extra.used_correctly || []) say(`\n  ✓ real-life win · ${labelFor(w.pattern).label}: ${w.text}`);
  if (!items.length) return say('  Nothing to fix — that all sounded natural.');
  for (const it of items) {
    say(`\n  [${it.severity}] ${it.kind === 'tutor' ? 'How to say it' : labelFor(it.pattern).label}`);
    say(`    said    ${it.original}`);
    say(`    fix     ${it.corrected}`);
    if (it.natural && it.natural !== it.corrected) say(`    say     ${it.natural}`);
    if (it.explanation_ko) say(`    ${it.explanation_ko}`);
  }
  if (praise) say(`\n  ${praise}`);
  if (extra.takeaway_ko) say(`  Today's one thing: ${extra.takeaway_ko}`);
}

// Turn the best corrections into Bee todos with alarms tomorrow: drills that ring on the wrist.
async function createDrills(items, n, state) {
  const seen = new Set(state.drilled);
  const fresh = [...items].sort(bySeverity).filter((it) => {
    const k = it.natural.toLowerCase();
    if (/\.\.\.|…/.test(it.natural) || it.natural.split(/\s+/).length < 4) return false; // skip fragments
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // At most n drills per day: count what is already scheduled for tomorrow and only fill the gap.
  const drills = store.loadDrills();
  const tomorrow = localDate(Date.now() + 86400000);
  const already = drills.filter((d) => localDate(Date.parse(d.alarm_at)) === tomorrow).length;
  fresh.splice(Math.max(0, n - already));
  const times = drillTimes(already + fresh.length).slice(already);
  const made = [];
  for (let i = 0; i < fresh.length; i++) {
    const it = fresh[i];
    const text = `Say it: ${it.natural}`;
    if (dryRun) {
      say(`  [dry-run] would create Bee todo "${text}" at ${new Date(times[i]).toLocaleString()}`);
      made.push({ todo_id: null, text, natural: it.natural, alarm_at: times[i] });
      continue;
    }
    try {
      const res = await bee.todosCreate(text, times[i]);
      const d = { todo_id: res?.id ?? res?.todo?.id ?? null, text, natural: it.natural, original: it.original, pattern: it.pattern, alarm_at: times[i], created_at: new Date().toISOString() };
      drills.push(d);
      made.push(d);
      state.drilled.push(it.natural.toLowerCase());
      say(`  Bee todo ${d.todo_id ?? ''} · ${new Date(times[i]).toLocaleString()} · ${text}`);
    } catch (err) {
      warn(`could not create drill: ${err.message}`);
    }
  }
  if (!dryRun) store.saveDrills(drills);
  return made;
}

// A pattern seen twice or more becomes a Bee fact, so the user's personal AI knows what they are working on.
// When the user later gets that pattern right in real conversation, the fact is updated with the progress.
function factText(pattern, history, wins) {
  const slips = history.filter((h) => h.pattern === pattern);
  const good = wins.filter((w) => w.pattern === pattern);
  const ex = slips[slips.length - 1];
  let t = `English coach: when speaking English I often slip on ${labelFor(pattern).label.toLowerCase()} — e.g. I said "${ex.original.replace(/[.!?]+$/, '')}" instead of "${ex.corrected.replace(/[.!?]+$/, '')}".`;
  t += ` Slipped ${slips.length}×`;
  if (good.length) t += `, got it right in real conversation ${good.length}× (latest: "${good[good.length - 1].text.replace(/[.!?]+$/, '')}")`;
  // keep what the watch app recorded (see src/progress.js) when the nightly review rewrites the fact
  return withWatchProgress(t, watchPasses(store.loadDrills(), store.loadDrillsDone()).get(pattern), localDate());
}

async function rememberPatterns(state) {
  const history = store.loadHistory();
  const wins = store.loadWins();
  const facts = store.loadFacts();
  const saved = [];
  for (const [pattern, count] of store.patternCounts(history)) {
    if (count < 2) continue;
    const text = factText(pattern, history, wins);
    const existing = facts.find((f) => f.pattern === pattern && f.fact_id);
    if (existing && existing.text === text) continue;
    if (dryRun) {
      say(`  [dry-run] would ${existing ? 'update' : 'save'} Bee fact: ${text}`);
      continue;
    }
    try {
      let updated = false;
      if (existing) {
        try {
          await bee.factsUpdate(existing.fact_id, text);
          updated = true;
        } catch (err) {
          if (!/not found/i.test(err.message)) throw err;
          facts.splice(facts.indexOf(existing), 1); // deleted in the Bee app: recreate it below
        }
      }
      if (updated) {
        Object.assign(existing, { text, count, updated_at: new Date().toISOString() });
        say(`  Bee fact ${existing.fact_id} updated · ${text}`);
        saved.push(existing);
      } else {
        const res = await bee.factsCreate(text);
        const f = { fact_id: res?.id ?? res?.fact?.id ?? null, pattern, count, text, created_at: new Date().toISOString() };
        facts.push(f);
        saved.push(f);
        if (!state.factPatterns.includes(pattern)) state.factPatterns.push(pattern);
        say(`  Bee fact ${f.fact_id ?? ''} · ${text}`);
      }
    } catch (err) {
      warn(`could not save fact: ${err.message}`);
    }
  }
  if (!dryRun) store.saveFacts(facts);
  return saved;
}

async function review() {
  const state = store.loadState();
  let utterances;
  let scope;
  if (flags.conversation) {
    scope = `conversation ${flags.conversation}`;
    utterances = await bee.recentUtterances({ conversationId: flags.conversation });
  } else if (flags.since) {
    const [h, m] = String(flags.since).split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    scope = `since ${flags.since}`;
    utterances = await bee.utterancesSince(d.getTime());
  } else if (flags.minutes) {
    const minutes = numberFlag(flags, 'minutes', 120);
    scope = `the last ${minutes} min`;
    utterances = await bee.utterancesSince(Date.now() - minutes * 60000);
  } else {
    scope = 'today';
    utterances = await bee.utterancesSince(startOfToday());
  }
  const english = englishUtterances(utterances).filter((u) => flags.all || !state.reviewed.includes(u.id));
  say(`SayBetter · reviewing ${scope}: ${utterances.length} utterance(s), ${english.length} new in English${dryRun ? ' (dry-run)' : ''}`);
  let result = { items: [], praise_ko: '' };
  if (english.length) {
    result = await coach(english, { knownPatterns: knownPatterns() });
    printItems(result.items, result.praise_ko, result);
  } else {
    say('  No new English since the last review.');
  }
  const date = localDate();
  if (!dryRun && english.length) {
    store.appendHistory(result.items);
    store.appendWins(result.used_correctly || []);
    const paths = store.writeReport(date, result);
    say(`\n  Report: ${paths.mdPath}`);
    for (const u of english) state.reviewed.push(u.id);
  }
  // Drill candidates: everything coached today (live corrections included), not just this run.
  const today = store.loadHistory().filter((h) => h.date === date);
  const pool = dryRun ? [...today, ...result.items] : today;
  let drills = [];
  if (pool.length) {
    say('\n  Wrist drills for tomorrow:');
    drills = await createDrills(pool, numberFlag(flags, 'drills', 3), state);
    if (!drills.length) say('  (already scheduled)');
  }
  const facts = await rememberPatterns(state);
  if (!dryRun) store.saveState(state);
  if (asJson) console.log(JSON.stringify({ scope, utterances: utterances.length, english: english.length, ...result, drills, facts }, null, 1));
}

async function notify(title, body) {
  if (process.platform !== 'darwin' || dryRun) return;
  const esc = (s) => String(s).replace(/["\\]/g, ' ').slice(0, 180);
  try {
    await runCommand('osascript', ['-e', `display notification "${esc(body)}" with title "SayBetter" subtitle "${esc(title)}"`], { timeoutMs: 10000 });
  } catch (err) {
    warn(`notification failed: ${err.message}`);
  }
}

async function watch() {
  const state = store.loadState();
  const onFlush = async ({ utterances }) => {
    const english = englishUtterances(utterances).filter((u) => !state.reviewed.includes(u.id));
    if (!english.length) return;
    let result;
    try {
      result = await coach(english, { knownPatterns: knownPatterns() });
    } catch (err) {
      return warn(`coach failed: ${err.message}`);
    }
    for (const u of english) state.reviewed.push(u.id);
    for (const w of result.used_correctly || []) {
      log(`✓ real-life win · ${labelFor(w.pattern).label}: ${w.text}`);
      await notify('Real-life win', `You got it right: ${w.text}`);
    }
    if (!result.items.length) log('sounds natural ✓');
    for (const it of result.items) {
      log(`said  ${it.original}`);
      log(`try   ${it.natural}`);
      if (it.explanation_ko) log(`      ${it.explanation_ko}`);
      await notify(`You said: ${it.original.slice(0, 60)}`, `Try: ${it.natural}`);
    }
    if (!dryRun) {
      store.appendHistory(result.items);
      store.appendWins(result.used_correctly || []);
      if (result.items.length || (result.used_correctly || []).length) store.writeReport(localDate(), result);
      store.saveState(state);
    }
  };
  const buffer = new UtteranceBuffer({ windowMs: numberFlag(flags, 'window', 8) * 1000, maxUtterances: numberFlag(flags, 'max', 4), onFlush });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await buffer.flushAll();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  log(`SayBetter listening to ${flags.input ? flags.input : 'your Bee stream'} — speak English and get coached${dryRun ? ' (dry-run)' : ''}`);
  let backoff = 3000;
  for (;;) {
    let saw = false;
    try {
      for await (const raw of bee.rawEvents({ types: 'new-utterance', input: flags.input, onStderr: (s) => warn(`bee stream: ${s.trim()}`) })) {
        saw = true;
        const ev = bee.normalizeEvent(raw);
        if (ev.kind !== 'utterance' || state.reviewed.includes(ev.id)) continue;
        appendRawEvent(raw);
        if (englishUtterances([ev]).length) {
          log(`heard  ${ev.text}`);
          buffer.add(ev);
        }
      }
    } catch (err) {
      warn(`stream error: ${err.message}`);
    }
    if (flags.input || stopping) break;
    warn(`stream ended; reconnecting in ${backoff / 1000}s`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = saw ? 3000 : Math.min(backoff * 2, 30000);
  }
  await buffer.flushAll();
  if (!dryRun) store.saveState(state);
}

async function check() {
  const text = positional.join(' ').trim();
  if (!text) throw new Error('give a sentence, e.g. saybetter check "Yesterday I go to the meeting"');
  const result = await coach([{ id: 'check', text }], { knownPatterns: knownPatterns() });
  if (asJson) console.log(JSON.stringify(result, null, 1));
  else printItems(result.items, '');
}

function patterns() {
  const history = store.loadHistory();
  const rows = store.patternCounts(history).slice(0, 10);
  if (!rows.length) return console.log('No coached sentences yet. Run `saybetter review` first.');
  for (const [p, n] of rows) {
    const ex = [...history].reverse().find((h) => h.pattern === p);
    const { label, label_ko } = labelFor(p);
    console.log(`${String(n).padStart(3)}×  ${label}${label_ko ? ` · ${label_ko}` : ''}`);
    console.log(`      "${ex.original}" → "${ex.natural || ex.corrected}"`);
  }
}

async function serve() {
  const { startServer } = await import('../src/server.js');
  const port = numberFlag(flags, 'port', 4173);
  await startServer({ port, home: store.home() });
  const url = `http://localhost:${port}/`;
  console.log(`SayBetter UI → ${url}`);
  if (flags.open && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

// Nightly review at a fixed time with launchd, so the habit loop runs without thinking about it.
function schedule() {
  const label = 'dev.saybetter.review';
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const uid = process.getuid?.() ?? 501;
  if (flags.remove) {
    spawn('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' });
    fs.rmSync(plist, { force: true });
    return console.log(`Removed nightly review (${plist}).`);
  }
  const [h, m] = String(flags.at || '22:00').split(':').map(Number);
  const nodeBin = process.execPath;
  const envPath = `${path.dirname(nodeBin)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${path.join(os.homedir(), '.local', 'bin')}`;
  const logFile = path.join(store.home(), 'review.log');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${nodeBin}</string><string>${path.join(ROOT, 'bin', 'saybetter.js')}</string><string>review</string><string>--today</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${envPath}</string><key>SAYBETTER_HOME</key><string>${store.home()}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m || 0}</integer></dict>
  <key>StandardOutPath</key><string>${logFile}</string><key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`;
  if (dryRun) return console.log(xml);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, xml);
  spawn('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' }).on('close', () => {
    spawn('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'inherit' });
  });
  console.log(`Nightly review scheduled at ${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} → ${plist}\nLog: ${logFile}`);
}

function version() {
  console.log(`saybetter ${JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version}`);
}

const commands = { review, watch, check, patterns, serve, schedule, version };
if (!command || flags.help || !commands[command]) {
  console.log(HELP);
  process.exit(command && !commands[command] ? 1 : 0);
}
Promise.resolve()
  .then(() => commands[command]())
  .catch((err) => {
    warn(err.message);
    process.exit(1);
  });
