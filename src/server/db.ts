import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const cache = new WeakMap<DB, Map<string, Database.Statement>>();
/**
 * The prepared statement for this SQL text on this connection, compiled once and reused (better-sqlite3 caches
 * nothing itself). No statement is iterated or switched to pluck/raw mode in this code, so sharing one is safe.
 */
export function stmt(db: DB, sql: string): Database.Statement {
  let m = cache.get(db);
  if (!m) cache.set(db, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = db.prepare(sql)));
  return s;
}

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
  {
    version: 2,
    name: 'fonts',
    // FONTS-SPEC 5.2 and 6: the shared font store (a cache) and each user's collection.
    up: (db) =>
      db.exec(`
CREATE TABLE font_files (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL
);
CREATE TABLE font_previews (
  font_id TEXT PRIMARY KEY,
  file TEXT NOT NULL REFERENCES font_files(hash),
  fetched_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE TABLE font_face_units (
  font_id TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE TABLE font_faces (
  font_id TEXT NOT NULL REFERENCES font_face_units(font_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  weight TEXT NOT NULL,
  style TEXT NOT NULL,
  unicode_range TEXT NOT NULL,
  file TEXT NOT NULL REFERENCES font_files(hash),
  PRIMARY KEY (font_id, seq)
) WITHOUT ROWID;
CREATE INDEX font_faces_file ON font_faces(file);
CREATE INDEX font_previews_file ON font_previews(file);
CREATE TABLE font_collection (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  font_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, font_id)
) WITHOUT ROWID;
CREATE INDEX font_collection_font ON font_collection(font_id);
`),
  },
  {
    version: 3,
    name: 'text styles',
    // STYLES-SPEC 4 and 6: each user's named bundles of text formatting.
    up: (db) =>
      db.exec(`
CREATE TABLE styles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  font TEXT,
  size INTEGER NOT NULL,
  bold INTEGER NOT NULL,
  italic INTEGER NOT NULL,
  underline INTEGER NOT NULL,
  strike INTEGER NOT NULL,
  text_color TEXT,
  highlight TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX styles_user_name ON styles(user_id, name_key);
`),
  },
];

/** `onSql`, for tests only, is told the text of every statement executed (better-sqlite3's verbose hook). */
export function openDatabase(file: string, opts: { onSql?: (sql: string) => void } = {}): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, opts.onSql ? { verbose: (sql) => opts.onSql!(String(sql)) } : {});
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  // FULL: every commit is synced, so a save the client saw confirmed survives a power loss.
  db.pragma('synchronous = FULL');
  return db;
}

export class MigrationError extends Error {}

/**
 * Apply pending migrations (SPEC 12). The write lock (BEGIN IMMEDIATE) is taken
 * first and held throughout: the version is read under it, the snapshot is
 * written under it (by VACUUM INTO on a second, read-only connection; WAL lets
 * it read while we hold the lock) and renamed to `pre-upgrade.db`, and then all
 * pending migrations run in that same transaction. So no other process (the
 * app or the CLI) can commit between the check, the snapshot and the change.
 * On failure the transaction is rolled back and a MigrationError is thrown.
 */
export function migrate(db: DB, dataDir: string, migrations: Migration[] = MIGRATIONS, log: (msg: string) => void = () => {}): number {
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  if ((db.pragma('user_version', { simple: true }) as number) >= latest) return 0;

  const snapshot = path.join(dataDir, 'pre-upgrade.db');
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (e) {
    throw new MigrationError(
      `could not lock the database to migrate it: the database is in use by another process (${(e as Error).message}). ` +
        'Nothing was changed; try again.',
    );
  }
  let now = 0;
  let todo: Migration[] = [];
  try {
    now = db.pragma('user_version', { simple: true }) as number;
    todo = migrations.filter((m) => m.version > now).sort((a, b) => a.version - b.version);
    if (todo.length === 0) {
      db.exec('COMMIT'); // another process migrated while we waited for the lock
      return 0;
    }
    const tmp = path.join(dataDir, `.pre-upgrade-${process.pid}-${Date.now()}.db.tmp`);
    try {
      const reader = new Database(db.name, { readonly: true });
      try {
        reader.prepare('VACUUM INTO ?').run(tmp);
      } finally {
        reader.close();
      }
      fs.renameSync(tmp, snapshot);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new MigrationError(`could not write the pre-upgrade snapshot: ${(e as Error).message}`);
    }
  } catch (e) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw e;
  }
  log(`database snapshot written to ${snapshot} before migrating from version ${now}`);

  const target = todo[todo.length - 1].version;
  let applying = todo[0];
  try {
    for (const m of todo) {
      applying = m;
      m.up(db);
    }
    db.pragma(`user_version = ${target}`);
    db.exec('COMMIT');
  } catch (e) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw new MigrationError(
      `migration ${applying.version} (${applying.name}) failed: ${(e as Error).message}. ` +
        `The database was left at version ${now}; the snapshot is ${snapshot}.`,
    );
  }
  log(`database migrated from version ${now} to ${target}`);
  return todo.length;
}
