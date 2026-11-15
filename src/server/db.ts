import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) =>
      db.exec(`
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  is_inbox INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX folders_sibling_name ON folders(user_id, ifnull(parent_id, ''), name_key);
CREATE UNIQUE INDEX folders_one_inbox ON folders(user_id) WHERE is_inbox = 1;
CREATE INDEX folders_parent ON folders(parent_id);
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked_at INTEGER,
  notes_created INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, name)
);
CREATE TABLE agent_calls (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  at INTEGER NOT NULL
);
CREATE INDEX agent_calls_agent_at ON agent_calls(agent_id, at);
CREATE TABLE notes (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_size INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER
);
CREATE INDEX notes_user_updated ON notes(user_id, updated_at DESC, seq DESC);
CREATE INDEX notes_folder ON notes(folder_id);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE TABLE note_tags (
  note_seq INTEGER NOT NULL REFERENCES notes(seq) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_seq, tag_id)
) WITHOUT ROWID;
CREATE INDEX note_tags_tag ON note_tags(tag_id);
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX images_user ON images(user_id);
CREATE TABLE note_images (
  note_seq INTEGER NOT NULL REFERENCES notes(seq) ON DELETE CASCADE,
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  PRIMARY KEY (note_seq, image_id)
) WITHOUT ROWID;
CREATE INDEX note_images_image ON note_images(image_id);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tags, tokenize = 'unicode61 remove_diacritics 2');
`),
  },
];

export function openDatabase(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export class MigrationError extends Error {}

/**
 * Apply pending migrations (SPEC 12). Before changing anything, write a
 * snapshot with VACUUM INTO to a temporary file in `dataDir`, then rename it
 * to `pre-upgrade.db`. All pending migrations run in one transaction; on
 * failure the transaction is rolled back and a MigrationError is thrown.
 */
export function migrate(db: DB, dataDir: string, migrations: Migration[] = MIGRATIONS, log: (msg: string) => void = () => {}): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return 0;

  const tmp = path.join(dataDir, `.pre-upgrade-${process.pid}-${Date.now()}.db.tmp`);
  const snapshot = path.join(dataDir, 'pre-upgrade.db');
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.renameSync(tmp, snapshot);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new MigrationError(`could not write the pre-upgrade snapshot: ${(e as Error).message}`);
  }
  log(`database snapshot written to ${snapshot} before migrating from version ${current}`);

  const target = pending[pending.length - 1].version;
  db.exec('BEGIN IMMEDIATE');
  let applying = pending[0];
  try {
    for (const m of pending) {
      applying = m;
      m.up(db);
    }
    db.pragma(`user_version = ${target}`);
    db.exec('COMMIT');
  } catch (e) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw new MigrationError(
      `migration ${applying.version} (${applying.name}) failed: ${(e as Error).message}. ` +
        `The database was left at version ${current}; the snapshot is ${snapshot}.`,
    );
  }
  log(`database migrated from version ${current} to ${target}`);
  return pending.length;
}
