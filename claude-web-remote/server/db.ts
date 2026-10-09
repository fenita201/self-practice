import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE web_sessions (
    id TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Claude sessions this instance has driven. Claude Code owns the transcript;
  -- this table only stores web-side state.
  CREATE TABLE chats (
    session_id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    state TEXT NOT NULL,
    ended_reason TEXT,
    model TEXT,
    effort TEXT,
    permission_mode TEXT,
    deadline_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX chats_project ON chats(project, updated_at);

  -- One row per prompt the browser sent; client_request_id is also the SDK user message uuid.
  CREATE TABLE submissions (
    client_request_id TEXT PRIMARY KEY,
    session_id TEXT,
    project TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX submissions_session ON submissions(session_id);

  -- Event journal. Items with item_key are upserted (delete + insert => new seq),
  -- so a cursor (seq) is enough for a client to catch up.
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_key TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX events_item ON events(session_id, item_key) WHERE item_key IS NOT NULL;
  CREATE INDEX events_session_seq ON events(session_id, seq);
  `,
];

export function openDb(dataDir: string): Db {
  const file = path.join(dataDir, 'claude-remote.sqlite');
  const isNew = !existsSync(file);
  const db = new DatabaseSync(file);
  if (isNew) chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openMemoryDb(): Db {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version++;
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
