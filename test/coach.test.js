import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnglish, englishSpans, englishUtterances } from '../src/english.js';
import { coach, fakeCoach, normalizeCoaching, buildPrompt, bySeverity } from '../src/coach.js';
import { drillTimes, localDate, startOfToday } from '../src/schedule.js';
import { extractJson } from '../src/llm.js';
import { normalizeEvent } from '../src/bee.js';

test('isEnglish accepts real English and rejects Korean, fragments and noise', () => {
  assert.equal(isEnglish('Can you explain me how this API work?'), true);
  assert.equal(isEnglish('오늘 회의 몇 시였지?'), false);
  assert.equal(isEnglish('okay yes'), false);
  assert.equal(isEnglish('12:30 / 45 -- ok'), false);
});

test('englishSpans pulls English out of code-switched speech', () => {
  assert.deepEqual(englishSpans('아 그거 I think we should ship it tomorrow 그렇게 하자'), ['I think we should ship it tomorrow']);
  assert.deepEqual(englishSpans('그냥 ok 해'), []);
});

test('englishUtterances keeps ids and splits multiple spans', () => {
  const out = englishUtterances([{ id: '1', text: 'I want to go home now 근데 we need to finish this bug first', ts: 1, conversationId: 'c' }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((u) => u.id), ['1#0', '1#1']);
});

test('fake coach fixes past tense, did + base verb, be + agree, explain to, -s and article', async () => {
  const u = [
    { id: 'a', text: "Yesterday I go to the client meeting and I didn't said anything." },
    { id: 'b', text: 'I am agree with your idea, it is very good point.' },
    { id: 'c', text: 'Can you explain me how this API work?' },
    { id: 'd', text: 'That makes a lot of sense to me.' },
  ];
  const r = await coach(u, { llm: fakeCoach });
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].corrected, "Yesterday I went to the client meeting and I didn't say anything.");
  assert.equal(r.items[1].corrected, 'I agree with your idea, it is a very good point.');
  assert.equal(r.items[2].corrected, 'Can you explain to me how this API works?');
  assert.ok(r.items.every((i) => i.explanation_ko.length > 0));
});

test('normalizeCoaching drops no-op and broken items and fills defaults', () => {
  const r = normalizeCoaching({ items: [{ original: 'I go', corrected: 'I go.' }, { original: 'x' }, { utterance_id: 'q', original: 'He go', corrected: 'He goes', severity: 'weird', pattern: 'Subject Verb!' }], praise_ko: '좋아요' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].severity, 'medium');
  assert.equal(r.items[0].pattern, 'subject_verb');
  assert.equal(r.items[0].natural, 'He goes');
  assert.equal(r.praise_ko, '좋아요');
});

test('prompt carries ids and known patterns', () => {
  const p = buildPrompt([{ id: '42', text: 'I go home' }], ['missing_article']);
  assert.match(p, /\[42\] I go home/);
  assert.match(p, /missing_article/);
});

test('coach accepts fenced JSON from an LLM', async () => {
  const llm = async () => 'Sure!\n```json\n{"items":[{"utterance_id":"1","original":"I am agree","corrected":"I agree","natural":"I agree","pattern":"be_verb_misuse","severity":"high"}]}\n```';
  const r = await coach([{ id: '1', text: 'I am agree' }], { llm });
  assert.equal(r.items[0].pattern, 'be_verb_misuse');
  assert.ok(extractJson('noise {"a":1} noise'));
});

test('drills ring tomorrow at 09, 13, 19, 21 and then roll to the day after', () => {
  const now = new Date(2026, 9, 23, 22, 30);
  const t = drillTimes(5, now).map((s) => new Date(s));
  assert.deepEqual(t.map((d) => [d.getDate(), d.getHours()]), [[24, 9], [24, 13], [24, 19], [24, 21], [25, 9]]);
});

test('local date and start of day', () => {
  const now = new Date(2026, 9, 23, 0, 5);
  assert.equal(localDate(now.getTime()), '2026-10-23');
  assert.equal(startOfToday(now), new Date(2026, 9, 23).getTime());
});

test('severity sorts high first', () => {
  assert.deepEqual([{ severity: 'low' }, { severity: 'high' }, { severity: 'medium' }].sort(bySeverity).map((x) => x.severity), ['high', 'medium', 'low']);
});

test('real Bee stream envelope is parsed', () => {
  const e = normalizeEvent({ type: 'new-utterance', conversation_uuid: 'u-1', utterance: { id: 7, text: 'Can you explain me how this API work?', spoken_at: '2026-10-23T07:00:16.000Z' } });
  assert.equal(e.kind, 'utterance');
  assert.equal(e.conversationId, 'u-1');
});

test('coach returns takeaway and real-life wins for known patterns (offline coach)', async () => {
  const u = [
    { id: 'w1', text: 'Last week we met the new team and they told us about the plan.' },
    { id: 'w2', text: 'Yesterday I go to the gym after work.' },
  ];
  const r = await coach(u, { llm: fakeCoach, knownPatterns: ['past_tense_with_past_time'] });
  assert.equal(r.items.length, 1);
  assert.equal(r.used_correctly.length, 1);
  assert.equal(r.used_correctly[0].utterance_id, 'w1');
  assert.ok(r.takeaway_ko.length > 0);
  assert.equal(r.takeaway_pattern, 'past_tense_with_past_time');
});

test('tutor items keep the mixed original and are not dropped as no-ops', () => {
  const r = normalizeCoaching({ items: [{ kind: 'tutor', original: '그거 뭐지, the thing we deploy', corrected: 'the thing we deploy', natural: "What's the thing we deploy?", pattern: 'vocabulary_gap' }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'tutor');
});
