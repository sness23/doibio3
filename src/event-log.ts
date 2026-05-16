/**
 * Append-only, hash-chained event log — the single source of truth.
 *
 * Every change to the entity graph is recorded here as an immutable event.
 * The graph itself is a pure projection of this log (event sourcing): replay
 * the log and you reconstruct the graph exactly. Each event carries the hash
 * of its predecessor, so any later tampering breaks the chain and is caught
 * by `verify()` — the same integrity discipline as the planetar bus WAL.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export type EventType =
  | 'entity.created'
  | 'observation.recorded'
  | 'entities.linked';

export interface DoibioEvent {
  /** Position in the log, 0-based and gap-free. */
  seq: number;
  id: string;
  /** Ingestion time (ISO-8601). */
  ts: string;
  type: EventType;
  payload: Record<string, unknown>;
  /** Hash of the previous event, or the genesis constant for seq 0. */
  prevHash: string;
  /** SHA-256 over this event's contents. */
  hash: string;
}

const GENESIS = '0'.repeat(64);

function hashEvent(e: Omit<DoibioEvent, 'hash'>): string {
  return createHash('sha256')
    .update([e.seq, e.ts, e.type, JSON.stringify(e.payload), e.prevHash].join('\n'))
    .digest('hex');
}

export class EventLog {
  private events: DoibioEvent[] = [];

  /** Optionally persist to / restore from a JSONL file. */
  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim()) this.events.push(JSON.parse(line) as DoibioEvent);
      }
      this.verify();
    }
  }

  /** Append a new event and return the committed record. */
  append(type: EventType, payload: Record<string, unknown>): DoibioEvent {
    const prev = this.events.at(-1);
    const base = {
      seq: this.events.length,
      id: randomUUID(),
      ts: new Date().toISOString(),
      type,
      payload,
      prevHash: prev ? prev.hash : GENESIS,
    };
    const event: DoibioEvent = { ...base, hash: hashEvent(base) };
    this.events.push(event);
    if (this.file) appendFileSync(this.file, JSON.stringify(event) + '\n');
    return event;
  }

  /** Every event, in commit order. */
  all(): readonly DoibioEvent[] {
    return this.events;
  }

  /** Re-hash the whole chain; throw on the first broken or tampered link. */
  verify(): void {
    let prevHash = GENESIS;
    this.events.forEach((e, i) => {
      if (e.seq !== i) throw new Error(`event-log: sequence gap at index ${i}`);
      if (e.prevHash !== prevHash) throw new Error(`event-log: broken chain at seq ${i}`);
      const { hash, ...rest } = e;
      if (hashEvent(rest) !== hash) throw new Error(`event-log: tampered event at seq ${i}`);
      prevHash = e.hash;
    });
  }
}
