import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SAYBETTER_DIR = process.env.SAYBETTER_HOME || path.join(os.homedir(), '.saybetter');

export function ensureDir() {
  fs.mkdirSync(SAYBETTER_DIR, { recursive: true });
}

function stamp() {
  return new Date().toTimeString().slice(0, 8); // local time, HH:MM:SS
}

export function log(msg, ...rest) {
  console.log(`[${stamp()}] ${msg}`, ...rest);
}

export function warn(msg, ...rest) {
  console.error(`[${stamp()}] ! ${msg}`, ...rest);
}

export function appendRawEvent(obj) {
  try {
    ensureDir();
    fs.appendFileSync(path.join(SAYBETTER_DIR, 'events.jsonl'), JSON.stringify({ ts: Date.now(), ...obj }) + '\n');
  } catch (err) {
    warn(`could not write raw event: ${err.message}`);
  }
}

export function appendLogMd(line) {
  try {
    ensureDir();
    fs.appendFileSync(path.join(SAYBETTER_DIR, 'log.md'), line + '\n');
  } catch (err) {
    warn(`could not write log.md: ${err.message}`);
  }
}
