// SayBetter UI — no dependencies.

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');

const state = {
  summary: null,
  demo: false,
  hideDemo: false,
  dayItems: null, // items shown on Today when today is empty (latest session)
  practice: null,
};

let labelFor = (p) => ({ pattern: p, label: String(p || 'other').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), label_ko: '' });

// ---------------- utilities ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return localDate(d); };
const fmtLong = (s) => parseDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = (s) => parseDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtWeekday = (s) => parseDate(s).toLocaleDateString('en-US', { weekday: 'short' });
const fmtTime = (t) => { const d = new Date(t); return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function relDay(date) {
  const today = localDate();
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return fmtShort(date);
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

const icon = {
  play: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  copy: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
  mic: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  arrow: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  eye: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  keyboard: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  bell: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  check: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  bulb: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/></svg>',
  chev: '<svg class="pbar__chev" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  flame: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.8 3.3-5.6 4-9.5 2.6 1.6 4 3.9 4 6 1-.6 1.7-1.6 2-2.8 1.8 1.7 3 3.9 3 6.3 0 3.4-2.5 6-6.5 6z"/></svg>',
};

// ---------------- word diff ----------------
const normWord = (w) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');
const tokens = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** LCS over normalised words. Returns ops: {type:'eq'|'del'|'ins', a?, b?} */
function diffWords(aStr, bStr) {
  const a = tokens(aStr), b = tokens(bStr);
  const an = a.map(normWord), bn = b.map(normWord);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = an[i] && an[i] === bn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (an[i] && an[i] === bn[j]) { ops.push({ type: 'eq', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', a: a[i] }); i++; }
    else { ops.push({ type: 'ins', b: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: 'del', a: a[i++] });
  while (j < m) ops.push({ type: 'ins', b: b[j++] });
  return ops;
}

/** Render one side of the diff, grouping adjacent changed words into one span. */
function renderSide(ops, side, cls) {
  const want = side === 'a' ? 'del' : 'ins';
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(`<span class="${cls}">${run.map(esc).join(' ')}</span>`); run = []; } };
  for (const op of ops) {
    if (op.type === 'eq') { flush(); out.push(esc(op[side])); }
    else if (op.type === want) run.push(op[side]);
  }
  flush();
  return out.join(' ');
}
const markOriginal = (orig, target) => renderSide(diffWords(orig, target), 'a', 'w-del');
const markTarget = (orig, target) => renderSide(diffWords(orig, target), 'b', 'w-ins');

// ---------------- forgiving similarity ----------------
const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "it's": 'it is', "that's": 'that is',
  "he's": 'he is', "she's": 'she is', "there's": 'there is', "what's": 'what is', "let's": 'let us',
  "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will', "it'll": 'it will',
  "i've": 'i have', "we've": 'we have', "you've": 'you have', "they've": 'they have',
  "i'd": 'i would', "we'd": 'we would', "you'd": 'you would',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "haven't": 'have not',
  "hasn't": 'has not', "couldn't": 'could not', "shouldn't": 'should not', "wouldn't": 'would not',
  'gonna': 'going to', 'wanna': 'want to', 'ok': 'okay',
};
function normSentence(s) {
  return tokens(String(s).replace(/[-–—/]/g, ' '))
    .map(normWord).filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] || w).split(' '))
    .map((w) => (w === 'can' ? 'can' : w));
}
function lcsLen(a, b) {
  const dp = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
function similarity(said, target) {
  const a = normSentence(said), b = normSentence(target);
  if (!a.length || !b.length) return 0;
  return (2 * lcsLen(a, b)) / (a.length + b.length);
}

// ---------------- speech ----------------
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
function pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
  const pref = ['Samantha', 'Ava', 'Google US English', 'Allison', 'Alex', 'Aria', 'Jenny'];
  for (const name of pref) { const v = voices.find((x) => x.name.includes(name)); if (v) return v; }
  return voices[0] || null;
}
function speak(text) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.88;
  const v = pickVoice();
  if (v) u.voice = v;
  synth.speak(u);
}
if (synth) synth.onvoiceschanged = () => {};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast('Copied to clipboard');
}

// ---------------- data ----------------
async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function buildDemoSummary(demo) {
  const today = localDate();
  const at = (daysAgo, time = '12:00') => {
    const date = addDays(today, -(daysAgo || 0));
    const [hh, mm] = time.split(':').map(Number);
    const dt = parseDate(date); dt.setHours(hh, mm, 0, 0);
    return { date, ts: dt.getTime() };
  };
  const items = demo.items.map((d, i) => {
    const { date, ts } = at(d.days_ago, d.time);
    const lab = labelFor(d.pattern);
    return {
      id: d.utterance_id || `demo-${i}`, utterance_id: d.utterance_id, ts, date,
      pattern: lab.pattern, pattern_label: lab.label, pattern_label_ko: lab.label_ko,
      original: d.original, corrected: d.corrected || d.natural, natural: d.natural || d.corrected,
      explanation_ko: d.explanation_ko, severity: d.severity || 'medium', kind: d.kind === 'tutor' ? 'tutor' : 'fix',
    };
  });
  const wins = (demo.wins || []).map((w) => ({ ...at(w.days_ago, w.time), pattern: labelFor(w.pattern).pattern, text: w.text, utterance_id: w.utterance_id || null, label: labelFor(w.pattern).label }));
  const pmap = new Map();
  const getP = (pattern) => {
    if (!pmap.has(pattern)) { const lab = labelFor(pattern); pmap.set(pattern, { pattern, label: lab.label, label_ko: lab.label_ko, count: 0, wins: 0, examples: [], win_examples: [] }); }
    return pmap.get(pattern);
  };
  for (const it of [...items].sort((a, b) => a.ts - b.ts)) {
    const p = getP(it.pattern);
    p.count++; p.last = { original: it.original, natural: it.natural };
    p.examples.unshift({ original: it.original, natural: it.natural, date: it.date, kind: it.kind });
  }
  for (const w of [...wins].sort((a, b) => a.ts - b.ts)) { const p = getP(w.pattern); p.wins++; p.win_examples.unshift({ text: w.text, date: w.date }); }
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); days.push({ date: d, count: items.filter((x) => x.date === d).length }); }
  const tomorrow = addDays(today, 1);
  const drills = demo.drills.map((d) => {
    const [hh, mm] = d.time.split(':').map(Number);
    const a = parseDate(tomorrow); a.setHours(hh, mm, 0, 0);
    return { todo_id: d.todo_id, text: d.text, natural: d.natural, alarm_at: a.toISOString(), created_at: new Date().toISOString() };
  });
  const facts = demo.facts.map((f) => {
    const lab = labelFor(f.pattern);
    const a = parseDate(addDays(today, -(f.days_ago || 0))); a.setHours(21, 5);
    return { fact_id: f.fact_id, pattern: lab.pattern, label: lab.label, label_ko: lab.label_ko, text: f.text, created_at: a.toISOString() };
  });
  const todayItems = items.filter((x) => x.date === today).sort((a, b) => a.ts - b.ts);
  const tp = labelFor(demo.takeaway_pattern);
  const ex = [...todayItems].reverse().find((x) => x.pattern === tp.pattern);
  const r = demo.review || {};
  const due = (r.due || []).map((id) => items.find((x) => x.id === id)).filter(Boolean).map((x) => ({ ...x, review: true, box: 1, due_date: today }));
  const weekStart = addDays(today, -6);
  return {
    today: { date: today, items: todayItems },
    latest_date: today, total_items: items.length, days,
    patterns: [...pmap.values()].sort((a, b) => b.count - a.count || b.wins - a.wins || a.label.localeCompare(b.label)),
    drills, facts, praise_ko: demo.praise_ko, practice: { ...demo.practice },
    takeaway: demo.takeaway_ko ? { text_ko: demo.takeaway_ko, pattern: tp.pattern, label: tp.label, label_ko: tp.label_ko, count: todayItems.filter((x) => x.pattern === tp.pattern).length, example: ex ? { original: ex.original, natural: ex.natural, kind: ex.kind } : null, derived: false } : null,
    used_correctly: [],
    wins: wins.filter((w) => w.date === today),
    wins_total: wins.length, wins_week: wins.filter((w) => w.date >= weekStart).length,
    review: { due, due_total: due.length, counts: { box1: 0, box2: 0, box3: 0, box4: 0, ...(r.counts || {}) } },
    _all: items,
  };
}

function emptySummary() {
  const today = localDate();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push({ date: addDays(today, -i), count: 0 });
  return { today: { date: today, items: [] }, latest_date: null, total_items: 0, days, patterns: [], drills: [], facts: [], praise_ko: '', takeaway: null, used_correctly: [], wins: [], wins_total: 0, wins_week: 0, review: { due: [], due_total: 0, counts: { box1: 0, box2: 0, box3: 0, box4: 0 } }, practice: { today_ok: 0, today_total: 0, streak_days: 0 } };
}

async function load() {
  try {
    const mod = await import('/lib/patterns.js');
    if (mod.labelFor) labelFor = mod.labelFor;
  } catch { /* fallback labels */ }

  let summary = null;
  try { summary = await getJson('/api/summary'); } catch { summary = null; }
  state.hideDemo = store.get('sb-hide-demo') === '1';

  if (summary && summary.total_items > 0) {
    state.demo = false;
    state.summary = summary;
    if (!summary.today.items.length && summary.latest_date) {
      try { state.dayItems = (await getJson(`/api/items?date=${summary.latest_date}`)).items; } catch { state.dayItems = []; }
    }
  } else if (!state.hideDemo) {
    try {
      state.summary = buildDemoSummary(await getJson('demo-data.json'));
      state.demo = true;
    } catch { state.summary = summary || emptySummary(); state.demo = false; }
  } else {
    state.summary = summary || emptySummary();
    state.demo = false;
  }
}

// ---------------- shared bits ----------------
function demoNotice() {
  if (!state.demo) return '';
  return `<div class="notice" role="note">
    <p><span class="badge">Sample data</span>&nbsp; You're looking at an example notebook. Run <code>saybetter review</code> to coach your own English from today's Bee conversations.</p>
    <button class="btn btn--ghost" type="button" data-action="hide-demo">Hide sample</button>
  </div>`;
}

function chip(it) {
  return `<span class="chip">${esc(it.pattern_label || it.label)}${(it.pattern_label_ko || it.label_ko) ? ` <span class="ko">· ${esc(it.pattern_label_ko || it.label_ko)}</span>` : ''}</span>`;
}

const SEV_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

function correctionCard(it) {
  const target = it.natural || it.corrected;
  const tutor = it.kind === 'tutor';
  return `<li class="card" id="item-${esc(it.id)}">
    <div class="card__meta">
      <span class="sev sev--${esc(it.severity)}">${SEV_LABEL[it.severity] || 'Priority'}</span>
      ${tutor ? '<span class="chip chip--tutor">Korean → English</span>' : chip(it)}
      ${it.ts ? `<span class="card__time" aria-label="Said at ${fmtTime(it.ts)}">${fmtTime(it.ts)}</span>` : ''}
    </div>
    ${tutor
      ? `<p class="said"><span class="said__label">You said</span><span>${esc(it.original)}</span></p>
         <p class="better" lang="en"><span class="better__label">How to say it</span>${esc(target)}</p>`
      : `<p class="said"><span class="said__label">You said</span><span lang="en">${markOriginal(it.original, it.corrected || target)}</span></p>
         <p class="better" lang="en"><span class="visually-hidden">Say it better: </span>${markTarget(it.original, target)}</p>`}
    ${it.explanation_ko ? `<p class="explain ko" lang="ko">${esc(it.explanation_ko)}</p>` : ''}
    <div class="card__actions">
      ${synth ? `<button class="btn" type="button" data-action="listen" data-text="${esc(target)}">${icon.play}<span>Listen</span></button>` : ''}
      <button class="btn" type="button" data-action="copy" data-text="${esc(target)}">${icon.copy}<span>Copy</span></button>
      <span class="spacer"></span>
      <a class="btn btn--ghost" href="#practice/${encodeURIComponent(it.id)}">Practice this ${icon.arrow}</a>
    </div>
  </li>`;
}

function emptyState({ title, body, steps = [], cta = '' }) {
  return `<div class="empty">
    <h2>${title}</h2>
    <p>${body}</p>
    ${steps.length ? `<ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''}
    ${cta}
  </div>`;
}

const HOW_TO = [
  'Wear Bee and have a few conversations in English.',
  'Run <code class="code">saybetter review</code> in your terminal — it finds the sentences you said and coaches them.',
  'Refresh this page. Tomorrow\'s drills also appear on your wrist as Bee todos.',
];

function allItems() {
  const s = state.summary;
  const base = s._all ? s._all : [...(s.today.items || []), ...(state.dayItems || [])];
  const extra = ((s.review && s.review.due) || []).filter((d) => !base.some((b) => b.id === d.id));
  return [...base, ...extra];
}

// ---------------- views ----------------
function focusCard(s) {
  const t = s.takeaway;
  if (!t) return '';
  const ex = t.example;
  return `<section class="focus" aria-labelledby="focus-title">
    <p class="focus__eyebrow" id="focus-title">Today's one thing</p>
    <p class="focus__text ko" lang="ko">${esc(t.text_ko)}</p>
    <p class="focus__pattern"><span class="chip">${esc(t.label)}${t.label_ko ? ` <span class="ko">· ${esc(t.label_ko)}</span>` : ''}</span>${t.count > 1 ? `<span class="muted">${t.count} times today</span>` : ''}</p>
    ${ex ? `<p class="focus__example" lang="en">${ex.kind === 'tutor' ? esc(ex.natural) : markTarget(ex.original, ex.natural)}</p>` : ''}
    ${s.drills.length ? `<a class="focus__link" href="#drills">${icon.bell}<span>Tomorrow's drills focus on this</span>${icon.arrow}</a>` : ''}
  </section>`;
}

function winsBlock(s) {
  const seen = new Set();
  const list = [...(s.used_correctly || []), ...(s.wins || [])].filter((w) => {
    const k = (w.text || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (!list.length) return '';
  return `<section class="wins" aria-labelledby="wins-title">
    <div class="section-head"><div><h2 class="section-title" id="wins-title">Got it right in real life</h2>
    <p class="section-sub">Bee heard you use a pattern you used to slip on — correctly, in a real conversation.</p></div></div>
    <ul class="wins__list">${list.map((w) => `<li class="win">
      <span class="win__check" aria-hidden="true">${icon.check}</span>
      <div><p class="win__text" lang="en">${esc(w.text)}</p><p class="win__meta">${esc(w.label || labelFor(w.pattern).label)}</p></div>
    </li>`).join('')}</ul>
  </section>`;
}

function viewToday() {
  const s = state.summary;
  let items = s.today.items;
  let header;
  const p = s.practice || {};
  const showingLatest = !items.length && state.dayItems && state.dayItems.length;
  if (showingLatest) items = state.dayItems;
  const dueN = (s.review && s.review.due_total) || 0;

  if (s.today.items.length) {
    header = `<h1 class="page-title" tabindex="-1"><em>${plural(items.length, 'sentence')}</em> coached today</h1>`;
  } else if (showingLatest) {
    header = `<h1 class="page-title" tabindex="-1">Nothing new yet today</h1>
      <p class="lede">Here is your latest session from ${esc(fmtLong(s.latest_date))} — ${plural(items.length, 'sentence')}. Run <code class="code">saybetter review</code> after today's conversations.</p>`;
  } else {
    header = `<h1 class="page-title" tabindex="-1">Your English notebook</h1>`;
  }

  const stats = s.total_items ? `<div class="stats">
      ${dueN ? `<span><b>${dueN}</b> due for review — <a href="#practice">practice now</a></span>` : ''}
      <span><b>${s.patterns.filter((x) => x.count).length}</b> ${s.patterns.length === 1 ? 'pattern' : 'patterns'} to watch — <a href="#patterns">see patterns</a></span>
      <span><b>${s.drills.length}</b> wrist ${s.drills.length === 1 ? 'drill' : 'drills'} for tomorrow — <a href="#drills">view</a></span>
      <span><b>${p.streak_days || 0}</b>-day practice streak</span>
    </div>` : '';

  const body = items.length
    ? `<h2 class="visually-hidden">Corrections</h2><ol class="cards" aria-label="Corrections">${items.map(correctionCard).join('')}</ol>`
    : emptyState({
        title: 'No sentences coached yet',
        body: 'SayBetter turns the English you actually spoke into a short daily lesson. Nothing has been reviewed yet.',
        steps: HOW_TO,
        cta: state.hideDemo ? '<button class="btn" type="button" data-action="show-demo">Show sample data</button>' : '',
      });

  return `<section class="view" aria-labelledby="t-today">
    ${demoNotice()}
    <div class="page-head">
      <p class="eyebrow">${esc(fmtLong(s.today.date))}</p>
      ${header.replace('class="page-title"', 'class="page-title" id="t-today"')}
      ${s.praise_ko ? `<p class="praise ko" lang="ko">${esc(s.praise_ko)}</p>` : ''}
      ${stats}
    </div>
    ${focusCard(s)}
    ${winsBlock(s)}
    ${body}
  </section>`;
}

// ----- practice -----
function practiceQueue(startId) {
  const s = state.summary;
  const base = s.today.items.length ? s.today.items : (state.dayItems && state.dayItems.length ? state.dayItems : []);
  const due = ((s.review && s.review.due) || []).filter((d) => !base.some((b) => b.id === d.id));
  let q = [...base, ...due];
  if (!q.length) q = allItems().slice(-10);
  if (startId) {
    const hit = allItems().find((x) => x.id === startId);
    if (hit) q = [hit, ...q.filter((x) => x.id !== startId)];
  }
  return q;
}

function startPractice(startId) {
  state.practice = {
    queue: practiceQueue(startId), idx: 0, passed: 0,
    attempts: 0, hint: 0, solved: false, typing: !SR, listening: false, last: null,
    startId,
  };
}

/** Cloze: keep words shared with the original, blank out the ones that change. */
function clozeHtml(it) {
  const target = it.natural || it.corrected;
  const tutor = it.kind === 'tutor';
  const ops = diffWords(it.original, target);
  return ops.filter((o) => o.type !== 'del').map((o) => {
    if (o.type === 'eq') return esc(o.b);
    const m = o.b.match(/^(.*?)([.,!?;:]*)$/);
    const core = m[1], punct = m[2];
    const lead = tutor && core ? esc(core[0]) : '';
    return `<span class="blank">${lead}<span aria-hidden="true">${'_'.repeat(Math.max(3, Math.min(8, core.length - (lead ? 1 : 0))))}</span><span class="visually-hidden">blank</span></span>${esc(punct)}`;
  }).join(' ');
}

function viewPractice() {
  const pr = state.practice;
  const s = state.summary;
  const streak = (s.practice && s.practice.streak_days) || 0;
  const head = `<div class="page-head">
      <p class="eyebrow">Practice</p>
      <h1 class="page-title" id="t-practice" tabindex="-1">Say it the natural way</h1>
      <p class="lede">Try first, from the rule alone. Take a hint only if you need one — working it out yourself is what makes it stick.</p>
    </div>`;

  if (!pr.queue.length) {
    return `<section class="view" aria-labelledby="t-practice">${demoNotice()}${head}${emptyState({
      title: 'Nothing to practice yet', body: 'Practice cards come from the sentences SayBetter coached.', steps: HOW_TO,
    })}</section>`;
  }

  const total = pr.queue.length;
  if (pr.idx >= total) {
    return `<section class="view" aria-labelledby="t-practice">${demoNotice()}${head}
      <div class="card drill-card done" aria-live="polite">
        <p class="big">${pr.passed}<small> / ${total}</small></p>
        <p class="prompt-line">said naturally without revealing the answer.</p>
        <p class="hint-line">${streak ? `Practice streak: <b>${plural(streak, 'day')}</b>. ` : ''}Sentences you got right come back in 3, 7, then 14 days. Missed ones return tomorrow.</p>
        <div class="practice-foot">
          <button class="btn btn--primary" type="button" data-action="restart">Practice again</button>
          <a class="btn" href="#drills">See tomorrow's drills</a>
        </div>
      </div></section>`;
  }

  const it = pr.queue[pr.idx];
  const target = it.natural || it.corrected;
  const tutor = it.kind === 'tutor';
  const pct = Math.round((pr.idx / total) * 100);
  const revealed = pr.hint >= 2 || pr.solved;
  const reviewTag = it.review ? `<span class="tag-review">Review · from ${esc(it.date === addDays(localDate(), -1) ? 'yesterday' : fmtWeekday(it.date))}</span>` : '';
  const steps = ['Try', 'Hint', 'Answer'].map((name, i) => `<li class="${pr.hint === i && !pr.solved ? 'is-current' : ''} ${pr.hint > i || pr.solved ? 'is-done' : ''}">${name}</li>`).join('');

  let targetHtml;
  if (revealed) targetHtml = tutor ? esc(target) : markTarget(it.original, target);
  else if (pr.hint === 1) targetHtml = clozeHtml(it);
  else targetHtml = tutor ? 'Say the whole sentence in English.' : 'Hidden — try it first.';

  return `<section class="view" aria-labelledby="t-practice">${demoNotice()}${head}
    <div class="progress">
      <span>${pr.idx + 1} of ${total}</span>
      <div class="progress__bar" role="progressbar" aria-label="Practice progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${pr.idx}"><div class="progress__fill" style="width:${pct}%"></div></div>
      <span class="streak"><span><b>${streak}</b>-day streak</span></span>
    </div>
    <article class="card drill-card" aria-label="Practice card ${pr.idx + 1}">
      <div class="card__meta" style="margin-bottom:16px">${reviewTag}${tutor ? '<span class="chip chip--tutor">Korean → English</span>' : chip(it)}<ol class="steps" aria-label="Hint level">${steps}</ol></div>
      ${it.explanation_ko ? `<p class="explain ko" lang="ko">${esc(it.explanation_ko)}</p>` : ''}
      <p class="said"><span class="said__label">You said</span><span ${tutor ? '' : 'lang="en"'}>${revealed && !tutor ? markOriginal(it.original, it.corrected || target) : esc(it.original)}</span></p>
      <p class="prompt-line">${revealed ? (tutor ? 'How to say it:' : 'The natural version:') : pr.hint === 1 ? 'Fill in the blanks — out loud:' : 'Now say it the natural way:'}</p>
      <p class="drill-target ${revealed || pr.hint === 1 ? '' : 'drill-target--hidden'}" lang="en" id="target">${targetHtml}</p>

      ${pr.typing ? `<form class="type-form" data-form="type">
          <label class="visually-hidden" for="typed">Type the natural sentence</label>
          <input id="typed" name="typed" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="Type the natural sentence…" ${pr.solved ? 'disabled' : ''}>
          <button class="btn btn--primary" type="submit" ${pr.solved ? 'disabled' : ''}>Check</button>
        </form>
        ${SR ? '' : '<p class="hint-line">Speech recognition isn\'t available in this browser, so type it instead. Chrome or Safari can listen.</p>'}`
      : `<div class="mic-row">
          <button class="btn btn--primary btn--lg" type="button" data-action="say" ${pr.solved ? 'disabled' : ''} aria-describedby="listen-state">${icon.mic}<span>${pr.listening ? 'Listening…' : 'Say it'}</span></button>
          <span id="listen-state" class="muted" style="display:inline-flex;align-items:center;gap:8px;font-size:14px">${pr.listening ? '<span class="listening-dot" aria-hidden="true"></span>Speak now, in English' : ''}</span>
        </div>`}

      <div id="result" class="result ${pr.last ? (pr.last.ok ? 'result--ok' : 'result--retry') : ''}" aria-live="polite" aria-atomic="true">${pr.last ? resultHtml(pr.last, it, target) : ''}</div>

      <div class="practice-foot">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!revealed && pr.hint < 1 ? `<button class="btn" type="button" data-action="hint">${icon.bulb}<span>Hint</span></button>` : ''}
          ${!revealed ? `<button class="btn ${pr.hint === 1 ? '' : 'btn--ghost'}" type="button" data-action="reveal">${icon.eye}<span>Reveal</span></button>` : ''}
          ${synth && revealed ? `<button class="btn" type="button" data-action="listen" data-text="${esc(target)}">${icon.play}<span>Listen</span></button>` : ''}
          ${SR ? `<button class="btn btn--ghost" type="button" data-action="toggle-typing">${pr.typing ? icon.mic + '<span>Speak instead</span>' : icon.keyboard + '<span>Type instead</span>'}</button>` : ''}
        </div>
        <button class="btn ${revealed ? 'btn--primary' : ''}" type="button" data-action="next">${pr.idx + 1 === total ? 'Finish' : 'Next'} ${icon.arrow}</button>
      </div>
      <p class="hint-line" aria-hidden="true">Shortcuts: <span class="kbd">S</span> say · <span class="kbd">H</span> hint · <span class="kbd">R</span> reveal · <span class="kbd">N</span> next</p>
    </article>
  </section>`;
}

function resultHtml(r, it, target) {
  const pct = Math.round(r.score * 100);
  const saidHtml = renderSide(diffWords(r.said, target), 'a', 'w-del');
  const missHtml = renderSide(diffWords(r.said, target), 'b', 'w-miss');
  if (r.ok) {
    return `<p class="result__head">That's it — sounds natural. <span class="result__score">${pct}% match</span></p>
      <p class="result__said" lang="en">“${saidHtml}”</p>
      ${state.practice.hint < 2 ? `<p class="result__hint">You'll see this one again in a few days to make it stick.</p>` : ''}`;
  }
  return `<p class="result__head">Close — try once more. <span class="result__score">${pct}% match</span></p>
    <p class="result__said" lang="en">You said: “${saidHtml || '…'}”</p>
    ${state.practice.hint >= 2 ? `<p class="result__hint">Missing words are underlined: <span lang="en" class="serif">${missHtml}</span></p>`
      : state.practice.hint === 0 ? '<p class="result__hint">Struck words aren\'t in the natural version. Try a hint if you\'re stuck.</p>'
      : '<p class="result__hint">Struck words aren\'t in the natural version. Reveal it if you\'re stuck.</p>'}`;
}

async function evaluate(said) {
  const p = state.practice;
  const it = p.queue[p.idx];
  const target = it.natural || it.corrected;
  const score = Math.max(similarity(said, target), similarity(said, it.corrected || target));
  const ok = score >= 0.8;
  p.attempts++;
  p.last = { said, score, ok };
  if (ok && !p.solved) { p.solved = true; if (p.hint < 2) p.passed++; }
  render();
  if (!state.demo) {
    try {
      const res = await getJson('/api/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utterance_id: it.utterance_id || it.id, said, ok, hint: p.hint }),
      });
      if (res && res.practice) { state.summary.practice = res.practice; if (ok) render(); }
    } catch { /* offline: keep going */ }
  } else if (ok && state.summary.practice && !state._demoStreakBumped) {
    state._demoStreakBumped = true; state.summary.practice.streak_days += 1; render();
  }
}

let recognizer = null;
function listen() {
  const p = state.practice;
  if (!SR || p.listening) { if (recognizer) recognizer.stop(); return; }
  try { synth && synth.cancel(); } catch { /* ignore */ }
  recognizer = new SR();
  recognizer.lang = 'en-US';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;
  let got = false;
  recognizer.onresult = (e) => {
    got = true;
    const it = p.queue[p.idx];
    const target = it.natural || it.corrected;
    const alts = [...e.results[0]].map((a) => a.transcript);
    alts.sort((x, y) => similarity(y, target) - similarity(x, target));
    p.listening = false;
    evaluate(alts[0] || '');
  };
  recognizer.onerror = (e) => {
    p.listening = false;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      p.typing = true; render(); toast('Microphone blocked — type it instead');
    } else if (e.error === 'no-speech') { render(); toast("Didn't catch that — try again"); }
    else { render(); }
  };
  recognizer.onend = () => { if (!got && p.listening) { p.listening = false; render(); } };
  p.listening = true;
  render();
  try { recognizer.start(); } catch { p.listening = false; render(); }
}

// ----- patterns -----
function sparkBars(days) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const today = localDate();
  return `<ol class="sbars" aria-label="Sentences coached per day, last 7 days">${days.map((d) => {
    const pct = d.count ? Math.max(6, (d.count / max) * 82) : 0;
    const name = d.date === today ? 'Today' : fmtWeekday(d.date);
    return `<li class="sbar ${d.date === today ? 'sbar--today' : ''}">
      <span class="sbar__col"><span class="sbar__val" aria-hidden="true">${d.count || ''}</span><span class="sbar__bar" style="height:${pct}%"></span></span>
      <span class="sbar__lbl"><span aria-hidden="true">${name}</span><span class="visually-hidden">${esc(fmtLong(d.date))}: ${plural(d.count, 'sentence')}</span></span>
    </li>`;
  }).join('')}</ol>`;
}

function viewPatterns() {
  const s = state.summary;
  const days = s.days.slice(-7);
  const weekTotal = days.reduce((a, d) => a + d.count, 0);
  const max = Math.max(1, ...s.patterns.map((p) => Math.max(p.count, p.wins || 0)));
  const winsWeek = s.wins_week || 0, winsTotal = s.wins_total || 0;
  const head = `<div class="page-head">
      <p class="eyebrow">Patterns</p>
      <h1 class="page-title" id="t-patterns" tabindex="-1">What keeps coming up</h1>
      <p class="lede">The same few habits cause most of the mistakes. Bee also hears when you get them right in real conversations — that is the number that matters.</p>
    </div>`;

  if (!s.patterns.length) {
    return `<section class="view" aria-labelledby="t-patterns">${demoNotice()}${head}${emptyState({
      title: 'No patterns yet', body: 'Patterns appear after SayBetter has coached a few of your sentences.', steps: HOW_TO,
    })}</section>`;
  }

  const rows = s.patterns.map((p, i) => {
    const w = p.wins || 0;
    const exs = p.examples && p.examples.length ? p.examples : p.last ? [p.last] : [];
    return `<li class="pbar">
      <button class="pbar__btn" type="button" aria-expanded="false" aria-controls="pb-${i}" data-action="toggle-pattern">
        <span class="pbar__name">${esc(p.label)}${p.label_ko ? `<span class="ko" lang="ko">${esc(p.label_ko)}</span>` : ''}</span>
        <span class="pbar__bars" aria-hidden="true">
          <span class="pbar__row"><span class="pbar__track"><span class="pbar__fill" style="width:${(p.count / max) * 100}%"></span></span><span class="pbar__n">${p.count}</span></span>
          <span class="pbar__row"><span class="pbar__track"><span class="pbar__fill pbar__fill--win${w ? '' : ' is-zero'}" style="width:${(w / max) * 100}%"></span></span><span class="pbar__n">${w}</span></span>
        </span>
        <span class="visually-hidden">Slipped ${plural(p.count, 'time')}, got it right in real life ${plural(w, 'time')}.</span>
        ${icon.chev}
      </button>
      <div class="pbar__body" id="pb-${i}" hidden>
        ${(p.win_examples || []).map((e) => `<div class="example example--win">
          <p class="better" lang="en"><span class="win__check win__check--sm" aria-hidden="true">${icon.check}</span>${esc(e.text)}</p>
          <p class="example__date">Got it right in real life · ${esc(relDay(e.date))}</p>
        </div>`).join('')}
        ${exs.map((e) => `<div class="example">
          ${e.kind === 'tutor'
            ? `<p class="said">${esc(e.original)}</p><p class="better" lang="en">${esc(e.natural)}</p>`
            : `<p class="said" lang="en">${markOriginal(e.original, e.natural)}</p><p class="better" lang="en">${markTarget(e.original, e.natural)}</p>`}
          ${e.date ? `<p class="example__date">Slipped · ${esc(relDay(e.date))}</p>` : ''}
        </div>`).join('')}
      </div>
    </li>`;
  }).join('');

  const facts = s.facts.length
    ? `<ul class="facts">${s.facts.map((f) => `<li class="fact">
        <div class="fact__top"><span class="chip">${esc(f.label)}${f.label_ko ? ` <span class="ko">· ${esc(f.label_ko)}</span>` : ''}</span><span class="badge badge--bee">Saved to Bee as a fact</span></div>
        <p class="fact__text">${esc(f.text)}</p>
        ${f.created_at ? `<p class="fact__date">Saved ${esc(relDay(localDate(new Date(f.created_at))))}</p>` : ''}
      </li>`).join('')}</ul>`
    : `<p class="muted">When a pattern repeats, SayBetter saves it to Bee as a fact so Bee keeps it in mind.</p>`;
  const winsLine = `<p class="wins-line">${winsTotal
    ? `Since then, Bee has heard you get these right <b>${plural(winsTotal, 'time')}</b> in real conversations.`
    : 'Bee listens for these. The first time you get one right in a real conversation, it shows up here as a win.'}</p>`;

  return `<section class="view" aria-labelledby="t-patterns">${demoNotice()}${head}
    <div class="panel">
      <div class="spark">
        <div class="spark__stats">
          <p class="spark__total">${weekTotal}<small>sentences coached<br>in the last 7 days</small></p>
          <p class="spark__total spark__total--win">${winsWeek}<small>real-life ${winsWeek === 1 ? 'win' : 'wins'}<br>this week</small></p>
        </div>
        ${sparkBars(days)}
      </div>
    </div>
    <div class="section">
      <div class="section-head"><div><h2 class="section-title">Slipped vs. got it right</h2><p class="section-sub">All time · select a row to see your own sentences</p></div>
        <p class="legend" aria-hidden="true"><span class="legend__k"></span>Slipped <span class="legend__k legend__k--win"></span>Got it right in real life</p></div>
      <ul class="pbars">${rows}</ul>
    </div>
    <div class="section">
      <div class="section-head"><div><h2 class="section-title">What Bee remembers</h2><p class="section-sub">Recurring habits saved to your Bee memory</p></div></div>
      ${facts}
      ${winsLine}
    </div>
  </section>`;
}

// ----- drills -----
function viewDrills() {
  const s = state.summary;
  const drills = s.drills;
  const now = Date.now();
  const tomorrow = addDays(localDate(), 1);
  const dayOf = drills.length && drills[0].alarm_at ? localDate(new Date(drills[0].alarm_at)) : tomorrow;
  const next = drills.find((d) => d.alarm_at && Date.parse(d.alarm_at) > now) || drills[0];
  const head = `<div class="page-head">
      <p class="eyebrow">Wrist drills · ${esc(fmtLong(dayOf))}</p>
      <h1 class="page-title" id="t-drills" tabindex="-1">${dayOf === tomorrow ? 'Tomorrow, on your wrist' : 'Drills on your wrist'}</h1>
      <p class="lede">Each drill is a Bee todo with an alarm. When your watch taps you, say the sentence out loud — once is enough.</p>
      ${s.takeaway && drills.length ? `<p class="focus-ref"><span class="focus-ref__k">Focus</span><span>${esc(s.takeaway.label)}${s.takeaway.label_ko ? ` <span class="ko muted">· ${esc(s.takeaway.label_ko)}</span>` : ''}</span><a href="#today">Today's one thing</a></p>` : ''}
    </div>`;

  if (!drills.length) {
    return `<section class="view" aria-labelledby="t-drills">${demoNotice()}${head}${emptyState({
      title: 'No drills scheduled',
      body: '<code class="code">saybetter review</code> picks your three most useful corrections and creates Bee todos with alarms for 09:00, 13:00 and 19:00 tomorrow.',
    })}</section>`;
  }

  const strip = (t) => t.replace(/^say it:\s*/i, '');
  const items = drills.map((d) => {
    const t = d.alarm_at ? fmtTime(d.alarm_at) : '—';
    const isNext = d === next;
    const sentence = strip(d.text);
    const showNatural = d.natural && normSentence(d.natural).join(' ') !== normSentence(sentence).join(' ');
    return `<li class="tl ${isNext ? 'tl--next' : ''}">
      <p class="tl__time">${t}${isNext ? '<small>Next</small>' : ''}</p>
      <span class="tl__node" aria-hidden="true"></span>
      <div class="todo">
        <span class="todo__check" aria-hidden="true"></span>
        <div>
          <p class="todo__text" lang="en">${esc(d.text)}</p>
          ${showNatural ? `<p class="todo__natural" lang="en">${esc(d.natural)}</p>` : ''}
          <p class="todo__sub"><span>${icon.bell}Alarm ${t}</span><span>Bee todo</span>
            ${synth ? `<button class="btn btn--ghost" style="min-height:28px;padding:2px 8px;font-size:13px" type="button" data-action="listen" data-text="${esc(d.natural || sentence)}">${icon.play}<span>Listen</span></button>` : ''}</p>
        </div>
      </div>
    </li>`;
  }).join('');

  const nt = next && next.alarm_at ? fmtTime(next.alarm_at) : '09:00';
  const watch = `<div class="watch-wrap">
      <div class="watch" role="img" aria-label="Apple Watch preview: Bee reminder at ${nt}, ${esc(next.text)}">
        <div class="watch__band" aria-hidden="true"></div>
        <div class="watch__case" aria-hidden="true">
          <span class="watch__crown"></span>
          <div class="watch__screen">
            <div class="watch__top"><span class="watch__app">Bee</span><span class="watch__clock">${nt}</span></div>
            <p class="watch__label">Reminder</p>
            <p class="watch__text">${esc(next.text)}</p>
            <div class="watch__btns"><span class="watch__btn">Snooze</span><span class="watch__btn watch__btn--ok">Done</span></div>
          </div>
        </div>
        <div class="watch__band watch__band--b" aria-hidden="true"></div>
      </div>
      <p class="watch-cap">How the ${nt} drill appears on your Apple Watch.</p>
    </div>`;

  return `<section class="view" aria-labelledby="t-drills">${demoNotice()}${head}
    <div class="drills-layout">
      <ol class="timeline" aria-label="Drill schedule">${items}</ol>
      ${watch}
    </div>
  </section>`;
}

// ---------------- router ----------------
const ROUTES = ['today', 'practice', 'patterns', 'drills'];
function currentRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [r, ...rest] = h.split('/');
  return { name: ROUTES.includes(r) ? r : 'today', param: rest.join('/') || null };
}

let lastRouteKey = '';
function render({ focus = false } = {}) {
  const { name, param } = currentRoute();
  document.querySelectorAll('.nav__link').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const titles = { today: 'Today', practice: 'Practice', patterns: 'Patterns', drills: 'Wrist drills' };
  document.title = `${titles[name]} · SayBetter`;

  if (name === 'practice') {
    const key = `practice:${param || ''}`;
    if (!state.practice || key !== lastRouteKey) startPractice(param);
    lastRouteKey = key;
  } else {
    lastRouteKey = name;
  }

  const html = { today: viewToday, practice: viewPractice, patterns: viewPatterns, drills: viewDrills }[name](param);
  const active = document.activeElement;
  const activeAction = active && active.dataset ? active.dataset.action : null;
  main.innerHTML = html;
  main.querySelector('.view')?.classList.toggle('no-anim', !focus);
  if (!focus) main.querySelector('.view')?.style.setProperty('animation', 'none');
  if (focus) {
    const h1 = main.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } else if (activeAction) {
    const again = main.querySelector(`[data-action="${activeAction}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
}

// ---------------- events ----------------
main.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  const p = state.practice;
  switch (a) {
    case 'listen': speak(btn.dataset.text); break;
    case 'copy': copyText(btn.dataset.text); break;
    case 'hide-demo': store.set('sb-hide-demo', '1'); boot(); break;
    case 'show-demo': store.del('sb-hide-demo'); boot(); break;
    case 'toggle-pattern': {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      document.getElementById(btn.getAttribute('aria-controls')).hidden = open;
      break;
    }
    case 'say': listen(); break;
    case 'hint': p.hint = Math.max(p.hint, 1); render(); main.querySelector('[data-action="reveal"]')?.focus({ preventScroll: true }); break;
    case 'reveal': p.hint = 2; render(); break;
    case 'toggle-typing': p.typing = !p.typing; render(); if (p.typing) $('#typed')?.focus(); break;
    case 'next': nextCard(); break;
    case 'restart': startPractice(null); render({ focus: true }); break;
    default: break;
  }
});

function nextCard() {
  const p = state.practice;
  if (!p) return;
  if (recognizer) try { recognizer.abort(); } catch { /* ignore */ }
  p.idx++; p.attempts = 0; p.hint = 0; p.solved = false; p.last = null; p.listening = false;
  render();
  const focusEl = main.querySelector('[data-action="say"]') || main.querySelector('#typed') || main.querySelector('[data-action="restart"]');
  focusEl?.focus({ preventScroll: true });
}

main.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="type"]');
  if (!form) return;
  e.preventDefault();
  const v = form.typed.value.trim();
  if (v) evaluate(v).then(() => { const inp = $('#typed'); if (inp && !inp.disabled) { inp.value = v; inp.focus(); } });
});

document.addEventListener('keydown', (e) => {
  if (currentRoute().name !== 'practice' || !state.practice) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  const k = e.key.toLowerCase();
  if (k === 's' && !state.practice.typing) { e.preventDefault(); listen(); }
  else if (k === 'h') { e.preventDefault(); state.practice.hint = Math.max(state.practice.hint, 1); render(); }
  else if (k === 'r') { e.preventDefault(); state.practice.hint = 2; render(); }
  else if (k === 'n' || k === 'arrowright') { e.preventDefault(); nextCard(); }
});

window.addEventListener('hashchange', () => render({ focus: true }));

// ---------------- theme ----------------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() { return document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light'); }
function syncThemeButton() {
  const b = $('#themeToggle');
  b.setAttribute('aria-label', effectiveTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
$('#themeToggle').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('sb-theme', next);
  syncThemeButton();
});
mq.addEventListener?.('change', syncThemeButton);
syncThemeButton();

// ---------------- boot ----------------
async function boot() {
  state.practice = null;
  state.dayItems = null;
  await load();
  lastRouteKey = '';
  render();
}
boot();
