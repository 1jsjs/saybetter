// LLM backends shared by the coach: Claude Code headless (default), Gemini, or a deterministic fake.
import { spawn } from 'node:child_process';

export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const candidates = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.unshift(fence[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object') return v;
    } catch {
      /* next */
    }
  }
  return null;
}

function claude(prompt) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ['-p', '--output-format', 'text'];
  if (env.SAYBETTER_CLAUDE_MODEL) args.push('--model', env.SAYBETTER_CLAUDE_MODEL);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claude timed out after 180s'));
    }, 180000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
}

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.SAYBETTER_GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
}

export const backends = { claude, gemini };

export function pickBackend(name = process.env.SAYBETTER_LLM || 'claude', extra = {}) {
  const all = { ...backends, ...extra };
  const fn = all[name];
  if (!fn) throw new Error(`unknown LLM backend "${name}" (use claude, gemini or fake)`);
  return fn;
}
