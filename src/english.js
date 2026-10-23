// Pick the English the user actually spoke out of a Korean/English transcript.
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const WORD = /[A-Za-z][A-Za-z'’-]*/g;

export function isEnglish(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || HANGUL.test(t)) return false;
  const words = t.match(WORD) || [];
  if (words.length < 4) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const visible = (t.match(/\S/g) || []).length;
  return visible > 0 && letters / visible >= 0.7;
}

// English stretches of at least `minWords` words inside a mixed sentence.
export function englishSpans(text, minWords = 4) {
  if (typeof text !== 'string') return [];
  if (isEnglish(text)) return [text.trim()];
  const spans = [];
  for (const chunk of text.split(/[ㄱ-ㆎ가-힣]+/)) {
    const c = chunk.replace(/^[\s,.;:!?'"“”-]+|[\s,;:'"“”-]+$/g, '').trim();
    if ((c.match(WORD) || []).length >= minWords && isEnglish(c)) spans.push(c);
  }
  return spans;
}

// Utterances → [{id, text, ts, conversationId}] containing only English text.
export function englishUtterances(utterances) {
  const out = [];
  for (const u of utterances) {
    const spans = englishSpans(u.text);
    spans.forEach((text, i) => out.push({ ...u, id: spans.length > 1 ? `${u.id}#${i}` : u.id, text }));
  }
  return out;
}
