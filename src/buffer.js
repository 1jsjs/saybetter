// Groups utterances per conversation and flushes a window of them to `onFlush`
// after `windowMs` of silence, or as soon as `maxUtterances` have piled up.
export class UtteranceBuffer {
  constructor({ windowMs = 20000, maxUtterances = 6, onFlush }) {
    this.windowMs = windowMs;
    this.maxUtterances = maxUtterances;
    this.onFlush = onFlush;
    this.buckets = new Map(); // conversationId -> { items, timer }
    this.pending = new Set();
  }

  add(utterance) {
    const key = utterance.conversationId;
    let b = this.buckets.get(key);
    if (!b) {
      b = { items: [], timer: null };
      this.buckets.set(key, b);
    }
    b.items.push(utterance);
    if (b.timer) clearTimeout(b.timer);
    if (b.items.length >= this.maxUtterances) {
      this.flush(key);
      return;
    }
    b.timer = setTimeout(() => this.flush(key), this.windowMs);
  }

  flush(key) {
    const b = this.buckets.get(key);
    if (!b) return;
    if (b.timer) clearTimeout(b.timer);
    this.buckets.delete(key);
    if (!b.items.length) return;
    const p = Promise.resolve(this.onFlush({ conversationId: key, utterances: b.items })).catch((err) => {
      console.error(`flush failed for ${key}: ${err.message}`);
    });
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  async flushAll() {
    for (const key of [...this.buckets.keys()]) this.flush(key);
    await Promise.all([...this.pending]);
  }

  size() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.items.length;
    return n;
  }
}
