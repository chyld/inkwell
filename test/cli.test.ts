// Acceptance criterion 15: every CLI command works against a running app;
// a failing migration leaves the database unchanged and the snapshot in place.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, HOST, makeEnv, PASSWORD, userClient, type Env } from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let env: Env;
let base: string;

function cli(args: string[], input = '', extraEnv: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/cli/notes.ts'), ...args], {
      cwd: ROOT,
      env: { ...process.env, NOTES_HOST: HOST, NOTES_DATA_DIR: env.dir, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    child.stdin.end(input);
  });
}

async function mcpList(token: string) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

beforeEach(async () => {
  env = await makeEnv();
  await env.app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(env.app.server.address() as { port: number }).port}`;
});
afterEach(async () => env.close());

describe('notes CLI against a running app', () => {
  it('user add (password typed twice), sign-in works; mismatched or short passwords are refused', async () => {
    const r = await cli(['user', 'add', 'Carol'], `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Created user "carol"');
    expect((await new Client(env).signIn('carol')).statusCode).toBe(200);
    const inbox = env.store.db.prepare("SELECT count(*) c FROM folders f JOIN users u ON u.id = f.user_id WHERE u.username = 'carol' AND f.is_inbox = 1").get();
    expect(inbox).toEqual({ c: 1 });
    const mismatch = await cli(['user', 'add', 'dave'], `${PASSWORD}\nsomething else entirely\n`);
    expect(mismatch.code).toBe(1);
    expect(mismatch.err).toMatch(/do not match/);
    const short = await cli(['user', 'add', 'dave'], 'short\nshort\n');
    expect(short.code).toBe(1);
    expect(env.store.getUserByUsername('dave')).toBeUndefined();
    expect((await cli(['user', 'add', 'carol'], `${PASSWORD}\n${PASSWORD}\n`)).code).toBe(1);
    expect((await cli(['user', 'add', 'x'], `${PASSWORD}\n${PASSWORD}\n`)).code).toBe(1);
  });

  it('user add --generate prints a working password once', async () => {
    const r = await cli(['user', 'add', 'erin', '--generate']);
    expect(r.code, r.err).toBe(0);
    const pw = /Password \(shown only once\): (\S+)/.exec(r.out)![1];
    expect(pw.length).toBeGreaterThanOrEqual(12);
    expect((await new Client(env).signIn('erin', pw)).statusCode).toBe(200);
  });

  it('user list shows created date, status, note count, storage and agent count', async () => {
    const a = await userClient(env, 'alice');
    await a.post('/api/notes', {});
    await a.post('/api/notes', {});
    env.store.addAgent('alice', 'bot');
    await env.store.createUser('bob', PASSWORD);
    env.store.setDisabled('bob', true);
    const r = await cli(['user', 'list']);
    expect(r.code, r.err).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines[0]).toMatch(/USERNAME\s+CREATED\s+STATUS\s+NOTES\s+STORAGE\s+AGENTS/);
    expect(lines.find((l) => l.startsWith('alice'))).toMatch(/alice\s+2026-01-01 00:00 UTC\s+enabled\s+2\s+[\d.]+ B?K?B?\s+1$/);
    expect(lines.find((l) => l.startsWith('bob'))).toMatch(/disabled\s+0\s+0 B\s+0$/);
  });

  it('user passwd ends sessions and sets the new password', async () => {
    const a = await userClient(env, 'alice');
    const r = await cli(['user', 'passwd', 'alice'], 'a brand new password\na brand new password\n');
    expect(r.code, r.err).toBe(0);
    expect((await a.get('/api/me')).statusCode).toBe(401);
    expect((await new Client(env).signIn('alice', PASSWORD)).statusCode).toBe(401);
    expect((await new Client(env).signIn('alice', 'a brand new password')).statusCode).toBe(200);
    expect((await cli(['user', 'passwd', 'nobody'], 'a brand new password\na brand new password\n')).code).toBe(1);
  });

  it('user disable / enable: sessions end, sign-in blocked, agents get 401', async () => {
    const a = await userClient(env, 'alice');
    const token = env.store.addAgent('alice', 'bot').token;
    expect((await mcpList(token)).status).toBe(200);
    expect((await cli(['user', 'disable', 'alice'])).code).toBe(0);
    expect((await a.get('/api/me')).statusCode).toBe(401);
    expect((await new Client(env).signIn('alice')).statusCode).toBe(401);
    expect((await mcpList(token)).status).toBe(401);
    expect((await cli(['user', 'enable', 'alice'])).code).toBe(0);
    expect((await new Client(env).signIn('alice')).statusCode).toBe(200);
    expect((await mcpList(token)).status).toBe(200);
  });

  it('user delete asks for the username and removes everything the user owns', async () => {
    const a = await userClient(env, 'alice');
    const b = await userClient(env, 'bob');
    const n = (await a.post('/api/notes', {})).json().id;
    await a.patch(`/api/notes/${n}`, { tags: ['t'] });
    await a.post('/api/folders', { name: 'F' });
    const token = env.store.addAgent('alice', 'bot').token;
    const wrong = await cli(['user', 'delete', 'alice'], 'bob\n');
    expect(wrong.code).toBe(1);
    expect(env.store.getUserByUsername('alice')).toBeDefined();
    const r = await cli(['user', 'delete', 'alice'], 'alice\n');
    expect(r.code, r.err).toBe(0);
    expect(env.store.getUserByUsername('alice')).toBeUndefined();
    for (const t of ['notes', 'folders', 'tags', 'agents', 'sessions', 'images']) {
      const row = env.store.db.prepare(`SELECT count(*) c FROM ${t} WHERE ${t === 'notes' || t === 'folders' || t === 'tags' || t === 'agents' || t === 'sessions' || t === 'images' ? 'user_id' : 'id'} NOT IN (SELECT id FROM users)`).get();
      expect(row, t).toEqual({ c: 0 });
    }
    expect(env.store.db.prepare('SELECT count(*) c FROM notes_fts').get()).toEqual({ c: 0 });
    expect((await a.get('/api/me')).statusCode).toBe(401);
    expect((await mcpList(token)).status).toBe(401);
    expect((await b.get('/api/me')).statusCode).toBe(200);
  });

  it('agent add prints a working token once with the four client configurations; list and revoke work', async () => {
    await env.store.createUser('alice', PASSWORD);
    const r = await cli(['agent', 'add', 'alice', 'Claude Code']);
    expect(r.code, r.err).toBe(0);
    const token = /\n\s+(nta_[A-Za-z0-9_-]{43})\n/.exec(r.out)![1];
    for (const client of ['Claude Code:', 'Codex', 'Grok:', 'Muse']) expect(r.out).toContain(client);
    expect(r.out).toContain(`https://${HOST}/mcp`);
    expect(r.out).toContain(`claude mcp add --transport http --scope user notes https://${HOST}/mcp --header "Authorization: Bearer ${token}"`);
    expect((await mcpList(token)).status).toBe(200);
    // Only the hash is stored.
    expect(JSON.stringify(env.store.db.prepare('SELECT * FROM agents').all())).not.toContain(token);
    expect((await cli(['agent', 'add', 'alice', 'Claude Code'])).code).toBe(1);

    const list = await cli(['agent', 'list']);
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/AGENT\s+OWNER\s+CREATED\s+LAST USED\s+NOTES\s+STATUS/);
    expect(list.out).toMatch(/Claude Code\s+alice\s+\d{4}-\d\d-\d\d \d\d:\d\d UTC\s+2026-01-01 00:00 UTC\s+0\s+active/);
    expect((await cli(['agent', 'list', 'alice'])).out).toContain('Claude Code');
    expect((await cli(['agent', 'list', 'nobody'])).code).toBe(1);

    const rev = await cli(['agent', 'revoke', 'alice', 'Claude Code']);
    expect(rev.code, rev.err).toBe(0);
    expect((await mcpList(token)).status).toBe(401);
    expect((await cli(['agent', 'list'])).out).toMatch(/Claude Code.*revoked/);
    expect((await cli(['agent', 'revoke', 'alice', 'Claude Code'])).code).toBe(1);
  });

  it('data copy writes a consistent database copy into a new directory', async () => {
    const a = await userClient(env, 'alice');
    const n = (await a.post('/api/notes', {})).json().id;
    const dest = path.join(env.dir, 'copy-1');
    const r = await cli(['data', 'copy', dest]);
    expect(r.code, r.err).toBe(0);
    const copy = new Database(path.join(dest, 'notes.db'), { readonly: true });
    expect(copy.prepare('SELECT id FROM notes').all()).toEqual([{ id: n }]);
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    copy.close();
    // Refuses an existing directory.
    expect((await cli(['data', 'copy', dest])).code).toBe(1);
  });

  it('unknown commands print usage and fail', async () => {
    const r = await cli(['frobnicate']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Usage: notes');
    expect((await cli(['--help'])).out).toContain('data copy <dir>');
  });
});

describe('migrations', () => {
  it('a failing migration exits non-zero, leaves the database unchanged and keeps the snapshot', async () => {
    const a = await userClient(env, 'alice');
    const n = (await a.post('/api/notes', {})).json().id;
    env.store.db.pragma('wal_checkpoint(TRUNCATE)');
    const before = env.store.db.prepare('SELECT * FROM notes').all();
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'test/fixtures/failing-start.ts')], {
        cwd: ROOT,
        env: { ...process.env, NOTES_HOST: HOST, NOTES_DATA_DIR: env.dir, PORT: '39871' },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code: code ?? -1, out }));
    });
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toMatch(/database migration failed, not starting: migration 999/);
    expect(env.store.db.pragma('user_version', { simple: true })).toBe(1);
    expect(env.store.db.prepare("SELECT count(*) c FROM sqlite_master WHERE name = 'half_done'").get()).toEqual({ c: 0 });
    expect(env.store.db.prepare('SELECT * FROM notes').all()).toEqual(before);
    const snap = new Database(path.join(env.dir, 'pre-upgrade.db'), { readonly: true });
    expect(snap.prepare('SELECT id FROM notes').all()).toEqual([{ id: n }]);
    expect(snap.pragma('user_version', { simple: true })).toBe(1);
    snap.close();
    expect(fs.readdirSync(env.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a fresh database is migrated after a snapshot; an up-to-date one is left alone', async () => {
    expect(fs.existsSync(path.join(env.dir, 'pre-upgrade.db'))).toBe(true);
    const { migrate } = await import('../src/server/db.js');
    const stat = fs.statSync(path.join(env.dir, 'pre-upgrade.db')).mtimeMs;
    expect(migrate(env.store.db, env.dir)).toBe(0);
    expect(fs.statSync(path.join(env.dir, 'pre-upgrade.db')).mtimeMs).toBe(stat);
  });
});
