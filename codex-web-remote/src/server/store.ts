import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import path from "node:path";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  try {
    const [salt, key] = stored.split(":");
    const b = Buffer.from(key, "hex");
    return (
      b.length === 64 && timingSafeEqual(b, scryptSync(password, salt, 64))
    );
  } catch {
    return false;
  }
}
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = path.join(dir, "app.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    const schema = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (schema > 1) {
      this.db.close();
      throw new Error(
        "DB schema mới hơn app; dùng đúng bản build hoặc restore backup tương thích",
      );
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'unknown',turn TEXT,policy TEXT);
 CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,thread TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,result TEXT);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,thread TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_thread ON events(thread,seq);
 CREATE TABLE IF NOT EXISTS checkpoints(thread TEXT PRIMARY KEY,pruned INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS usage(thread TEXT PRIMARY KEY,at INTEGER NOT NULL,value TEXT NOT NULL); PRAGMA user_version=1; COMMIT;`);
  }
  setting(k: string) {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(k) as
        { value: string } | undefined
    )?.value;
  }
  set(k: string, v: string) {
    this.db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(k, v);
  }
  thread(id: string) {
    return this.db.prepare("SELECT * FROM threads WHERE id=?").get(id) as
      | {
          id: string;
          cwd: string;
          state: string;
          turn: string | null;
          policy: string | null;
        }
      | undefined;
  }
  state(id: string, state: string, turn: string | null = null) {
    this.db
      .prepare("UPDATE threads SET state=?,turn=? WHERE id=?")
      .run(state, turn, id);
  }
  append(thread: string, event: unknown) {
    const at = Date.now();
    const json = JSON.stringify(event);
    const r = this.db
      .prepare("INSERT INTO events(thread,at,event) VALUES(?,?,?)")
      .run(thread, at, json);
    return { seq: Number(r.lastInsertRowid), thread, at, event };
  }
  events(thread: string, after: number, limit = 500) {
    return (
      this.db
        .prepare(
          "SELECT * FROM events WHERE thread=? AND seq>? ORDER BY seq LIMIT ?",
        )
        .all(thread, after, limit) as {
        seq: number;
        thread: string;
        at: number;
        event: string;
      }[]
    ).map((r) => ({ ...r, event: JSON.parse(r.event) }));
  }
  prune(cutoff: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO checkpoints SELECT e.thread,MAX(e.seq) FROM events e WHERE e.at<? AND NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=e.thread AND t.state IN ('running','waiting_approval','waiting_input')) GROUP BY e.thread ON CONFLICT(thread) DO UPDATE SET pruned=MAX(pruned,excluded.pruned)`,
        )
        .run(cutoff);
      this.db
        .prepare(
          `DELETE FROM events WHERE at<? AND NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=events.thread AND t.state IN ('running','waiting_approval','waiting_input'))`,
        )
        .run(cutoff);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  gap(thread: string, after: number) {
    const r = this.db
      .prepare("SELECT pruned FROM checkpoints WHERE thread=?")
      .get(thread) as { pruned: number } | undefined;
    return !!r && after < r.pruned;
  }
  bytes() {
    return Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(length(CAST(event AS BLOB))),0) AS n FROM events",
          )
          .get() as { n: number }
      ).n,
    );
  }
  close() {
    this.db.close();
  }
}
