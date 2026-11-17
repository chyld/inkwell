// Users, sessions and agent tokens (SPEC 4, 5, 8), and each user's storage use and quota.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stmt } from '../db.js';
import { AppError, badRequest, quotaExceeded } from '../errors.js';
import { hashPassword, verifyPassword, dummyVerify } from '../passwords.js';
import { DAY, HOUR } from '../units.js';
import { nameProblem } from '../../shared/schema.js';
import { iso, StorePart } from './context.js';
import { copyInProgress } from './dataCopy.js';

export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 90 * DAY;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  disabled: number;
  created_at: number;
}

/** The signed-in user as a request carries it: no password hash or other fields the handlers do not use. */
export type SessionUser = Pick<UserRow, 'id' | 'username'>;

export interface AgentAuth {
  agentId: string;
  agentName: string;
  userId: string;
}

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function checkUsername(username: string): string | null {
  return USERNAME_RE.test(username) ? null : 'Username must be 3-32 characters: a-z, 0-9, "-" or "_".';
}

export class IdentityStore extends StorePart {
  // ---- users -----------------------------------------------------------

  getUserByUsername(raw: string): UserRow | undefined {
    return stmt(this.db, 'SELECT * FROM users WHERE username = ?').get(normalizeUsername(raw)) as UserRow | undefined;
  }

  getUser(id: string): UserRow | undefined {
    return stmt(this.db, 'SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
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
      stmt(this.db, 'INSERT INTO users (id, username, password_hash, disabled, created_at) VALUES (?, ?, ?, 0, ?)').run(id, username, hash, now);
      stmt(this.db, "INSERT INTO folders (id, user_id, parent_id, name, name_key, is_inbox, created_at) VALUES (?, ?, NULL, 'Inbox', 'inbox', 1, ?)")
        .run(crypto.randomUUID(), id, now);
      return this.getUser(id)!;
    });
  }

  listUsers() {
    return stmt(this.db, 
        `SELECT u.username, u.created_at, u.disabled,
           (SELECT count(*) FROM notes n WHERE n.user_id = u.id) AS note_count,
           (SELECT count(*) FROM agents a WHERE a.user_id = u.id AND a.revoked_at IS NULL) AS agent_count,
           (SELECT ifnull(sum(body_size), 0) FROM notes n WHERE n.user_id = u.id) +
             (SELECT ifnull(sum(size), 0) FROM images i WHERE i.user_id = u.id) AS used
         FROM users u ORDER BY u.username`,
      )
      .all()
      .map((r: any) => ({
        username: r.username as string,
        createdAt: iso(r.created_at),
        disabled: !!r.disabled,
        noteCount: r.note_count as number,
        storageUsed: r.used as number, // what usage() gives, in the same query (no query per user)
        agentCount: r.agent_count as number,
      }));
  }

  async setPassword(rawUsername: string, password: string): Promise<void> {
    const user = this.requireUser(rawUsername);
    const hash = await hashPassword(password);
    this.tx(() => {
      stmt(this.db, 'UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      stmt(this.db, 'DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
  }

  setDisabled(rawUsername: string, disabled: boolean): void {
    const user = this.requireUser(rawUsername);
    this.tx(() => {
      stmt(this.db, 'UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
      if (disabled) stmt(this.db, 'DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
  }

  deleteUser(rawUsername: string): void {
    const user = this.requireUser(rawUsername);
    this.tx(() => {
      stmt(this.db, 'DELETE FROM notes_fts WHERE rowid IN (SELECT seq FROM notes WHERE user_id = ?)').run(user.id);
      stmt(this.db, 'DELETE FROM sessions WHERE user_id = ?').run(user.id);
      stmt(this.db, 'DELETE FROM notes WHERE user_id = ?').run(user.id);
      // Folders: children before parents (cascade handles it, but be explicit about order-independence).
      stmt(this.db, 'DELETE FROM folders WHERE user_id = ?').run(user.id);
      stmt(this.db, 'DELETE FROM users WHERE id = ?').run(user.id);
    });
    // A running data copy may still need these files; the copy removes the directory when it ends.
    if (!copyInProgress(this.opts.dataDir)) fs.rmSync(path.join(this.imagesDir, user.id), { recursive: true, force: true });
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
    const r = stmt(this.db, 
        `SELECT (SELECT ifnull(sum(body_size), 0) FROM notes WHERE user_id = ?) +
                (SELECT ifnull(sum(size), 0) FROM images WHERE user_id = ?) AS used`,
      )
      .get(userId, userId) as { used: number };
    return r.used;
  }

  /** Throws quota_exceeded if adding delta bytes would take the user past the quota. */
  assertQuota(userId: string, delta: number) {
    if (delta <= 0) return;
    if (this.usage(userId) + delta > this.opts.userQuotaBytes) throw quotaExceeded();
  }

  // ---- sessions --------------------------------------------------------

  createSession(userId: string): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.now();
    stmt(this.db, 'INSERT INTO sessions (id_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now);
    return token;
  }

  /**
   * Returns the user for a valid session, deleting expired ones (SPEC 5). One query: the session and its user
   * together, with only the fields the check and the handlers use.
   */
  authenticateSession(token: string | undefined): SessionUser | null {
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const row = stmt(
      this.db,
      'SELECT s.created_at, s.last_used, u.id, u.username, u.disabled FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?',
    ).get(hash) as { created_at: number; last_used: number; id: string | null; username: string | null; disabled: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (now - row.last_used > SESSION_IDLE_MS || now - row.created_at > SESSION_MAX_MS) {
      stmt(this.db, 'DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    if (row.id === null || row.disabled) {
      stmt(this.db, 'DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    if (now - row.last_used > HOUR) stmt(this.db, 'UPDATE sessions SET last_used = ? WHERE id_hash = ?').run(now, hash);
    return { id: row.id, username: row.username! };
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
    if (token) stmt(this.db, 'DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  }

  purgeExpiredSessions(): number {
    const now = this.now();
    return stmt(this.db, 'DELETE FROM sessions WHERE last_used < ? OR created_at < ?').run(now - SESSION_IDLE_MS, now - SESSION_MAX_MS).changes;
  }

  // ---- agents ----------------------------------------------------------

  addAgent(rawUsername: string, rawName: string): { token: string; name: string; username: string } {
    const user = this.requireUser(rawUsername);
    const name = String(rawName ?? '').trim();
    if (nameProblem(name, 50)) {
      throw badRequest('Agent name must be 1-50 characters.');
    }
    const token = 'nta_' + crypto.randomBytes(32).toString('base64url');
    this.tx(() => {
      const existing = stmt(this.db, 'SELECT revoked_at FROM agents WHERE user_id = ? AND name = ?').get(user.id, name) as
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
      stmt(this.db, 'INSERT INTO agents (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), user.id, name, sha256(token), this.now());
    });
    return { token, name, username: user.username };
  }

  listAgents(rawUsername?: string) {
    const user = rawUsername ? this.requireUser(rawUsername) : null;
    const rows = stmt(this.db, 
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
    const r = stmt(this.db, 'UPDATE agents SET revoked_at = ? WHERE user_id = ? AND name = ? AND revoked_at IS NULL').run(this.now(), user.id, name);
    if (r.changes === 0) {
      const exists = stmt(this.db, 'SELECT 1 FROM agents WHERE user_id = ? AND name = ?').get(user.id, name);
      throw new AppError(404, 'no_such_agent', exists ? `Agent "${name}" is already revoked.` : `User "${user.username}" has no agent named "${name}".`);
    }
  }

  /** Valid only for an existing, unrevoked token whose user is enabled. */
  authenticateAgent(token: string | undefined): AgentAuth | null {
    if (!token || !token.startsWith('nta_') || token.length > 200) return null;
    const row = stmt(this.db, 
        `SELECT a.id, a.name, a.user_id, a.last_used FROM agents a JOIN users u ON u.id = a.user_id
         WHERE a.token_hash = ? AND a.revoked_at IS NULL AND u.disabled = 0`,
      )
      .get(sha256(token)) as { id: string; name: string; user_id: string; last_used: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.last_used === null || now - row.last_used > 60_000) stmt(this.db, 'UPDATE agents SET last_used = ? WHERE id = ?').run(now, row.id);
    return { agentId: row.id, agentName: row.name, userId: row.user_id };
  }
}
