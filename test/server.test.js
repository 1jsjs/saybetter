import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSummary, itemsForDate, loadHistory, localDate, practiceStats, appendPractice, startServer, loadPractice,
  leitnerState, reviewQueue, loadWins, aggregatePatterns, deriveTakeaway,
  loadPronunciation, pronunciationStats,
} from '../src/server.js';
import { labelFor } from '../src/patterns.js';

function tmpHome(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const NOW = new Date(2026, 9, 23, 18, 0, 0); // Oct 23 2026, local
const TODAY = localDate(NOW);
const at = (dayOffset, h) => new Date(2026, 9, 23 + dayOffset, h, 0, 0).getTime();

const historyLines = [
  { ts: at(0, 9), utterance_id: 'u1', pattern: 'past_tense_with_past_time', original: 'Yesterday I go there.', corrected: 'Yesterday I went there.', natural: 'Yesterday I went there.', explanation_ko: '과거형', severity: 'high' },
  { ts: at(0, 11), utterance_id: 'u2', pattern: 'be_verb_with_verb', original: 'I am agree.', corrected: 'I agree.', severity: 'high' },
  'this is not json',
  '',
  { ts: at(-1, 10), utterance_id: 'u3', pattern: 'past_tense_with_past_time', original: 'Last week I finish it.', corrected: 'Last week I finished it.', natural: 'I finished it last week.', severity: 'medium' },
  { date: '2026-10-20', utterance_id: 'u4', pattern: 'weird_custom_thing', original: 'Discuss about it.', corrected: 'Discuss it.', severity: 'bogus' },
  { ts: at(-2, 10), pattern: 'missing_article' }, // no original -> dropped
].map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');

test('summary aggregates today, days and patterns; skips bad lines', () => {
  const home = tmpHome({ 'history.jsonl': historyLines, 'reports/2026-10-23.json': { praise_ko: '잘했어요' } });
  const s = buildSummary(home, NOW);
  assert.equal(s.today.date, TODAY);
  assert.deepEqual(s.today.items.map((i) => i.utterance_id), ['u1', 'u2']);
  assert.equal(s.total_items, 4);
  assert.equal(s.praise_ko, '잘했어요');
  // natural falls back to corrected
  assert.equal(s.today.items[1].natural, 'I agree.');
  // days: last 7 days zero-filled, ascending
  const last7 = s.days.slice(-7);
  assert.equal(last7.length, 7);
  assert.equal(last7[6].date, TODAY);
  assert.equal(last7[6].count, 2);
  assert.equal(s.days.find((d) => d.date === '2026-10-20').count, 1);
  // patterns sorted by count, with the latest example
  assert.equal(s.patterns[0].pattern, 'past_tense_with_past_time');
  assert.equal(s.patterns[0].count, 2);
  assert.equal(s.patterns[0].label, 'Past tense with past-time words');
  assert.equal(s.patterns[0].last.original, 'Yesterday I go there.');
  // unknown severity normalised, unknown pattern title-cased
  const weird = loadHistory(home).find((i) => i.utterance_id === 'u4');
  assert.equal(weird.severity, 'medium');
  assert.equal(weird.pattern_label, 'Weird custom thing');
});

test('missing files yield empty arrays', () => {
  const home = tmpHome();
  const s = buildSummary(home, NOW);
  assert.deepEqual(s.today.items, []);
  assert.deepEqual(s.patterns, []);
  assert.deepEqual(s.drills, []);
  assert.deepEqual(s.facts, []);
  assert.equal(s.praise_ko, '');
  assert.equal(s.latest_date, null);
  assert.deepEqual(s.practice, { today_ok: 0, today_total: 0, streak_days: 0 });
  assert.equal(s.days.length, 7);
});

test('drills sorted by alarm and facts labelled; corrupt json tolerated', () => {
  const home = tmpHome({
    'drills.json': [
      { todo_id: 2, text: 'Say it: B', natural: 'B', alarm_at: '2026-10-24T13:00:00+09:00' },
      { todo_id: 1, text: 'Say it: A', natural: 'A', alarm_at: '2026-10-24T09:00:00+09:00' },
    ],
    'facts.json': '{ broken',
  });
  const s = buildSummary(home, NOW);
  assert.deepEqual(s.drills.map((d) => d.todo_id), [1, 2]);
  assert.deepEqual(s.facts, []);
  fs.writeFileSync(path.join(home, 'facts.json'), JSON.stringify([{ fact_id: 'f', pattern: 'missing_article', text: 'x' }]));
  assert.equal(buildSummary(home, NOW).facts[0].label, 'Missing article (a / the)');
});

test('itemsForDate filters by local date and sorts by time', () => {
  const home = tmpHome({ 'history.jsonl': historyLines });
  const items = itemsForDate(loadHistory(home), addDaysStr(TODAY, -1));
  assert.deepEqual(items.map((i) => i.utterance_id), ['u3']);
});

test('practice streak counts consecutive days with a pass', () => {
  const day = (n) => addDaysStr(TODAY, n);
  const practice = [
    { date: day(0), ok: false }, { date: day(-1), ok: true }, { date: day(-2), ok: true }, { date: day(-4), ok: true },
  ];
  assert.deepEqual(practiceStats(practice, TODAY), { today_ok: 0, today_total: 1, streak_days: 2 });
  practice.push({ date: day(0), ok: true });
  assert.equal(practiceStats(practice, TODAY).streak_days, 3);
  assert.equal(practiceStats(practice, TODAY).today_ok, 1);
});

test('appendPractice writes jsonl that loadPractice reads back', () => {
  const home = tmpHome();
  appendPractice(home, { utterance_id: 'u1', said: 'I agree', ok: true }, NOW);
  appendPractice(home, { utterance_id: 'u1', said: 'I am agree', ok: 'yes' }, NOW);
  const rows = loadPractice(home);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].ok, false); // only literal true counts
  assert.equal(buildSummary(home, NOW).practice.today_ok, 1);
});

test('labelFor falls back to title case', () => {
  assert.equal(labelFor('past_tense_with_past_time').label_ko, '과거 시간 표현 + 과거형');
  assert.equal(labelFor('some_new_pattern').label, 'Some new pattern');
  assert.equal(labelFor(undefined).label, 'Other');
});

test('HTTP endpoints respond', async () => {
  const home = tmpHome({ 'history.jsonl': historyLines });
  const srv = await startServer({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const sum = await (await fetch(`${base}/api/summary`)).json();
    assert.ok(Array.isArray(sum.patterns));
    const items = await (await fetch(`${base}/api/items?date=2026-10-20`)).json();
    assert.equal(items.items.length, 1);
    assert.equal((await fetch(`${base}/api/items?date=nope`)).status, 400);
    const post = await fetch(`${base}/api/practice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ utterance_id: 'u1', said: 'x', ok: true, hint: 1 }) });
    assert.equal(post.status, 200);
    assert.equal((await post.json()).practice.today_total, 1);
    assert.equal((await fetch(`${base}/api/practice`, { method: 'POST', body: '{bad' })).status, 400);
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /SayBetter/);
    assert.equal((await fetch(`${base}/..%2fsrc%2fserver.js`)).status === 200, false);
  } finally {
    await srv.close();
  }
});

test('leitner: pass without reveal climbs boxes, fail or reveal resets to box 1', () => {
  const r = (date, ok, hint = 0, ts = 0) => ({ utterance_id: 'a', date, ok, hint, ts });
  let st = leitnerState([r('2026-10-01', true, 0, 1), r('2026-10-02', true, 1, 2), r('2026-10-05', true, 0, 3)]);
  assert.equal(st.a.box, 4);
  st = leitnerState([r('2026-10-01', true, 0, 1), r('2026-10-02', true, 0, 2), r('2026-10-03', false, 0, 3)]);
  assert.equal(st.a.box, 1);
  st = leitnerState([r('2026-10-01', true, 0, 1), r('2026-10-02', true, 2, 2)]); // revealed then said it
  assert.equal(st.a.box, 1);
  st = leitnerState([1, 2, 3, 4, 5, 6].map((i) => r(`2026-10-0${i}`, true, 0, i)));
  assert.equal(st.a.box, 4, 'capped at box 4');
});

test('review queue: intervals 1/3/7/14 days, today excluded, untouched old items due', () => {
  const hist = [
    { id: 'old', utterance_id: 'old', date: addDaysStr(TODAY, -5), ts: 1 },      // never practised -> due
    { id: 'b2', utterance_id: 'b2', date: addDaysStr(TODAY, -5), ts: 2 },        // box 2, last 2 days ago -> due in 3 -> not yet
    { id: 'b2due', utterance_id: 'b2due', date: addDaysStr(TODAY, -6), ts: 3 },  // box 2, last 3 days ago -> due today
    { id: 'b4', utterance_id: 'b4', date: addDaysStr(TODAY, -20), ts: 4 },       // box 4, last 13 days ago -> not yet
    { id: 'new', utterance_id: 'new', date: TODAY, ts: 5 },                      // today's item -> not in review
  ];
  const pass = (id, daysAgo, ts) => ({ utterance_id: id, date: addDaysStr(TODAY, daysAgo), ok: true, hint: 0, ts });
  const practice = [
    pass('b2', -2, 10), pass('b2due', -3, 11),
    pass('b4', -18, 12), pass('b4', -16, 13), pass('b4', -13, 14),
  ];
  const q = reviewQueue(hist, practice, TODAY);
  assert.deepEqual(q.due.map((d) => d.id).sort(), ['b2due', 'old']);
  assert.equal(q.due_total, 2);
  assert.deepEqual(q.counts, { box1: 2, box2: 2, box3: 0, box4: 1 });
  assert.ok(q.due.every((d) => d.review === true));
});

test('wins aggregate per pattern with week counts; summary tolerates missing new files', () => {
  const home = tmpHome({
    'history.jsonl': historyLines,
    'wins.jsonl': [
      { ts: at(0, 15), pattern: 'past_tense_with_past_time', text: 'Yesterday I went home.', utterance_id: 'w1' },
      { date: addDaysStr(TODAY, -3), pattern: 'missing_article', text: 'I booked a room.' },
      { date: addDaysStr(TODAY, -30), pattern: 'past_tense_with_past_time', text: 'I finished it.' },
      'nope',
      { date: TODAY, pattern: 'x' }, // no text -> dropped
    ].map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n'),
  });
  assert.equal(loadWins(home).length, 3);
  const s = buildSummary(home, NOW);
  assert.equal(s.wins_total, 3);
  assert.equal(s.wins_week, 2);
  const past = s.patterns.find((p) => p.pattern === 'past_tense_with_past_time');
  assert.equal(past.count, 2);
  assert.equal(past.wins, 2);
  const art = s.patterns.find((p) => p.pattern === 'missing_article');
  assert.equal(art.count, 0, 'pattern known only from wins still listed');
  assert.equal(art.wins, 1);
  assert.equal(s.wins.length, 1);

  const bare = buildSummary(tmpHome({ 'history.jsonl': historyLines }), NOW);
  assert.equal(bare.wins_total, 0);
  assert.equal(bare.patterns[0].wins, 0);
  assert.deepEqual(bare.used_correctly, []);
  assert.ok(bare.review && Array.isArray(bare.review.due));
});

test('takeaway comes from the report, else from the most frequent + severe pattern', () => {
  const home = tmpHome({
    'history.jsonl': historyLines,
    'reports/2026-10-23.json': { takeaway_ko: '과거형!', takeaway_pattern: 'be_verb_with_verb', used_correctly: [{ utterance_id: 'z', pattern: 'missing_article', text: 'A cat.' }, { bad: 1 }] },
  });
  const s = buildSummary(home, NOW);
  assert.equal(s.takeaway.text_ko, '과거형!');
  assert.equal(s.takeaway.pattern, 'be_verb_with_verb');
  assert.equal(s.takeaway.derived, false);
  assert.equal(s.used_correctly.length, 1);
  const items = [
    { pattern: 'a', severity: 'low' }, { pattern: 'a', severity: 'low' },
    { pattern: 'b', severity: 'high', original: 'x', natural: 'y' }, { pattern: 'b', severity: 'medium', original: 'x2', natural: 'y2' },
  ];
  const t = deriveTakeaway(items, null);
  assert.equal(t.pattern, 'b');
  assert.equal(t.derived, true);
  assert.equal(t.example.natural, 'y2');
  assert.equal(deriveTakeaway([], null), null);
});

test('tutor kind is preserved, default is fix', () => {
  const home = tmpHome({ 'history.jsonl': [
    { ts: at(0, 9), kind: 'tutor', pattern: 'korean_switch', original: 'We need to 미루다 it.', natural: 'We need to push it back.' },
    { ts: at(0, 10), pattern: 'x', original: 'a', corrected: 'b' },
  ].map((x) => JSON.stringify(x)).join('\n') });
  const [t, f] = loadHistory(home);
  assert.equal(t.kind, 'tutor');
  assert.equal(t.corrected, 'We need to push it back.');
  assert.equal(f.kind, 'fix');
});

test('pronunciation: today count/avg and most-missed sounds with latest tip', () => {
  const rec = (ts, score, words, tips = [], date) => JSON.stringify({ ts, ...(date ? { date } : {}), target: 'x y', score, words, tips });
  const home = tmpHome({ 'pronunciation.jsonl': [
    rec(at(-1, 9), 50, [{ word: 'works?', status: 'missed', heard: 'walks' }, { word: 'to', status: 'weak' }], [{ word: 'works?', tip_ko: 'old tip' }]),
    rec(at(0, 9), 80, [{ word: 'Works', status: 'weak' }, { word: 'me', status: 'ok' }], [{ word: 'Works', tip_ko: 'new tip' }]),
    rec(at(0, 10), 70, [{ word: 'to', status: 'missed', heard: null }]),
    'garbage',
    JSON.stringify({ ts: at(0, 11), target: '', score: 10, words: [] }), // no target -> dropped
  ].join('\n') });
  const recs = loadPronunciation(home);
  assert.equal(recs.length, 3);
  const st = pronunciationStats(recs, TODAY);
  assert.equal(st.total, 3);
  assert.equal(st.today_count, 2);
  assert.equal(st.today_avg, 75);
  assert.deepEqual(st.sounds.map((x) => [x.word, x.times]), [['to', 2], ['works', 2]], 'ties broken by most recent');
  const works = st.sounds.find((x) => x.word === 'works');
  assert.equal(works.missed, 1);
  assert.equal(works.weak, 1);
  assert.equal(works.tip_ko, 'new tip');
  assert.equal(works.heard_as, 'walks');
  assert.equal(st.recent.length, 3);
  const empty = buildSummary(tmpHome(), NOW).pronunciation;
  assert.deepEqual([empty.total, empty.today_count, empty.today_avg, empty.sounds.length], [0, 0, null, 0]);
});

function addDaysStr(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}
