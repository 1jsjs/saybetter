// Pronunciation check for practice attempts, fully local: ffmpeg → whisper.cpp (word probabilities)
// → align with the sentence the learner meant to say → per-word ok / weak / missed + Korean tips.
// Same principle Duolingo/Busuu use (was it understood as intended?), but on the learner's own sentences.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_MODEL = process.env.SAYBETTER_WHISPER_MODEL || path.join(os.homedir(), '.cache', 'whisper-cpp', 'ggml-large-v3-turbo-q5_0.bin');

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`)); });
  });
}

export const normWord = (w) => String(w).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, '');

// whisper.cpp -ojf tokens → words with the minimum token probability inside each word.
export function tokensToWords(tokens) {
  const words = [];
  for (const t of tokens || []) {
    const text = t.text || '';
    if (/^\[_.*\]$/.test(text.trim())) continue; // special tokens
    const startsWord = /^\s/.test(text) || words.length === 0;
    const piece = text.trim();
    if (!piece) continue;
    if (/^[^A-Za-z0-9']+$/.test(piece)) continue; // punctuation
    if (startsWord) words.push({ text: piece, p: t.p, from: t.offsets?.from ?? null, to: t.offsets?.to ?? null });
    else {
      const w = words[words.length - 1];
      w.text += piece;
      w.p = Math.min(w.p, t.p);
      w.to = t.offsets?.to ?? w.to;
    }
  }
  return words.map((w) => ({ ...w, norm: normWord(w.text) })).filter((w) => w.norm);
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const similar = (a, b) => a === b || (Math.max(a.length, b.length) > 2 && editDistance(a, b) / Math.max(a.length, b.length) <= 0.34);

const CONTRACTIONS = { "it's": 'it is', "that's": 'that is', "what's": 'what is', "there's": 'there is', "he's": 'he is', "she's": 'she is', "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "i've": 'i have', "we've": 'we have', "i'll": 'i will', "you'll": 'you will', "i'd": 'i would', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "let's": 'let us' };
// Split a sentence into words, expanding contractions so "It's" and "It is" align.
export function splitWords(text) {
  const out = [];
  for (const raw of String(text).split(/\s+/)) {
    const n = normWord(raw);
    if (!n) continue;
    const exp = CONTRACTIONS[n];
    if (exp) exp.split(' ').forEach((w) => out.push({ text: w, norm: w }));
    else out.push({ text: raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''), norm: n });
  }
  return out;
}

// Word-level alignment (Levenshtein over words) of the target sentence against what was heard.
export function alignWords(target, heard, { okP = 0.75, weakP = 0.45 } = {}) {
  const T = splitWords(target);
  const H = heard.flatMap((h) => {
    const exp = CONTRACTIONS[h.norm];
    return exp ? exp.split(' ').map((w) => ({ ...h, text: w, norm: w })) : [h];
  });
  const m = T.length, n = H.length;
  const cost = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const back = Array.from({ length: m + 1 }, () => Array(n + 1).fill(''));
  for (let i = 1; i <= m; i++) { cost[i][0] = i; back[i][0] = 'del'; }
  for (let j = 1; j <= n; j++) { cost[0][j] = j; back[0][j] = 'ins'; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = cost[i - 1][j - 1] + (T[i - 1].norm === H[j - 1].norm ? 0 : similar(T[i - 1].norm, H[j - 1].norm) ? 0.5 : 1);
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;
      const best = Math.min(sub, del, ins);
      cost[i][j] = best;
      back[i][j] = best === sub ? 'sub' : best === del ? 'del' : 'ins';
    }
  }
  const out = [];
  const extra = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const op = i > 0 && j > 0 ? back[i][j] : i > 0 ? 'del' : 'ins';
    if (op === 'sub') {
      const t = T[i - 1], h = H[j - 1];
      let status;
      if (t.norm === h.norm) status = h.p >= okP ? 'ok' : h.p >= weakP ? 'weak' : 'missed';
      else status = similar(t.norm, h.norm) ? 'weak' : 'missed';
      out.unshift({ word: t.text, status, heard: t.norm === h.norm ? null : h.text, p: Math.round(h.p * 100) / 100 });
      i--; j--;
    } else if (op === 'del') {
      out.unshift({ word: T[i - 1].text, status: 'missed', heard: null, p: 0 });
      i--;
    } else {
      extra.unshift(H[j - 1].text);
      j--;
    }
  }
  const pts = out.map((w) => (w.status === 'ok' ? 1 : w.status === 'weak' ? 0.5 : 0));
  const score = out.length ? Math.round((100 * pts.reduce((a, b) => a + b, 0)) / out.length) : 0;
  return { words: out, extra, score };
}

// Rule-of-thumb tips for sounds Korean speakers commonly find hard. Short, Korean, per word.
const SOUND_TIPS = [
  [/[^s]s$|es$/i, '끝의 -s/-es를 흘리지 말고 분명히 소리 내요 (works, plans).'],
  [/ed$/i, '과거형 -ed 끝소리를 살려요 (/t/·/d/·/ɪd/).'],
  [/th/i, 'th: 혀끝을 윗니 아래에 살짝 대고 바람을 내보내요 (ㄷ/ㅆ이 아니에요).'],
  [/^v|v/i, 'v: 윗니로 아랫입술을 가볍게 물고 울리면서 소리 내요 (ㅂ이 아니에요).'],
  [/f/i, 'f: 윗니를 아랫입술에 대고 바람만 내보내요 (ㅍ이 아니에요).'],
  [/r/i, 'r: 혀끝이 입천장에 닿지 않게 뒤로 말아요 (l과 구분).'],
  [/l/i, 'l: 혀끝을 윗잇몸에 확실히 붙였다 떼요 (r과 구분).'],
  [/z/i, 'z: s를 내면서 목을 울려요 (ㅈ이 아니에요).'],
  [/[ptkbdg]$/i, '단어 끝 자음을 삼키지 말고 짧게 터뜨려요.'],
  [/^w/i, 'w: 입술을 동그랗게 모았다가 펴며 시작해요 (우-).'],
];
export function tipsFor(words) {
  const tips = [];
  for (const w of words) {
    if (w.status === 'ok') continue;
    const hit = SOUND_TIPS.find(([re]) => re.test(normWord(w.word)));
    const base = w.heard ? `“${w.word}”가 “${w.heard}”로 들렸어요.` : w.status === 'missed' ? `“${w.word}”가 잘 들리지 않았어요.` : `“${w.word}” 발음이 조금 불분명했어요.`;
    tips.push({ word: w.word, tip_ko: hit ? `${base} ${hit[1]}` : `${base} 천천히 또박또박 한 번 더 말해 봐요.` });
  }
  return tips.slice(0, 4);
}

// Full pipeline for one recording.
export async function assess(audioPath, target, { model = DEFAULT_MODEL, tmpDir = os.tmpdir() } = {}) {
  if (!fs.existsSync(model)) throw Object.assign(new Error(`whisper model not found at ${model} (set SAYBETTER_WHISPER_MODEL)`), { code: 'NO_MODEL' });
  const base = path.join(tmpDir, `sb-pron-${process.pid}-${Date.now()}`);
  const wav = `${base}.wav`;
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', audioPath, '-ar', '16000', '-ac', '1', wav], 30000);
    await run('whisper-cli', ['-m', model, '-f', wav, '-l', 'en', '-ojf', '-of', base, '-np', '-bs', '1', '-bo', '1'], 90000);
    const json = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    const segs = json.transcription || [];
    const heardText = segs.map((s) => s.text).join(' ').trim();
    const heard = tokensToWords(segs.flatMap((s) => s.tokens || []));
    const { words, extra, score } = alignWords(target, heard);
    return { target, heard: heardText, score, words, extra, tips: tipsFor(words) };
  } finally {
    for (const f of [wav, `${base}.json`]) fs.rm(f, { force: true }, () => {});
  }
}
