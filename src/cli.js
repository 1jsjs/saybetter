// Minimal argv parser: `cmd positional --flag value --bool --key=value`
const BOOLEAN_FLAGS = new Set(['dry-run', 'json', 'help', 'verbose']);

export function parseArgs(argv) {
  const out = { command: null, positional: [], flags: {} };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        out.flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(body) || args.length === 0 || args[0].startsWith('--')) {
        out.flags[body] = true;
      } else {
        out.flags[body] = args.shift();
      }
    } else if (out.command === null) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

export function numberFlag(flags, name, fallback) {
  const v = flags[name];
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
