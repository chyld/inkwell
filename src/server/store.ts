// The shared data-access module (SPEC 4). The web server, the MCP endpoint
// and the CLI all go through this class.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from './db.js';
import { AppError, badRequest, notFound, quotaExceeded } from './errors.js';
import { hashPassword, verifyPassword, dummyVerify } from './passwords.js';
import {
  EMPTY_DOC,
  MAX_TITLE_CHARS,
  TAGS_PER_NOTE,
  charLength,
  normalizeTag,
  validateBody,
  NoteValidationError,
  utf8Length,
  type ValidatedBody,
} from '../shared/schema.js';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 90 * DAY;
export const FOLDER_MAX_DEPTH = 10;
export const PAGE_SIZE = 50;
export const IMAGE_GRACE_MS = DAY;

export interface StoreOptions {
  dataDir: string;
  userQuotaBytes: number;
  agentRatePerHour: number;
  now?: () => number;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  disabled: number;
  created_at: number;
}

export interface AgentAuth {
  agentId: string;
  agentName: string;
  userId: string;
}

interface NoteRow {
  seq: number;
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  body: string;
  body_text: string;
  body_size: number;
  version: number;
  agent_name: string | null;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

interface FolderRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  name_key: string;
  is_inbox: number;
  created_at: number;
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  isInbox: boolean;
  noteCount: number;
  children: FolderNode[];
}

export type NoteView = 'all' | 'inbox' | 'folder' | 'unfiled' | 'tag' | 'trash';

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function checkUsername(username: string): string | null {
  return USERNAME_RE.test(username) ? null : 'Username must be 3-32 characters: a-z, 0-9, "-" or "_".';
}

function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw badRequest('Title must be a string.');
  const t = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[\r\n\t]+/g, ' ');
  if (charLength(t) > MAX_TITLE_CHARS) throw badRequest(`Title must be at most ${MAX_TITLE_CHARS} characters.`);
  return t;
}

function folderName(raw: unknown): { name: string; key: string } {
  if (typeof raw !== 'string') throw badRequest('Folder name must be a string.');
  const name = raw.trim();
  if (name.length === 0 || charLength(name) > 100) throw badRequest('Folder name must be 1-100 characters.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw badRequest('Folder name contains characters that are not allowed.');
  return { name, key: name.toLowerCase() };
}

export function normalizeTags(raw: unknown, max = TAGS_PER_NOTE): string[] {
  if (!Array.isArray(raw)) throw badRequest('Tags must be a list.');
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t === null) throw badRequest('Each tag must be 1-50 characters with no commas.');
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > max) throw badRequest(`A note can have at most ${max} tags.`);
  return out;
}

function snippetOf(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function encodeCursor(updatedAt: number, seq: number) {
  return Buffer.from(`${updatedAt}.${seq}`).toString('base64url');
}
function decodeCursor(c: string): [number, number] {
  const m = /^(\d+)\.(\d+)$/.exec(Buffer.from(c, 'base64url').toString());
  if (!m) throw badRequest('Invalid cursor.');
  return [Number(m[1]), Number(m[2])];
}

/** Build the FTS5 MATCH expression exactly as SPEC 7.3 describes. */
export function buildFtsQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const pieces = input.split(/\s+/).filter((p) => p.length > 0);
  if (pieces.length === 0) return null;
  return pieces.map((p, i) => `"${p.replaceAll('"', '""')}"${i === pieces.length - 1 ? '*' : ''}`).join(' ');
}

export class Store {
  readonly now: () => number;
  readonly imagesDir: string;
  readonly tmpDir: string;

  constructor(
    readonly db: DB,
    readonly opts: StoreOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.imagesDir = path.join(opts.dataDir, 'images');
    this.tmpDir = path.join(opts.dataDir, 'tmp');
  }

  /** Run fn in one BEGIN IMMEDIATE transaction. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  // ---- users -----------------------------------------------------------

  getUserByUsername(raw: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(raw)) as UserRow | undefined;
  }

  getUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  requireUser(raw: string): UserRow {
    const u = this.getUserByUsername(raw);
    if (!u) throw new AppError(404, 'no_such_user', `No user named "${normalizeUsername(raw)}".`);
    return u;
  }

  async createUser(rawUsername: string, password: string): Promise<UserRow> {
    const username = normalizeUsername(rawUsername);
    const err = checkUsername(username);
    if (err) throw badRequest(err);
    const hash = await hashPassword(password);
    const now = this.now();
    const id = crypto.randomUUID();
    return this.tx(() => {
      if (this.getUserByUsername(username)) throw new AppError(409, 'user_exists', `User "${username}" already exists.`);
      this.db.prepare('INSERT INTO users (id, username, password_hash, disabled, created_at) VALUES (?, ?, ?, 0, ?)').run(id, username, hash, now);
      this.db
        .prepare("INSERT INTO folders (id, user_id, parent_id, name, name_key, is_inbox, created_at) VALUES (?, ?, NULL, 'Inbox', 'inbox', 1, ?)")
        .run(crypto.randomUUID(), id, now);
      return this.getUser(id)!;
    });
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT u.username, u.created_at, u.disabled,
           (SELECT count(*) FROM notes n WHERE n.user_id = u.id) AS note_count,
           (SELECT count(*) FROM agents a WHERE a.user_id = u.id AND a.revoked_at IS NULL) AS agent_count,
           u.id
         FROM users u ORDER BY u.username`,
      )
      .all()
      .map((r: any) => ({
        username: r.username as string,
        createdAt: iso(r.created_at),
        disabled: !!r.disabled,
        noteCount: r.note_count as number,
        storageUsed: this.usage(r.id),
        agentCount: r.agent_count as number,
      }));
  }

  async setPassword(rawUsername: string, password: string): Promise<void> {
    const user = this.requireUser(rawUsername);
    const hash = await hashPassword(password);
    this.tx(() => {
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
  }

  setDisabled(rawUsername: string, disabled: boolean): void {
    const user = this.requireUser(rawUsername);
    this.tx(() => {
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
      if (disabled) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
  }

  deleteUser(rawUsername: string): void {
    const user = this.requireUser(rawUsername);
    this.tx(() => {
      this.db.prepare('DELETE FROM notes_fts WHERE rowid IN (SELECT seq FROM notes WHERE user_id = ?)').run(user.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      this.db.prepare('DELETE FROM notes WHERE user_id = ?').run(user.id);
      // Folders: children before parents (cascade handles it, but be explicit about order-independence).
      this.db.prepare('DELETE FROM folders WHERE user_id = ?').run(user.id);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    // A running data copy may still need these files; the copy removes the directory when it ends.
    if (!this.copyInProgress()) fs.rmSync(path.join(this.imagesDir, user.id), { recursive: true, force: true });
  }

  /** Check a username/password. Returns the user only if enabled and the password matches. */
  async checkCredentials(rawUsername: string, password: string): Promise<UserRow | null> {
    const user = typeof password === 'string' ? this.getUserByUsername(rawUsername) : undefined;
    if (!user || typeof password !== 'string' || password.length > 1024) {
      await dummyVerify(typeof password === 'string' ? password.slice(0, 1024) : '');
      return null;
    }
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok || user.disabled) return null;
    return user;
  }

  usage(userId: string): number {
    const r = this.db
      .prepare(
        `SELECT (SELECT ifnull(sum(body_size), 0) FROM notes WHERE user_id = ?) +
                (SELECT ifnull(sum(size), 0) FROM images WHERE user_id = ?) AS used`,
      )
      .get(userId, userId) as { used: number };
    return r.used;
  }

  private assertQuota(userId: string, delta: number) {
    if (delta <= 0) return;
    if (this.usage(userId) + delta > this.opts.userQuotaBytes) throw quotaExceeded();
  }

  // ---- sessions --------------------------------------------------------

  createSession(userId: string): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.now();
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now);
    return token;
  }

  /** Returns the user for a valid session, deleting expired ones (SPEC 5). */
  authenticateSession(token: string | undefined): UserRow | null {
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const row = this.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(hash) as
      | { id_hash: string; user_id: string; created_at: number; last_used: number }
      | undefined;
    if (!row) return null;
    const now = this.now();
    if (now - row.last_used > SESSION_IDLE_MS || now - row.created_at > SESSION_MAX_MS) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    const user = this.getUser(row.user_id);
    if (!user || user.disabled) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    if (now - row.last_used > HOUR) this.db.prepare('UPDATE sessions SET last_used = ? WHERE id_hash = ?').run(now, hash);
    return user;
  }

  /**
   * Create a session for a user whose password was just verified against `user.password_hash`,
   * unless the password changed or the user was disabled meanwhile. Returns null in that case.
   */
  createSessionIfUnchanged(user: UserRow): string | null {
    return this.tx(() => {
      const now = this.getUser(user.id);
      if (!now || now.disabled || now.password_hash !== user.password_hash) return null;
      return this.createSession(user.id);
    });
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  }

  purgeExpiredSessions(): number {
    const now = this.now();
    return this.db.prepare('DELETE FROM sessions WHERE last_used < ? OR created_at < ?').run(now - SESSION_IDLE_MS, now - SESSION_MAX_MS).changes;
  }

  // ---- agents ----------------------------------------------------------

  addAgent(rawUsername: string, rawName: string): { token: string; name: string; username: string } {
    const user = this.requireUser(rawUsername);
    const name = String(rawName ?? '').trim();
    if (name.length === 0 || charLength(name) > 50 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw badRequest('Agent name must be 1-50 characters.');
    }
    const token = 'nta_' + crypto.randomBytes(32).toString('base64url');
    this.tx(() => {
      const existing = this.db.prepare('SELECT revoked_at FROM agents WHERE user_id = ? AND name = ?').get(user.id, name) as
        | { revoked_at: number | null }
        | undefined;
      if (existing) {
        throw new AppError(
          409,
          'agent_exists',
          existing.revoked_at !== null
            ? `User "${user.username}" had an agent named "${name}"; it is revoked and keeps its name in "agent list". Choose another name, for example "${name} 2".`
            : `User "${user.username}" already has an agent named "${name}". Choose another name.`,
        );
      }
      this.db
        .prepare('INSERT INTO agents (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), user.id, name, sha256(token), this.now());
    });
    return { token, name, username: user.username };
  }

  listAgents(rawUsername?: string) {
    const user = rawUsername ? this.requireUser(rawUsername) : null;
    const rows = this.db
      .prepare(
        `SELECT a.name, u.username, a.created_at, a.last_used, a.notes_created, a.revoked_at
         FROM agents a JOIN users u ON u.id = a.user_id
         ${user ? 'WHERE a.user_id = ?' : ''} ORDER BY u.username, a.name`,
      )
      .all(...(user ? [user.id] : [])) as any[];
    return rows.map((r) => ({
      name: r.name as string,
      owner: r.username as string,
      createdAt: iso(r.created_at),
      lastUsed: iso(r.last_used),
      notesCreated: r.notes_created as number,
      revoked: r.revoked_at !== null,
    }));
  }

  revokeAgent(rawUsername: string, name: string): void {
    const user = this.requireUser(rawUsername);
    const r = this.db.prepare('UPDATE agents SET revoked_at = ? WHERE user_id = ? AND name = ? AND revoked_at IS NULL').run(this.now(), user.id, name);
    if (r.changes === 0) {
      const exists = this.db.prepare('SELECT 1 FROM agents WHERE user_id = ? AND name = ?').get(user.id, name);
      throw new AppError(404, 'no_such_agent', exists ? `Agent "${name}" is already revoked.` : `User "${user.username}" has no agent named "${name}".`);
    }
  }

  /** Valid only for an existing, unrevoked token whose user is enabled. */
  authenticateAgent(token: string | undefined): AgentAuth | null {
    if (!token || !token.startsWith('nta_') || token.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT a.id, a.name, a.user_id, a.last_used FROM agents a JOIN users u ON u.id = a.user_id
         WHERE a.token_hash = ? AND a.revoked_at IS NULL AND u.disabled = 0`,
      )
      .get(sha256(token)) as { id: string; name: string; user_id: string; last_used: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.last_used === null || now - row.last_used > 60_000) this.db.prepare('UPDATE agents SET last_used = ? WHERE id = ?').run(now, row.id);
    return { agentId: row.id, agentName: row.name, userId: row.user_id };
  }

  // ---- folders ---------------------------------------------------------

  private folderRows(userId: string): FolderRow[] {
    return this.db.prepare('SELECT * FROM folders WHERE user_id = ?').all(userId) as FolderRow[];
  }

  inboxId(userId: string): string {
    const r = this.db.prepare('SELECT id FROM folders WHERE user_id = ? AND is_inbox = 1').get(userId) as { id: string };
    return r.id;
  }

  private ownFolder(userId: string, id: unknown): FolderRow {
    if (typeof id !== 'string') throw notFound('Folder not found.');
    const f = this.db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as FolderRow | undefined;
    if (!f) throw notFound('Folder not found.');
    return f;
  }

  private depthOf(rows: Map<string, FolderRow>, id: string | null): number {
    let d = 0;
    let cur = id;
    while (cur) {
      d++;
      cur = rows.get(cur)?.parent_id ?? null;
      if (d > 1000) break;
    }
    return d;
  }

  private subtreeHeight(rows: FolderRow[], id: string): number {
    const kids = rows.filter((r) => r.parent_id === id);
    return 1 + (kids.length ? Math.max(...kids.map((k) => this.subtreeHeight(rows, k.id))) : 0);
  }

  listFolders(userId: string): FolderNode[] {
    const rows = this.folderRows(userId);
    const counts = new Map(
      (
        this.db.prepare('SELECT folder_id, count(*) c FROM notes WHERE user_id = ? AND trashed_at IS NULL AND folder_id IS NOT NULL GROUP BY folder_id').all(userId) as {
          folder_id: string;
          c: number;
        }[]
      ).map((r) => [r.folder_id, r.c]),
    );
    const nodes = new Map<string, FolderNode>();
    for (const r of rows)
      nodes.set(r.id, { id: r.id, name: r.name, parentId: r.parent_id, isInbox: !!r.is_inbox, noteCount: counts.get(r.id) ?? 0, children: [] });
    const roots: FolderNode[] = [];
    for (const n of nodes.values()) (n.parentId ? nodes.get(n.parentId)!.children : roots).push(n);
    const sort = (list: FolderNode[]) => {
      list.sort((a, b) => (a.isInbox !== b.isInbox ? (a.isInbox ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
      list.forEach((n) => sort(n.children));
    };
    sort(roots);
    return roots;
  }

  createFolder(userId: string, rawName: unknown, parentId: unknown): FolderNode {
    const { name, key } = folderName(rawName);
    return this.tx(() => {
      let parent: FolderRow | null = null;
      if (parentId !== null && parentId !== undefined) {
        parent = this.ownFolder(userId, parentId);
        if (parent.is_inbox) throw badRequest('Inbox cannot have subfolders.', 'inbox_protected');
        const rows = new Map(this.folderRows(userId).map((r) => [r.id, r]));
        if (this.depthOf(rows, parent.id) + 1 > FOLDER_MAX_DEPTH) throw badRequest(`Folders can be nested at most ${FOLDER_MAX_DEPTH} deep.`, 'too_deep');
      }
      this.assertSiblingFree(userId, parent?.id ?? null, key, null);
      const id = crypto.randomUUID();
      this.db
        .prepare('INSERT INTO folders (id, user_id, parent_id, name, name_key, is_inbox, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
        .run(id, userId, parent?.id ?? null, name, key, this.now());
      return { id, name, parentId: parent?.id ?? null, isInbox: false, noteCount: 0, children: [] };
    });
  }

  private assertSiblingFree(userId: string, parentId: string | null, key: string, exceptId: string | null) {
    const clash = this.db
      .prepare("SELECT id FROM folders WHERE user_id = ? AND ifnull(parent_id, '') = ? AND name_key = ? AND id != ?")
      .get(userId, parentId ?? '', key, exceptId ?? '');
    if (clash) throw new AppError(409, 'name_taken', 'A folder with that name already exists here.');
  }

  updateFolder(userId: string, id: unknown, changes: { name?: unknown; parentId?: unknown }): void {
    this.tx(() => {
      const f = this.ownFolder(userId, id);
      if (f.is_inbox) throw badRequest('Inbox cannot be renamed or moved.', 'inbox_protected');
      let name = f.name;
      let key = f.name_key;
      let parentId = f.parent_id;
      if (changes.name !== undefined) ({ name, key } = folderName(changes.name));
      if (changes.parentId !== undefined) {
        if (changes.parentId === null) parentId = null;
        else {
          const p = this.ownFolder(userId, changes.parentId);
          if (p.is_inbox) throw badRequest('Inbox cannot have subfolders.', 'inbox_protected');
          const all = this.folderRows(userId);
          const rows = new Map(all.map((r) => [r.id, r]));
          // Not into itself or one of its descendants.
          for (let cur: string | null = p.id; cur; cur = rows.get(cur)?.parent_id ?? null) {
            if (cur === f.id) throw badRequest('A folder cannot be moved into itself or one of its subfolders.', 'invalid_move');
          }
          if (this.depthOf(rows, p.id) + this.subtreeHeight(all, f.id) > FOLDER_MAX_DEPTH) {
            throw badRequest(`Folders can be nested at most ${FOLDER_MAX_DEPTH} deep.`, 'too_deep');
          }
          parentId = p.id;
        }
      }
      this.assertSiblingFree(userId, parentId, key, f.id);
      this.db.prepare('UPDATE folders SET name = ?, name_key = ?, parent_id = ? WHERE id = ?').run(name, key, parentId, f.id);
    });
  }

  deleteFolder(userId: string, id: unknown): void {
    this.tx(() => {
      const f = this.ownFolder(userId, id);
      if (f.is_inbox) throw badRequest('Inbox cannot be deleted.', 'inbox_protected');
      if (this.db.prepare('SELECT 1 FROM folders WHERE parent_id = ?').get(f.id)) {
        throw new AppError(409, 'folder_not_empty', 'Only an empty folder can be deleted. This one has subfolders.');
      }
      if (this.db.prepare('SELECT 1 FROM notes WHERE folder_id = ? AND trashed_at IS NULL').get(f.id)) {
        throw new AppError(409, 'folder_not_empty', 'Only an empty folder can be deleted. This one has notes.');
      }
      this.db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(f.id);
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
    });
  }

  // ---- notes -----------------------------------------------------------

  private ownNote(userId: string, id: unknown): NoteRow {
    if (typeof id !== 'string') throw notFound('Note not found.');
    const n = this.db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as NoteRow | undefined;
    if (!n) throw notFound('Note not found.');
    return n;
  }

  private tagsOf(seq: number): string[] {
    return (this.db.prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_seq = ? ORDER BY t.name').all(seq) as { name: string }[]).map(
      (r) => r.name,
    );
  }

  private syncFts(seq: number) {
    this.db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(seq);
    const n = this.db.prepare('SELECT title, body_text, trashed_at FROM notes WHERE seq = ?').get(seq) as
      | { title: string; body_text: string; trashed_at: number | null }
      | undefined;
    if (!n || n.trashed_at !== null) return;
    this.db.prepare('INSERT INTO notes_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)').run(seq, n.title, n.body_text, this.tagsOf(seq).join(' '));
  }

  private setTags(userId: string, seq: number, tags: string[]) {
    this.db.prepare('DELETE FROM note_tags WHERE note_seq = ?').run(seq);
    for (const t of tags) {
      this.db.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?) ON CONFLICT (user_id, name) DO NOTHING').run(userId, t);
      const tag = this.db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, t) as { id: number };
      this.db.prepare('INSERT INTO note_tags (note_seq, tag_id) VALUES (?, ?)').run(seq, tag.id);
    }
    this.gcTags(userId);
  }

  private gcTags(userId: string) {
    this.db.prepare('DELETE FROM tags WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)').run(userId);
  }

  private assertImagesOwned(userId: string, ids: string[]) {
    const q = this.db.prepare('SELECT 1 FROM images WHERE id = ? AND user_id = ?');
    const missing = ids.filter((id) => !q.get(id, userId));
    if (missing.length) {
      throw new AppError(
        400,
        'image_missing',
        `The note refers to ${missing.length === 1 ? 'an image that no longer exists' : `${missing.length} images that no longer exist`} ` +
          '(an image that no note uses is removed after 24 hours). Remove it from the note to save.',
        { images: missing },
      );
    }
  }

  private setImageLinks(seq: number, ids: string[]) {
    this.db.prepare('DELETE FROM note_images WHERE note_seq = ?').run(seq);
    const ins = this.db.prepare('INSERT INTO note_images (note_seq, image_id) VALUES (?, ?)');
    for (const id of ids) ins.run(seq, id);
  }

  private noteOut(n: NoteRow) {
    return {
      id: n.id,
      title: n.title,
      body: JSON.parse(n.body),
      version: n.version,
      folderId: n.folder_id,
      tags: this.tagsOf(n.seq),
      createdAt: iso(n.created_at),
      updatedAt: iso(n.updated_at),
      trashedAt: iso(n.trashed_at),
      origin: n.agent_name === null ? { type: 'user' as const } : { type: 'agent' as const, name: n.agent_name },
    };
  }

  getNote(userId: string, id: unknown) {
    return this.noteOut(this.ownNote(userId, id));
  }

  createNote(userId: string, folderId: unknown) {
    const body = validateBody(EMPTY_DOC);
    return this.tx(() => {
      let folder: string | null = null;
      if (folderId !== null && folderId !== undefined) folder = this.ownFolder(userId, folderId).id;
      this.assertQuota(userId, body.bytes);
      const now = this.now();
      const id = crypto.randomUUID();
      const r = this.db
        .prepare(
          `INSERT INTO notes (id, user_id, folder_id, title, body, body_text, body_size, version, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, userId, folder, body.serialized, body.text, body.bytes, now, now);
      this.syncFts(Number(r.lastInsertRowid));
      return this.getNote(userId, id);
    });
  }

  /** Validate a body that will belong to `userId`. Throws AppError 400. */
  validateUserBody(raw: unknown): ValidatedBody {
    try {
      return validateBody(raw);
    } catch (e) {
      if (e instanceof NoteValidationError) throw badRequest(`The note body is not valid: ${e.message}`, 'invalid_body');
      throw e;
    }
  }

  /** Save title and body against the version the client last received (SPEC 6.3). */
  saveNote(userId: string, id: unknown, input: { title: unknown; body: unknown; version: unknown }) {
    const title = cleanTitle(input.title);
    if (!Number.isInteger(input.version)) throw badRequest('version must be an integer.');
    const body = this.validateUserBody(input.body);
    return this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at !== null) throw new AppError(409, 'in_trash', 'This note is in Trash and cannot be edited.');
      if (n.version !== input.version) {
        throw new AppError(409, 'version_conflict', 'This note was changed somewhere else.', { version: n.version });
      }
      this.assertImagesOwned(userId, body.imageIds);
      this.assertQuota(userId, body.bytes - n.body_size);
      const now = this.now();
      const version = n.version + 1;
      this.db
        .prepare('UPDATE notes SET title = ?, body = ?, body_text = ?, body_size = ?, version = ?, updated_at = ? WHERE seq = ?')
        .run(title, body.serialized, body.text, body.bytes, version, now, n.seq);
      this.setImageLinks(n.seq, body.imageIds);
      this.syncFts(n.seq);
      return { version, updatedAt: iso(now) };
    });
  }

  /** Folder and tag changes: no version check, last request wins. */
  patchNote(userId: string, id: unknown, changes: { folderId?: unknown; tags?: unknown }) {
    const tags = changes.tags !== undefined ? normalizeTags(changes.tags) : undefined;
    return this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at !== null) throw new AppError(409, 'in_trash', 'This note is in Trash and cannot be changed.');
      if (changes.folderId !== undefined) {
        const folder = changes.folderId === null ? null : this.ownFolder(userId, changes.folderId).id;
        this.db.prepare('UPDATE notes SET folder_id = ? WHERE seq = ?').run(folder, n.seq);
      }
      if (tags) {
        this.setTags(userId, n.seq, tags);
        this.syncFts(n.seq);
      }
      const after = this.ownNote(userId, n.id);
      return { folderId: after.folder_id, tags: this.tagsOf(n.seq) };
    });
  }

  trashNote(userId: string, id: unknown) {
    this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at !== null) return;
      this.db.prepare('UPDATE notes SET trashed_at = ? WHERE seq = ?').run(this.now(), n.seq);
      this.syncFts(n.seq);
    });
  }

  restoreNote(userId: string, id: unknown) {
    this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at === null) return;
      // folder_id is already NULL if the folder was deleted (ON DELETE SET NULL / deleteFolder).
      this.db.prepare('UPDATE notes SET trashed_at = NULL WHERE seq = ?').run(n.seq);
      this.syncFts(n.seq);
    });
  }

  /** Permanently delete one trashed note. */
  deleteNote(userId: string, id: unknown) {
    this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at === null) throw new AppError(409, 'not_in_trash', 'Only a note in Trash can be deleted permanently.');
      this.db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(n.seq);
      this.db.prepare('DELETE FROM notes WHERE seq = ?').run(n.seq);
      this.gcTags(userId);
    });
  }

  emptyTrash(userId: string): string[] {
    return this.tx(() => {
      const ids = (this.db.prepare('SELECT id FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').all(userId) as { id: string }[]).map((r) => r.id);
      this.db.prepare('DELETE FROM notes_fts WHERE rowid IN (SELECT seq FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL)').run(userId);
      this.db.prepare('DELETE FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').run(userId);
      this.gcTags(userId);
      return ids;
    });
  }

  private listItems(rows: (NoteRow & { snippet_src?: string })[]) {
    const tags = new Map<number, string[]>();
    if (rows.length) {
      const q = this.db.prepare(
        `SELECT nt.note_seq, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_seq IN (${rows.map(() => '?').join(',')}) ORDER BY t.name`,
      );
      for (const r of q.all(...rows.map((r) => r.seq)) as { note_seq: number; name: string }[]) {
        if (!tags.has(r.note_seq)) tags.set(r.note_seq, []);
        tags.get(r.note_seq)!.push(r.name);
      }
    }
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      snippet: snippetOf(n.snippet_src ?? n.body_text ?? ''),
      folderId: n.folder_id,
      tags: tags.get(n.seq) ?? [],
      createdAt: iso(n.created_at),
      updatedAt: iso(n.updated_at),
      trashedAt: iso(n.trashed_at),
      origin: n.agent_name === null ? { type: 'user' as const } : { type: 'agent' as const, name: n.agent_name },
    }));
  }

  listNotes(userId: string, q: { view?: unknown; folder?: unknown; tag?: unknown; cursor?: unknown }) {
    const view = (q.view ?? 'all') as NoteView;
    const where: string[] = ['n.user_id = ?'];
    const args: unknown[] = [userId];
    switch (view) {
      case 'all':
        where.push('n.trashed_at IS NULL');
        break;
      case 'inbox':
        where.push('n.trashed_at IS NULL', 'n.folder_id = ?');
        args.push(this.inboxId(userId));
        break;
      case 'folder':
        where.push('n.trashed_at IS NULL', 'n.folder_id = ?');
        args.push(this.ownFolder(userId, q.folder).id);
        break;
      case 'unfiled':
        where.push('n.trashed_at IS NULL', 'n.folder_id IS NULL');
        break;
      case 'tag': {
        const t = normalizeTag(q.tag);
        if (t === null) throw badRequest('Invalid tag.');
        where.push('n.trashed_at IS NULL', 'EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_seq = n.seq AND t.name = ?)');
        args.push(t);
        break;
      }
      case 'trash':
        where.push('n.trashed_at IS NOT NULL');
        break;
      default:
        throw badRequest('Unknown view.');
    }
    if (typeof q.cursor === 'string' && q.cursor) {
      const [u, s] = decodeCursor(q.cursor);
      where.push('(n.updated_at < ? OR (n.updated_at = ? AND n.seq < ?))');
      args.push(u, u, s);
    }
    const rows = this.db
      .prepare(
        `SELECT n.seq, n.id, n.title, substr(n.body_text, 1, 400) AS body_text, n.folder_id, n.agent_name, n.created_at, n.updated_at, n.trashed_at
         FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC, n.seq DESC LIMIT ?`,
      )
      .all(...args, PAGE_SIZE + 1) as NoteRow[];
    const more = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    return { notes: this.listItems(page), nextCursor: more && last ? encodeCursor(last.updated_at, last.seq) : null };
  }

  // ---- tags & search ---------------------------------------------------

  listTags(userId: string) {
    return this.db
      .prepare(
        `SELECT t.name, count(*) AS count FROM tags t JOIN note_tags nt ON nt.tag_id = t.id JOIN notes n ON n.seq = nt.note_seq
         WHERE t.user_id = ? AND n.trashed_at IS NULL GROUP BY t.id ORDER BY t.name`,
      )
      .all(userId) as { name: string; count: number }[];
  }

  search(userId: string, input: { query?: unknown; folderId?: unknown; tag?: unknown; unfiled?: unknown }) {
    const match = buildFtsQuery(input.query);
    if (match === null) return { results: [] };
    const where = ['notes_fts MATCH ?', 'n.user_id = ?', 'n.trashed_at IS NULL'];
    const args: unknown[] = [match, userId];
    let cte = '';
    if (input.folderId !== undefined && input.folderId !== null) {
      const f = this.ownFolder(userId, input.folderId);
      cte = 'WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id) ';
      args.unshift(f.id);
      where.push('n.folder_id IN (SELECT id FROM sub)');
    }
    if (input.unfiled === true) where.push('n.folder_id IS NULL');
    if (input.tag !== undefined && input.tag !== null) {
      const t = normalizeTag(input.tag);
      if (t === null) throw badRequest('Invalid tag.');
      where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_seq = n.seq AND t.name = ?)');
      args.push(t);
    }
    const rows = this.db
      .prepare(
        `${cte}SELECT n.seq, n.id, n.title, n.folder_id, n.agent_name, n.created_at, n.updated_at, n.trashed_at,
           snippet(notes_fts, 1, '', '', '…', 24) AS snippet_src, substr(n.body_text, 1, 400) AS body_text
         FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid
         WHERE ${where.join(' AND ')}
         ORDER BY bm25(notes_fts, 10.0, 1.0, 4.0) LIMIT 50`,
      )
      .all(...args) as (NoteRow & { snippet_src: string })[];
    for (const r of rows) if (!r.snippet_src) r.snippet_src = r.body_text;
    return { results: this.listItems(rows) };
  }

  // ---- agent notes -----------------------------------------------------

  createAgentNote(agent: AgentAuth, input: { title: string; body: ValidatedBody; tags: string[] }) {
    return this.tx(() => {
      const now = this.now();
      // Re-check the agent inside the transaction: it may have been revoked a moment ago.
      const live = this.db
        .prepare('SELECT 1 FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND a.revoked_at IS NULL AND u.disabled = 0')
        .get(agent.agentId);
      if (!live) throw new AppError(401, 'unauthorized', 'This agent token is no longer valid.');
      const calls = this.db.prepare('SELECT count(*) AS c FROM agent_calls WHERE agent_id = ? AND at > ?').get(agent.agentId, now - HOUR) as { c: number };
      if (calls.c >= this.opts.agentRatePerHour) {
        throw new AppError(429, 'rate_limited', `Rate limit reached: at most ${this.opts.agentRatePerHour} notes per hour for this agent. Try again later.`);
      }
      this.assertImagesOwned(agent.userId, input.body.imageIds);
      this.assertQuota(agent.userId, input.body.bytes);
      const id = crypto.randomUUID();
      const r = this.db
        .prepare(
          `INSERT INTO notes (id, user_id, folder_id, title, body, body_text, body_size, version, agent_id, agent_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(id, agent.userId, this.inboxId(agent.userId), input.title, input.body.serialized, input.body.text, input.body.bytes, agent.agentId, agent.agentName, now, now);
      const seq = Number(r.lastInsertRowid);
      this.setTags(agent.userId, seq, input.tags);
      this.setImageLinks(seq, input.body.imageIds);
      this.syncFts(seq);
      this.db.prepare('DELETE FROM agent_calls WHERE agent_id = ? AND at <= ?').run(agent.agentId, now - HOUR);
      this.db.prepare('INSERT INTO agent_calls (agent_id, at) VALUES (?, ?)').run(agent.agentId, now);
      this.db.prepare('UPDATE agents SET notes_created = notes_created + 1, last_used = ? WHERE id = ?').run(now, agent.agentId);
      return { id };
    });
  }

  // ---- images (rows; files are handled by images.ts) -------------------

  insertImageRow(userId: string, id: string, mime: string, size: number) {
    this.tx(() => {
      this.assertQuota(userId, size);
      this.db.prepare('INSERT INTO images (id, user_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, mime, size, this.now());
    });
  }

  deleteImageRow(id: string) {
    this.db.prepare('DELETE FROM images WHERE id = ?').run(id);
  }

  getImage(userId: string, id: unknown): { id: string; user_id: string; mime: string; size: number } {
    if (typeof id !== 'string') throw notFound();
    const r = this.db.prepare('SELECT id, user_id, mime, size FROM images WHERE id = ? AND user_id = ?').get(id, userId) as any;
    if (!r) throw notFound();
    return r;
  }

  imagePath(userId: string, id: string) {
    return path.join(this.imagesDir, userId, id);
  }

  /**
   * Delete images older than 24 hours that no note of their owner (Trash
   * included) references. Row first, then file.
   */
  cleanupImages(): number {
    const cutoff = this.now() - IMAGE_GRACE_MS;
    const victims = this.db
      .prepare('SELECT id, user_id FROM images i WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM note_images ni WHERE ni.image_id = i.id)')
      .all(cutoff) as { id: string; user_id: string }[];
    let n = 0;
    for (const v of victims) {
      const removed = this.tx(() => {
        // While `data copy` runs (in this or another process), deleting is postponed to a later
        // clean-up, so no image the copy's snapshot refers to disappears. Checked inside the
        // transaction: see dataCopy for why that closes the race.
        if (this.copyInProgress()) return false;
        // Re-check inside the transaction in case a save linked it meanwhile.
        const still = this.db.prepare('SELECT 1 FROM note_images WHERE image_id = ?').get(v.id);
        if (still) return false;
        return this.db.prepare('DELETE FROM images WHERE id = ?').run(v.id).changes > 0;
      });
      if (removed) {
        n++;
        try {
          fs.rmSync(this.imagePath(v.user_id, v.id), { force: true });
        } catch {
          // The row is gone; a file that cannot be removed now is removed by the
          // start-up reconciliation (files without a row).
        }
      }
    }
    return n;
  }

  /** Start-up reconciliation: temp files, files without rows, rows without files. */
  reconcileImageFiles(): { tmp: number; orphanFiles: number; orphanRows: number } {
    let tmp = 0;
    let orphanFiles = 0;
    let orphanRows = 0;
    fs.mkdirSync(this.tmpDir, { recursive: true });
    fs.mkdirSync(this.imagesDir, { recursive: true });
    for (const f of fs.readdirSync(this.tmpDir)) {
      fs.rmSync(path.join(this.tmpDir, f), { recursive: true, force: true });
      tmp++;
    }
    const has = this.db.prepare('SELECT 1 FROM images WHERE id = ? AND user_id = ?');
    for (const userDir of fs.readdirSync(this.imagesDir)) {
      const dir = path.join(this.imagesDir, userDir);
      if (!fs.statSync(dir).isDirectory()) {
        fs.rmSync(dir, { force: true });
        orphanFiles++;
        continue;
      }
      for (const f of fs.readdirSync(dir)) {
        if (!has.get(f, userDir)) {
          fs.rmSync(path.join(dir, f), { recursive: true, force: true });
          orphanFiles++;
        }
      }
    }
    for (const r of this.db.prepare('SELECT id, user_id FROM images').all() as { id: string; user_id: string }[]) {
      if (!fs.existsSync(this.imagePath(r.user_id, r.id))) {
        this.db.prepare('DELETE FROM images WHERE id = ?').run(r.id);
        orphanRows++;
      }
    }
    return { tmp, orphanFiles, orphanRows };
  }

  // ---- data copy -------------------------------------------------------

  /** Marker files of running `data copy` commands. */
  get copyLockDir() {
    return path.join(this.opts.dataDir, 'copy-locks');
  }

  /** True while a `data copy` is running. A marker older than COPY_LOCK_STALE_MS (a killed copy) is ignored. */
  copyInProgress(): boolean {
    let names: string[];
    try {
      names = fs.readdirSync(this.copyLockDir);
    } catch {
      return false;
    }
    const now = Date.now();
    return names.some((f) => {
      try {
        return now - fs.statSync(path.join(this.copyLockDir, f)).mtimeMs < COPY_LOCK_STALE_MS;
      } catch {
        return false;
      }
    });
  }

  /**
   * Consistent copy of the database and the image files into a new directory (SPEC 9),
   * without blocking the running app:
   *
   * 1. A marker file announces the copy. Image clean-up checks for it inside its write
   *    transaction and postpones deleting while it exists.
   * 2. A brief empty write transaction waits for any clean-up transaction that began before
   *    the marker existed; from then on no image row the snapshot can contain is deleted.
   * 3. The database is copied with VACUUM INTO, a consistent read that takes no write lock.
   * 4. Image files are hard-linked (they never change) or copied. A file that is missing
   *    is looked for again a moment later (an upload renames its file just after committing
   *    its row); if it is still missing the copy fails.
   * 5. Everything is built in `<dir>.partial-<pid>` and renamed to `<dir>` only when complete,
   *    so an interrupted copy never leaves something that looks finished or blocks the next run.
   */
  async dataCopy(dir: string, hooks: { afterSnapshot?: () => unknown } = {}): Promise<{ db: string; images: number }> {
    const target = path.resolve(dir);
    if (fs.existsSync(target)) throw new AppError(409, 'exists', `${target} already exists. Choose a new directory.`);
    removeDeadPartials(target);
    const partial = `${target}.partial-${process.pid}`;
    fs.mkdirSync(this.copyLockDir, { recursive: true });
    const lock = path.join(this.copyLockDir, `${process.pid}-${crypto.randomUUID()}`);
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), target }));
    const cleanup = () => {
      fs.rmSync(partial, { recursive: true, force: true });
      fs.rmSync(lock, { force: true });
    };
    const onSignal = (sig: NodeJS.Signals) => {
      cleanup();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      fs.mkdirSync(partial, { recursive: true });
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec('COMMIT');
      const reader = new Database(this.db.name, { readonly: true });
      try {
        reader.prepare('VACUUM INTO ?').run(path.join(partial, 'notes.db'));
      } finally {
        reader.close();
      }
      await hooks.afterSnapshot?.();
      const copy = new Database(path.join(partial, 'notes.db'), { readonly: true });
      const rows = copy.prepare('SELECT id, user_id FROM images').all() as { id: string; user_id: string }[];
      copy.close();
      let missing: typeof rows = [];
      for (const r of rows) if (!(await this.copyImageFile(r, partial))) missing.push(r);
      if (missing.length) {
        await new Promise((res) => setTimeout(res, 1000));
        const again: typeof rows = [];
        for (const r of missing) if (!(await this.copyImageFile(r, partial))) again.push(r);
        missing = again;
      }
      if (missing.length) {
        throw new AppError(
          500,
          'image_missing',
          `${missing.length} image file(s) are missing from the data volume (for example ${missing[0].id}); no copy was made. ` +
            'Restart the app once (it removes rows without files on start) and run the copy again.',
        );
      }
      fs.renameSync(partial, target);
      return { db: path.join(target, 'notes.db'), images: rows.length };
    } catch (e) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw e;
    } finally {
      cleanup();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      // Work postponed while the copy ran (unless another copy is still running).
      if (!this.copyInProgress()) {
        try {
          this.cleanupImages();
          for (const dir of fs.readdirSync(this.imagesDir)) {
            if (!this.getUser(dir)) fs.rmSync(path.join(this.imagesDir, dir), { recursive: true, force: true });
          }
        } catch {
          // Clean-up runs again daily and at start-up.
        }
      }
    }
  }

  private async copyImageFile(r: { id: string; user_id: string }, into: string): Promise<boolean> {
    const src = this.imagePath(r.user_id, r.id);
    const dest = path.join(into, 'images', r.user_id, r.id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.linkSync(src, dest);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    }
    try {
      await fs.promises.copyFile(src, dest);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }
}

/** A copy marker older than this belongs to a copy that was killed. */
export const COPY_LOCK_STALE_MS = 6 * HOUR;

/** Remove `<target>.partial-<pid>` directories whose copy process no longer runs. */
function removeDeadPartials(target: string) {
  const parent = path.dirname(target);
  const prefix = `${path.basename(target)}.partial-`;
  let names: string[] = [];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return;
  }
  for (const f of names) {
    if (!f.startsWith(prefix)) continue;
    const pid = Number(f.slice(prefix.length));
    let alive = false;
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code === 'EPERM';
      }
    }
    if (!alive) fs.rmSync(path.join(parent, f), { recursive: true, force: true });
  }
}

export { sha256, utf8Length };
