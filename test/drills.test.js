import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDrills, parseDrillComplete, collapseRepeats } from '../src/server.js';

const NOW = new Date(2026, 9, 23, 18, 0, 0);
const iso = (day, h) => new Date(2026, 9, day, h, 0, 0).toISOString();

test('selectDrills puts today/tomorrow alarms first, soonest first, and marks done', () => {
  const drills = [
    { todo_id: 1, natural: 'Old one.', alarm_at: iso(20, 9) },
    { todo_id: 2, natural: 'Tomorrow evening.', original: 'x', alarm_at: iso(24, 19) },
    { todo_id: 3, natural: 'Tomorrow morning.', alarm_at: iso(24, 9) },
    { todo_id: 4, natural: '' },            // no sentence -> dropped
    { natural: 'no id' },                   // no id -> dropped
    { todo_id: 5, natural: 'Older still.', alarm_at: iso(19, 9) },
  ];
  const out = selectDrills(drills, { 3: { score: 92 } }, NOW);
  assert.deepEqual(out.map((d) => d.todo_id), [3, 2, 1, 5]);
  assert.equal(out[0].done, true);
  assert.equal(out[0].score, 92);
  assert.equal(out[1].done, false);
  assert.equal(out[1].original, 'x');
});

test('parseDrillComplete validates id and clamps score', () => {
  assert.deepEqual(parseDrillComplete({ todo_id: '29266802', score: 87.6, heard: 'hi' }), { todo_id: 29266802, score: 88, heard: 'hi', words: [] });
  assert.equal(parseDrillComplete({ todo_id: 'abc; rm -rf' }).error, 'todo_id must be numeric');
  assert.equal(parseDrillComplete(null).error, 'invalid body');
  assert.equal(parseDrillComplete({ todo_id: 7, score: 140 }).score, 100);
});

test('collapseRepeats drops stutters but keeps the mistakes', () => {
  assert.equal(collapseRepeats('Can can you explain me how this API work?'), 'Can you explain me how this API work?');
  assert.equal(collapseRepeats('I I I go to to the office'), 'I go to the office');
  assert.equal(collapseRepeats('that that is fine, is it'), 'that is fine, is it');
});
