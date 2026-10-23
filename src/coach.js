// The English coach: prompt, response normalisation, and a deterministic offline backend.
import { extractJson, pickBackend } from './llm.js';

const SEVERITIES = new Set(['high', 'medium', 'low']);

export function buildPrompt(utterances, knownPatterns = [], { maxItems = 8 } = {}) {
  const lines = utterances.map((u) => `[${u.id}] ${u.text}`).join('\n');
  const known = knownPatterns.length ? knownPatterns.join(', ') : '(none yet)';
  return `You are SayBetter, a warm but precise English speaking coach.
The learner is a native Korean speaker. Below are sentences they actually SAID today, captured by a wearable
(Bee on an Apple Watch) and transcribed by speech recognition (ASR).

Rules:
- Ignore spelling, capitalisation and punctuation: those are ASR artefacts.
- If a sentence looks garbled by ASR (words that make no sense together, cut-off fragments), do not correct it.
- Coach only what matters when speaking: grammar, word choice, prepositions, articles, collocations, and phrasing
  a native speaker would not use. Skip sentences that are already natural. Proper nouns and jargon are not errors.
- At most ${maxItems} items, most important first. Prefer one clear fix over many small ones.
- Correct with the smallest change first ("corrected"), then give what a native speaker would actually say ("natural").
- If the learner switched to Korean in the middle of an English sentence (they did not know how to say it),
  return kind "tutor": "natural" is how to say the whole thing in English, "explanation_ko" teaches the missing expression.
- The learner's known weak patterns: ${known}. Reuse those pattern names when they apply. If the learner said a
  sentence that uses one of those patterns CORRECTLY, list it in "used_correctly" (this is real-life progress).
- "takeaway_ko": the ONE thing to focus on tomorrow, in Korean, one sentence; "takeaway_pattern": its pattern name.

Sentences:
${lines}

Respond with ONLY JSON, no prose:
{"items":[{"utterance_id":"<id in brackets>","kind":"fix|tutor","original":"<as said>","corrected":"<minimal fix>","natural":"<what a native speaker would say>","explanation_ko":"<1-2 short Korean sentences>","pattern":"<snake_case e.g. past_tense_with_past_time, missing_article, preposition_choice, word_choice, subject_verb_agreement, be_verb_misuse, verb_pattern, unnatural_phrasing>","severity":"high|medium|low"}],
 "used_correctly":[{"utterance_id":"<id>","pattern":"<known pattern>","text":"<the correct sentence as said>"}],
 "praise_ko":"<one encouraging Korean sentence>","takeaway_ko":"<one Korean sentence>","takeaway_pattern":"<pattern>"}
If nothing needs fixing, "items" is [].`;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function normalizeCoaching(obj, utterances = []) {
  const byId = new Map(utterances.map((u) => [String(u.id), u]));
  const list = Array.isArray(obj?.items) ? obj.items : Array.isArray(obj) ? obj : [];
  const items = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const original = String(it.original ?? byId.get(String(it.utterance_id))?.text ?? '').trim();
    const corrected = String(it.corrected ?? '').trim();
    const natural = String(it.natural ?? corrected).trim();
    if (!original || !corrected || (it.kind !== 'tutor' && norm(original) === norm(corrected))) continue;
    const pattern = String(it.pattern || 'unnatural_phrasing').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unnatural_phrasing';
    items.push({
      kind: it.kind === 'tutor' ? 'tutor' : 'fix',
      utterance_id: String(it.utterance_id ?? ''),
      original,
      corrected,
      natural: natural || corrected,
      explanation_ko: String(it.explanation_ko ?? '').trim(),
      pattern,
      severity: SEVERITIES.has(it.severity) ? it.severity : 'medium',
    });
  }
  const used = (Array.isArray(obj?.used_correctly) ? obj.used_correctly : [])
    .filter((u) => u && u.pattern && (u.text || byId.get(String(u.utterance_id))))
    .map((u) => ({ utterance_id: String(u.utterance_id ?? ''), pattern: String(u.pattern).toLowerCase().replace(/[^a-z0-9]+/g, '_'), text: String(u.text ?? byId.get(String(u.utterance_id))?.text ?? '').trim() }));
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return { items, used_correctly: used, praise_ko: str(obj?.praise_ko), takeaway_ko: str(obj?.takeaway_ko), takeaway_pattern: str(obj?.takeaway_pattern) || items[0]?.pattern || '' };
}

// ---- deterministic offline coach (tests, dry runs, demos without an LLM) ----
const PAST = { go: 'went', eat: 'ate', see: 'saw', have: 'had', meet: 'met', tell: 'told', say: 'said', make: 'made', buy: 'bought', come: 'came', take: 'took', get: 'got', write: 'wrote', send: 'sent' };
const RULES = [
  {
    pattern: 'past_tense_with_past_time',
    severity: 'high',
    ko: '“yesterday·last night·ago”처럼 과거를 말할 때는 동사도 과거형으로 써요.',
    test: (s) => /\b(yesterday|last (night|week|month|year)|\d+ (days?|weeks?) ago)\b/i.test(s) && new RegExp(`\\b(I|we|he|she|they) (${Object.keys(PAST).join('|')})\\b`, 'i').test(s),
    fix: (s) => s.replace(new RegExp(`\\b(I|we|he|she|they) (${Object.keys(PAST).join('|')})\\b`, 'gi'), (m, p, v) => `${p} ${PAST[v.toLowerCase()]}`),
  },
  {
    pattern: 'verb_pattern',
    severity: 'high',
    ko: 'didn’t 뒤에는 동사 원형이 와요: didn’t say.',
    test: (s) => /\bdid(n't|n’t| not) (said|went|told|made|saw|ate)\b/i.test(s),
    fix: (s) => s.replace(/\bdid(n't|n’t| not) (said|went|told|made|saw|ate)\b/gi, (m, n, v) => `did${n} ${({ said: 'say', went: 'go', told: 'tell', made: 'make', saw: 'see', ate: 'eat' })[v.toLowerCase()]}`),
  },
  {
    pattern: 'be_verb_misuse',
    severity: 'high',
    ko: 'agree는 일반동사라 be동사가 필요 없어요: I agree.',
    test: (s) => /\b(I am|I'm) agree\b/i.test(s),
    fix: (s) => s.replace(/\b(I am|I'm) agree\b/gi, 'I agree'),
  },
  {
    pattern: 'preposition_choice',
    severity: 'medium',
    ko: 'explain은 사람을 바로 목적어로 받지 않아요: explain (it) to me.',
    test: (s) => /\bexplain me\b/i.test(s),
    fix: (s) => s.replace(/\bexplain me\b/gi, 'explain to me'),
  },
  {
    pattern: 'subject_verb_agreement',
    severity: 'medium',
    ko: '주어가 3인칭 단수(this API)면 동사에 -s를 붙여요: works.',
    test: (s) => /\b(this|the|that) (API|app|code|function|feature) work\b/i.test(s),
    fix: (s) => s.replace(/\b(this|the|that) (API|app|code|function|feature) work\b/gi, '$1 $2 works'),
  },
  {
    pattern: 'missing_article',
    severity: 'medium',
    ko: '셀 수 있는 명사 하나에는 관사가 필요해요: a very good point.',
    test: (s) => /\b(is|was) very good (point|idea|question)\b/i.test(s),
    fix: (s) => s.replace(/\b(is|was) very good (point|idea|question)\b/gi, '$1 a very good $2'),
  },
];

export async function fakeCoach(prompt) {
  const body = prompt.split('Sentences:')[1]?.split('Respond with ONLY')[0] ?? '';
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!m) continue;
    let fixed = m[2];
    const hits = RULES.filter((r) => r.test(fixed));
    if (!hits.length) continue;
    for (const r of hits) fixed = r.fix(fixed);
    const main = hits[0];
    items.push({ utterance_id: m[1], original: m[2], corrected: fixed, natural: fixed, explanation_ko: hits.map((h) => h.ko).join(' '), pattern: main.pattern, severity: main.severity });
  }
  const known = (prompt.match(/known weak patterns: ([^\n]*)\./) || [])[1] || '';
  const used = [];
  if (known.includes('past_tense_with_past_time')) {
    for (const line of body.split('\n')) {
      const m = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (m && /\b(yesterday|last (night|week)|ago)\b/i.test(m[2]) && /\b(went|met|told|said|saw|had|made|took|got)\b/i.test(m[2]) && !items.some((i) => i.utterance_id === m[1])) used.push({ utterance_id: m[1], pattern: 'past_tense_with_past_time', text: m[2] });
    }
  }
  return JSON.stringify({ items, used_correctly: used, praise_ko: '하고 싶은 말을 영어로 끝까지 말해 본 것 자체가 좋은 연습이에요.', takeaway_ko: items.length ? '과거를 말할 때 동사도 과거형으로 바꾸는 것 하나만 챙겨 봐요.' : '', takeaway_pattern: items[0]?.pattern || '' });
}

export async function coach(utterances, { knownPatterns = [], backend, llm, maxItems } = {}) {
  if (!utterances.length) return { items: [], used_correctly: [], praise_ko: '', takeaway_ko: '', takeaway_pattern: '' };
  const fn = llm || pickBackend(backend, { fake: fakeCoach });
  const raw = await fn(buildPrompt(utterances, knownPatterns, { maxItems }));
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`coach returned no JSON: ${String(raw).slice(0, 200)}`);
  return normalizeCoaching(parsed, utterances);
}

const rank = { high: 0, medium: 1, low: 2 };
export const bySeverity = (a, b) => rank[a.severity] - rank[b.severity];
