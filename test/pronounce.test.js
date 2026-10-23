import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensToWords, alignWords, splitWords, tipsFor } from '../src/pronounce.js';

const tok = (text, p) => ({ text, p, offsets: { from: 0, to: 0 } });

test('tokensToWords merges sub-word tokens, drops specials and punctuation, keeps the weakest probability', () => {
  const w = tokensToWords([tok('[_BEG_]', 0.9), tok(' Can', 0.95), tok(' ex', 0.9), tok('plain', 0.6), tok('?', 0.9)]);
  assert.deepEqual(w.map((x) => [x.norm, x.p]), [['can', 0.95], ['explain', 0.6]]);
});

test('alignWords marks ok, weak (low confidence or near miss) and missed words', () => {
  const heard = tokensToWords([tok(' Can', 0.95), tok(' you', 0.95), tok(' explain', 0.96), tok(' me', 0.57), tok(' how', 0.98), tok(' this', 0.98), tok(' API', 0.9), tok(' walks', 0.9)]);
  const r = alignWords('Can you explain to me how this API works?', heard);
  const st = Object.fromEntries(r.words.map((w) => [w.word.toLowerCase(), w.status]));
  assert.equal(st.can, 'ok');
  assert.equal(st.to, 'missed');
  assert.equal(st.me, 'weak');
  assert.equal(st.works, 'missed'); // heard as a different word → red
  assert.equal(r.words.find((w) => w.word === 'works').heard, 'walks');
  assert.ok(r.score > 50 && r.score < 100);
});

test('contractions align with their expansions', () => {
  assert.deepEqual(splitWords("It's a good point.").map((w) => w.norm), ['it', 'is', 'a', 'good', 'point']);
  const heard = tokensToWords([tok(' It', 0.9), tok(' is', 0.9), tok(' a', 0.9), tok(' good', 0.9), tok(' point', 0.9)]);
  assert.equal(alignWords("It's a good point.", heard).score, 100);
});

test('tips are Korean, per problem word, and prefer ending sounds', () => {
  const tips = tipsFor([{ word: 'works', status: 'weak', heard: 'work' }, { word: 'good', status: 'ok' }]);
  assert.equal(tips.length, 1);
  assert.match(tips[0].tip_ko, /-s/);
});
