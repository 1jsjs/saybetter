// Thin wrapper around the `bee` CLI (@beeai/cli). All data access goes through
// the CLI so the project works with whatever auth the user set up via `bee login`.
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runCommand } from './proc.js';

export async function beeJson(args, opts) {
  const out = await runCommand('bee', [...args, '--json'], opts);
  return parseLooseJson(out);
}

export function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0));
    if (!Number.isFinite(start)) throw new Error(`bee returned non-JSON output: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(start));
  }
}

export const todosCreate = (text, alarmAt) =>
  beeJson(['todos', 'create', '--text', text, ...(alarmAt ? ['--alarm-at', alarmAt] : [])]);
export const todosList = () => beeJson(['todos', 'list']);
export const todosComplete = (id) => beeJson(['todos', 'complete', String(id)]);
export const factsCreate = (text) => beeJson(['facts', 'create', '--text', text]);
export const factsList = () => beeJson(['facts', 'list']);
export const factsUpdate = (id, text) => beeJson(['facts', 'update', String(id), '--text', text]);
export const now = () => beeJson(['now'], { timeoutMs: 120000 });
export const transcript = (id, since) =>
  beeJson(['conversations', 'transcript', id, ...(since ? ['--since', String(since)] : [])]);

const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
};

function toMillis(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

// Normalise one utterance object, whatever key spelling the API used.
export function normalizeUtterance(u, fallbackConversationId) {
  if (!u || typeof u !== 'object') return null;
  const text = pick(u, ['text', 'content', 'transcript', 'utterance']);
  if (typeof text !== 'string' || !text.trim()) return null;
  const conversationId =
    pick(u, ['conversation_id', 'conversationId', 'conversation_uuid', 'conversationUuid']) ??
    pick(u.conversation || {}, ['id', 'uuid']) ??
    fallbackConversationId ??
    'unknown';
  const ts = toMillis(pick(u, ['spoken_at', 'created_at', 'createdAt', 'timestamp', 'ts', 'start', 'time']));
  let id = pick(u, ['id', 'uuid', 'utterance_id', 'utteranceId']);
  if (id === undefined) {
    id = 'h-' + createHash('sha1').update(`${conversationId}|${ts ?? ''}|${text}`).digest('hex').slice(0, 16);
  }
  return {
    id: String(id),
    conversationId: String(conversationId),
    speaker: pick(u, ['speaker', 'speaker_name', 'speakerName', 'who']) ?? null,
    text: text.trim(),
    ts: ts ?? Date.now(),
  };
}

// Normalise one raw stream event. Real `bee stream --json` lines look like:
//   {"type":"new-utterance","conversation_uuid":"…","utterance":{"id":…,"text":"…","spoken_at":"ISO"}}
//   {"type":"new-utterance-chunks","conversation_id":123,"chunks":[…]}          (ignored)
//   {"type":"update-conversation-summary","conversation_id":123,"short_summary":"…"}
//   {"timestamp":1792644199272}                                                  (heartbeat, ignored)
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown', raw };
  const type = pick(raw, ['type', 'event']);
  const convFromEnvelope =
    pick(raw, ['conversation_uuid', 'conversationUuid', 'conversation_id', 'conversationId']) ??
    pick(raw.conversation || {}, ['uuid', 'id']);
  if (raw.utterance || type === 'new-utterance') {
    const u = normalizeUtterance(raw.utterance || raw.data || raw, convFromEnvelope);
    return u ? { kind: 'utterance', ...u, raw } : { kind: 'unknown', raw };
  }
  if (typeof type === 'string' && type.includes('conversation')) {
    return { kind: 'conversation', id: String(convFromEnvelope ?? 'unknown'), type, raw };
  }
  if (raw.conversation) {
    return { kind: 'conversation', id: String(convFromEnvelope ?? 'unknown'), type: type ?? null, raw };
  }
  return { kind: 'unknown', type: type ?? null, raw };
}

// Pull every utterance out of a conversations payload, whatever nesting the API used,
// oldest first. Accepts:
//   { conversations: [ { id, utterances | transcriptions: [ { utterances } ] } ] }   (bee now, bee conversations get)
//   { conversationId, transcript: [ ...utterances ] }                                   (bee conversations transcript)
//   a bare array of conversations
export function utterancesFromConversations(json) {
  const out = [];
  const pushAll = (list, convId) => {
    for (const u of list || []) {
      const n = normalizeUtterance(u, convId);
      if (n) out.push(n);
    }
  };
  if (json && Array.isArray(json.transcript)) {
    pushAll(json.transcript, json.conversationId ?? json.conversation_id);
  } else {
    const convs = Array.isArray(json)
      ? json
      : json?.conversations || json?.items || json?.data || (json?.conversation ? [json.conversation] : json?.utterances ? [json] : []);
    for (const c of convs) {
      const convId = pick(c, ['id', 'uuid']);
      pushAll(c.utterances || c.transcript || c.segments, convId);
      for (const t of c.transcriptions || []) pushAll(t.utterances, convId);
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export const conversationsList = (limit = 10) => beeJson(['conversations', 'list', '--limit', String(limit)]);

// Utterances spoken since `sinceMs` (e.g. local midnight).
export async function utterancesSince(sinceMs, { limit = 20 } = {}) {
  const listing = await conversationsList(limit);
  const convs = (listing?.conversations || []).filter((c) => (c.updated_at ?? c.end_time ?? c.start_time ?? 0) >= sinceMs);
  const all = [];
  for (const c of convs) all.push(...utterancesFromConversations(await transcript(c.id)));
  return all.filter((u) => u.ts >= sinceMs).sort((a, b) => a.ts - b.ts);
}

// Utterances from the conversations touched in the last `minutes`, or from one conversation id.
export async function recentUtterances({ minutes = 120, conversationId, limit = 10 } = {}) {
  if (conversationId) return utterancesFromConversations(await transcript(conversationId));
  const cutoff = Date.now() - minutes * 60000;
  const listing = await conversationsList(limit);
  const convs = (listing?.conversations || []).filter((c) => (c.updated_at ?? c.end_time ?? c.start_time ?? 0) >= cutoff);
  const all = [];
  for (const c of convs) all.push(...utterancesFromConversations(await transcript(c.id)));
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Async generator of raw JSON events, from a JSONL file (for tests/demos) or the live stream.
// A live stream that ends simply returns; the caller decides whether to reconnect.
export async function* rawEvents({ types, input, onStderr } = {}) {
  if (input) {
    const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        yield { parseError: line };
      }
      await sleep(50);
    }
    return;
  }
  const args = ['stream', '--json', ...(types ? ['--types', types] : [])];
  const child = spawn('bee', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => onStderr && onStderr(String(d)));
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        yield { parseError: line };
      }
    }
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
