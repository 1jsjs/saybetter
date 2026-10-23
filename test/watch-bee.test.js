import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHandler } from '../src/server.js';
import { drillsFromBeeTodos, watchPasses, withWatchProgress, watchFactText } from '../src/progress.js';

const NOW = new Date(2026, 9, 23, 18, 0, 0).getTime();

test('drillsFromBeeTodos keeps only "Say it" todos, merges local details, drops old completed ones', () => {
  const todos = [
    { id: 11, text: 'Say it: Can you explain how this API works?', alarm_at: NOW + 3600e3, completed: false, created_at: NOW - 1e3 },
    { id: 12, text: 'Email Professor Kim', completed: false },
    { id: 13, text: 'say it:  I agree with you.', completed: true, created_at: NOW - 3600e3 },
    { id: 14, text: 'Say it: Old one.', completed: true, created_at: NOW - 9 * 86400e3 },
  ];
  const local = [{ todo_id: 11, original: 'Can you explain me how this API work?', pattern: 'verb_pattern' }];
  const out = drillsFromBeeTodos(todos, local, { now: NOW });
  assert.deepEqual(out.map((d) => d.todo_id), [11, 13]);
  assert.equal(out[0].natural, 'Can you explain how this API works?');
  assert.equal(out[0].pattern, 'verb_pattern');
  assert.equal(out[0].alarm_at, new Date(NOW + 3600e3).toISOString());
  assert.equal(out[1].natural, 'I agree with you.');
  assert.equal(out[1].completed, true);
});

test('watch progress is counted per pattern and written into the fact text', () => {
  const drills = [{ todo_id: 1, pattern: 'p' }, { todo_id: 2, pattern: 'p' }, { todo_id: 3, pattern: 'q' }];
  const passes = watchPasses(drills, { 1: { ts: 1, score: 85 }, 2: { ts: 2, score: 93 }, 9: { ts: 3, score: 99 } });
  assert.deepEqual(passes.get('p'), { count: 2, score: 93, ts: 2 });
  assert.equal(passes.has('q'), false);

  const base = 'English coach: I often slip on x. Slipped 2×, got it right in real conversation 1× as of 2026-10-22.';
  const once = withWatchProgress(base, { count: 1, score: 85 }, '2026-10-23');
  assert.equal(once, 'English coach: I often slip on x. Slipped 2×, got it right in real conversation 1×, practised out loud on my Apple Watch 1× (latest pronunciation score 85) as of 2026-10-23.');
  const twice = withWatchProgress(once, { count: 2, score: 93 }, '2026-10-24');
  assert.match(twice, /Apple Watch 2× \(latest pronunciation score 93\) as of 2026-10-24\.$/);
  assert.equal((twice.match(/Apple Watch/g) || []).length, 1);
  assert.match(watchFactText('missing_article', 'That\'s a good point.', { count: 1, score: 90 }, '2026-10-23'), /^English coach: I'm practising .+ out loud — e\.g\. "That's a good point", practised out loud on my Apple Watch 1×/);
});

function serve(home, bee) {
  const server = http.createServer(createHandler(home, { bee, cacheMs: 0 }));
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

test('watch API reads drills from Bee todos and, on a pass, completes the todo and updates the Bee fact', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-watch-'));
  fs.writeFileSync(path.join(home, 'drills.json'), JSON.stringify([{ todo_id: 21, natural: 'Last week we met them.', original: 'Last week we meet them.', pattern: 'past_tense_with_past_time' }]));
  fs.writeFileSync(path.join(home, 'facts.json'), JSON.stringify([{ fact_id: 77, pattern: 'past_tense_with_past_time', text: 'English coach: slip on past tense. Slipped 2× as of 2026-10-22.' }]));
  const calls = [];
  const todos = [{ id: 21, text: 'Say it: Last week we met them.', completed: false }, { id: 22, text: 'Buy milk', completed: false }];
  const bee = {
    todosList: async () => ({ todos }),
    todosComplete: async (id) => { calls.push(['complete', id]); todos[0].completed = true; return { id }; },
    factsUpdate: async (id, text) => { calls.push(['fact', id, text]); return {}; },
    factsCreate: async () => { throw new Error('should update, not create'); },
  };
  const { server, base } = await serve(home, bee);
  try {
    const list = await (await fetch(`${base}/api/drills`)).json();
    assert.equal(list.source, 'bee');
    assert.deepEqual(list.items.map((d) => [d.todo_id, d.natural, d.done]), [[21, 'Last week we met them.', false]]);

    const res = await (await fetch(`${base}/api/drills/complete`, { method: 'POST', body: JSON.stringify({ todo_id: 21, score: 91, heard: 'last week we met them' }) })).json();
    assert.equal(res.ok, true);
    assert.deepEqual(calls[0], ['complete', 21]);
    assert.equal(calls[1][0], 'fact');
    assert.equal(calls[1][1], 77);
    assert.match(calls[1][2], /Slipped 2×, practised out loud on my Apple Watch 1× \(latest pronunciation score 91\) as of \d{4}-\d{2}-\d{2}\.$/);
    assert.equal(res.fact.watch_passes, 1);

    const after = await (await fetch(`${base}/api/drills`)).json();
    assert.equal(after.items[0].done, true);
  } finally {
    server.close();
  }
});

test('watch API falls back to the local drill list when Bee is unreachable', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-watch-'));
  fs.writeFileSync(path.join(home, 'drills.json'), JSON.stringify([{ todo_id: 5, natural: 'Offline drill.' }]));
  const bee = { todosList: async () => { throw new Error('bee: not logged in'); } };
  const { server, base } = await serve(home, bee);
  try {
    const list = await (await fetch(`${base}/api/drills`)).json();
    assert.equal(list.source, 'local');
    assert.deepEqual(list.items.map((d) => d.todo_id), [5]);
  } finally {
    server.close();
  }
});
