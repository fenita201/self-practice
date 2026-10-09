import { EventEmitter } from 'node:events';
import { tx, type Db } from './db.js';

/** A message pushed to browsers. `seq` is set only for persisted (replayable) events. */
export type BusEvent = {
  channel: string; // "s:<sessionId>" | "p:<project>" | "g"
  kind: string;
  seq: number | null;
  itemKey?: string | null;
  payload: unknown;
  at: number;
};

export type StoredEvent = {
  seq: number;
  sessionId: string;
  kind: string;
  itemKey: string | null;
  payload: unknown;
  at: number;
};

export const sessionChannel = (sessionId: string) => `s:${sessionId}`;
export const projectChannel = (project: string) => `p:${project}`;
export const GLOBAL_CHANNEL = 'g';

/**
 * Persist-then-broadcast event journal. Session events are written to SQLite
 * before being emitted so a reconnecting browser can catch up from its cursor.
 * Raw stream deltas are broadcast only (ephemeral); the completed item that
 * follows them is persisted and is authoritative.
 */
export class Journal {
  private readonly bus = new EventEmitter();

  constructor(private readonly db: Db) {
    this.bus.setMaxListeners(0);
  }

  append(sessionId: string, kind: string, payload: unknown, itemKey: string | null = null): StoredEvent {
    const at = Date.now();
    const json = JSON.stringify(payload);
    const seq = tx(this.db, () => {
      if (itemKey) {
        this.db.prepare('DELETE FROM events WHERE session_id = ? AND item_key = ?').run(sessionId, itemKey);
      }
      const r = this.db
        .prepare('INSERT INTO events (session_id, kind, item_key, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, kind, itemKey, json, at);
      return Number(r.lastInsertRowid);
    });
    const ev: StoredEvent = { seq, sessionId, kind, itemKey, payload, at };
    this.emit({ channel: sessionChannel(sessionId), kind, seq, itemKey, payload, at });
    return ev;
  }

  /** Broadcast without persisting (stream deltas, file watcher notices, list refresh hints). */
  ephemeral(channel: string, kind: string, payload: unknown): void {
    this.emit({ channel, kind, seq: null, payload, at: Date.now() });
  }

  since(sessionId: string, afterSeq: number, limit = 5000): StoredEvent[] {
    const rows = this.db
      .prepare(
        'SELECT seq, session_id, kind, item_key, payload, created_at FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(sessionId, afterSeq, limit) as Array<{
      seq: number;
      session_id: string;
      kind: string;
      item_key: string | null;
      payload: string;
      created_at: number;
    }>;
    return rows.map((r) => ({
      seq: r.seq,
      sessionId: r.session_id,
      kind: r.kind,
      itemKey: r.item_key,
      payload: JSON.parse(r.payload),
      at: r.created_at,
    }));
  }

  lastSeq(sessionId: string): number {
    const row = this.db.prepare('SELECT MAX(seq) AS m FROM events WHERE session_id = ?').get(sessionId) as {
      m: number | null;
    };
    return row.m ?? 0;
  }

  subscribe(listener: (ev: BusEvent) => void): () => void {
    this.bus.on('event', listener);
    return () => this.bus.off('event', listener);
  }

  /** Delete journal rows older than the retention window. Transcripts live in Claude Code, not here. */
  prune(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const r = this.db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    return Number(r.changes);
  }

  private emit(ev: BusEvent): void {
    this.bus.emit('event', ev);
  }
}
