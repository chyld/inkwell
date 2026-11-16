// Database settings and the pre-upgrade snapshot (SPEC 4, 12; criterion 15).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, MigrationError, migrate, openDatabase, type DB } from '../src/server/db.js';

// The schema version this code migrates to, and a hypothetical next one for these tests.
const CURRENT = MIGRATIONS.length;
const NEXT = CURRENT + 1;

let dir: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-db-'));
  db = openDatabase(path.join(dir, 'notes.db'));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
  it('uses WAL, a 5 s busy timeout, foreign keys, and syncs every commit', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    // FULL (2): a confirmed save survives a power loss.
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
  });

  it('a process that finds another one mid-migration leaves that one’s snapshot alone', async () => {
    migrate(db, dir, MIGRATIONS);
    db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'alice', 'x', 0)");
    const snapshot = path.join(dir, 'pre-upgrade.db');
    fs.writeFileSync(snapshot, 'the first process’s snapshot');
    const v2 = { version: NEXT, name: 'next', up: (d: DB) => d.exec('CREATE TABLE v2_marker (x INTEGER)') };

    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'fixtures/hold-migration.cjs'), path.join(dir, 'notes.db'), String(NEXT)], {
      cwd: path.resolve(import.meta.dirname, '..'),
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (d) => d.toString().includes('locked') && resolve());
      child.on('error', reject);
    });
    // The other process has not committed yet, so the current version is still visible here.
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT);
    const applied = migrate(db, dir, [...MIGRATIONS, v2]);
    await new Promise((r) => child.on('close', r));

    expect(applied).toBe(0);
    expect(db.pragma('user_version', { simple: true })).toBe(NEXT);
    expect(fs.readFileSync(snapshot, 'utf8')).toBe('the first process’s snapshot');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('the snapshot it does write is the database exactly as it was before the migration', () => {
    migrate(db, dir, MIGRATIONS);
    db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'alice', 'x', 0)");
    const v2 = { version: NEXT, name: 'next', up: (d: DB) => d.exec("CREATE TABLE v2_marker (x INTEGER); DELETE FROM users") };
    expect(migrate(db, dir, [...MIGRATIONS, v2])).toBe(1);
    const snap = new Database(path.join(dir, 'pre-upgrade.db'), { readonly: true });
    expect(snap.pragma('user_version', { simple: true })).toBe(CURRENT);
    expect(snap.prepare('SELECT username FROM users').all()).toEqual([{ username: 'alice' }]);
    snap.close();
  });

  it('a database lock that cannot be obtained is reported as a migration failure', () => {
    const other = new Database(path.join(dir, 'notes.db'));
    other.exec('BEGIN IMMEDIATE');
    db.pragma('busy_timeout = 100');
    try {
      expect(() => migrate(db, dir, MIGRATIONS)).toThrow(MigrationError);
      expect(() => migrate(db, dir, MIGRATIONS)).toThrow(/database is in use/);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(db.pragma('user_version', { simple: true })).toBe(0);
  });
});

