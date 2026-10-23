import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-'));
process.env.SAYBETTER_HOME = dir;
const store = await import('../src/store.js');

test('history, pattern counts and reports round-trip through files the UI reads', () => {
  store.appendHistory([
    { utterance_id: '1', pattern: 'missing_article', original: 'it is good point', corrected: 'it is a good point', natural: 'that is a good point', explanation_ko: '관사', severity: 'medium' },
    { utterance_id: '2', pattern: 'missing_article', original: 'I have idea', corrected: 'I have an idea', natural: 'I have an idea', explanation_ko: '관사', severity: 'medium' },
    { utterance_id: '3', pattern: 'be_verb_misuse', original: 'I am agree', corrected: 'I agree', natural: 'I agree', explanation_ko: 'be', severity: 'high' },
  ], new Date(2026, 9, 23, 10).getTime());
  const h = store.loadHistory();
  assert.equal(h.length, 3);
  assert.equal(h[0].date, '2026-10-23');
  assert.deepEqual(store.patternCounts(h)[0], ['missing_article', 2]);
  const { jsonPath, mdPath } = store.writeReport('2026-10-23', { items: h, praise_ko: '좋아요' });
  assert.equal(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).items.length, 3);
  assert.match(fs.readFileSync(mdPath, 'utf8'), /I am agree/);
});

test('state, drills and facts persist', () => {
  const s = store.loadState();
  s.reviewed.push('x');
  store.saveState(s);
  assert.deepEqual(store.loadState().reviewed, ['x']);
  store.saveDrills([{ todo_id: 1, text: 'Say it: I agree', alarm_at: '2026-10-24T00:00:00.000Z' }]);
  store.saveFacts([{ fact_id: 2, pattern: 'missing_article' }]);
  assert.equal(store.loadDrills().length, 1);
  assert.equal(store.loadFacts()[0].pattern, 'missing_article');
});
