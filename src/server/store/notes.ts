// Folders, notes, tags and search (SPEC 4, 6, 7), and notes made by agents (SPEC 8).
import { stmt } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import {
  EMPTY_DOC,
  MAX_TITLE_CHARS,
  TAGS_PER_NOTE,
  charLength,
  normalizeTag,
  validateBody,
  NoteValidationError,
  type ValidatedBody,
} from '../../shared/schema.js';
import { HOUR } from '../units.js';
import { iso, StorePart, type StoreContext } from './context.js';
import type { AgentAuth, IdentityStore } from './identity.js';

export const FOLDER_MAX_DEPTH = 10;
export const PAGE_SIZE = 50;

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

/** What updating a note needs, without its body and text. */
type NoteMeta = Pick<NoteRow, 'seq' | 'id' | 'folder_id' | 'version' | 'body_size' | 'trashed_at'>;

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

/** Tags in the order `ORDER BY name` gives (SQLite's BINARY collation compares the UTF-8 bytes). */
const sortTags = (tags: string[]) => [...tags].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

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

export class NoteStore extends StorePart {
  constructor(
    ctx: StoreContext,
    private readonly identity: IdentityStore,
  ) {
    super(ctx);
  }

  // ---- folders ---------------------------------------------------------

  private folderRows(userId: string): FolderRow[] {
    return stmt(this.db, 'SELECT * FROM folders WHERE user_id = ?').all(userId) as FolderRow[];
  }

  inboxId(userId: string): string {
    const r = stmt(this.db, 'SELECT id FROM folders WHERE user_id = ? AND is_inbox = 1').get(userId) as { id: string };
    return r.id;
  }

  private ownFolder(userId: string, id: unknown): FolderRow {
    if (typeof id !== 'string') throw notFound('Folder not found.');
    const f = stmt(this.db, 'SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as FolderRow | undefined;
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
        stmt(this.db, 'SELECT folder_id, count(*) c FROM notes WHERE user_id = ? AND trashed_at IS NULL AND folder_id IS NOT NULL GROUP BY folder_id').all(userId) as {
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
      stmt(this.db, 'INSERT INTO folders (id, user_id, parent_id, name, name_key, is_inbox, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
        .run(id, userId, parent?.id ?? null, name, key, this.now());
      return { id, name, parentId: parent?.id ?? null, isInbox: false, noteCount: 0, children: [] };
    });
  }

  private assertSiblingFree(userId: string, parentId: string | null, key: string, exceptId: string | null) {
    const clash = stmt(this.db, "SELECT id FROM folders WHERE user_id = ? AND ifnull(parent_id, '') = ? AND name_key = ? AND id != ?")
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
      stmt(this.db, 'UPDATE folders SET name = ?, name_key = ?, parent_id = ? WHERE id = ?').run(name, key, parentId, f.id);
    });
  }

  deleteFolder(userId: string, id: unknown): void {
    this.tx(() => {
      const f = this.ownFolder(userId, id);
      if (f.is_inbox) throw badRequest('Inbox cannot be deleted.', 'inbox_protected');
      if (stmt(this.db, 'SELECT 1 FROM folders WHERE parent_id = ?').get(f.id)) {
        throw new AppError(409, 'folder_not_empty', 'Only an empty folder can be deleted. This one has subfolders.');
      }
      if (stmt(this.db, 'SELECT 1 FROM notes WHERE folder_id = ? AND trashed_at IS NULL').get(f.id)) {
        throw new AppError(409, 'folder_not_empty', 'Only an empty folder can be deleted. This one has notes.');
      }
      stmt(this.db, 'UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(f.id);
      stmt(this.db, 'DELETE FROM folders WHERE id = ?').run(f.id);
    });
  }

  // ---- notes -----------------------------------------------------------

  private ownNote(userId: string, id: unknown): NoteRow {
    if (typeof id !== 'string') throw notFound('Note not found.');
    const n = stmt(this.db, 'SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as NoteRow | undefined;
    if (!n) throw notFound('Note not found.');
    return n;
  }

  /** The note's metadata, without its body and text (which can be up to 1 MB each): enough to check and update it. */
  private ownNoteMeta(userId: string, id: unknown): NoteMeta {
    if (typeof id !== 'string') throw notFound('Note not found.');
    const n = stmt(this.db, 'SELECT seq, id, folder_id, version, body_size, trashed_at FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as
      | NoteMeta
      | undefined;
    if (!n) throw notFound('Note not found.');
    return n;
  }

  private tagsOf(seq: number): string[] {
    return (stmt(this.db, 'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_seq = ? ORDER BY t.name').all(seq) as { name: string }[]).map(
      (r) => r.name,
    );
  }

  /** Index a note that is not in Trash, from values the caller already holds (no row of its own yet). */
  private ftsInsert(seq: number, title: string, text: string, tags: string[]) {
    stmt(this.db, 'INSERT INTO notes_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)').run(seq, title, text, sortTags(tags).join(' '));
  }

  /** Update some of an indexed note's columns in place; rebuilds the entry from the note if it is missing. */
  private ftsUpdate(seq: number, cols: { title: string; text: string } | { tags: string[] }) {
    const r =
      'tags' in cols
        ? stmt(this.db, 'UPDATE notes_fts SET tags = ? WHERE rowid = ?').run(sortTags(cols.tags).join(' '), seq)
        : stmt(this.db, 'UPDATE notes_fts SET title = ?, body = ? WHERE rowid = ?').run(cols.title, cols.text, seq);
    if (r.changes === 0) this.syncFts(seq);
  }

  /** Rebuild a note's index entry from the database (restore, and the fallback above). */
  private syncFts(seq: number) {
    stmt(this.db, 'DELETE FROM notes_fts WHERE rowid = ?').run(seq);
    const n = stmt(this.db, 'SELECT title, body_text, trashed_at FROM notes WHERE seq = ?').get(seq) as
      | { title: string; body_text: string; trashed_at: number | null }
      | undefined;
    if (!n || n.trashed_at !== null) return;
    stmt(this.db, 'INSERT INTO notes_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)').run(seq, n.title, n.body_text, this.tagsOf(seq).join(' '));
  }

  /** Set a note's tags with a constant number of statements, whatever the number of tags. */
  private setTags(userId: string, seq: number, tags: string[]) {
    stmt(this.db, 'DELETE FROM note_tags WHERE note_seq = ?').run(seq);
    if (tags.length) {
      const list = JSON.stringify(tags);
      stmt(this.db, 'INSERT INTO tags (user_id, name) SELECT ?, value FROM json_each(?) WHERE true ON CONFLICT (user_id, name) DO NOTHING').run(userId, list);
      stmt(this.db, 'INSERT INTO note_tags (note_seq, tag_id) SELECT ?, id FROM tags WHERE user_id = ? AND name IN (SELECT value FROM json_each(?))').run(seq, userId, list);
    }
    this.gcTags(userId);
  }

  private gcTags(userId: string) {
    stmt(this.db, 'DELETE FROM tags WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)').run(userId);
  }

  private assertImagesOwned(userId: string, ids: string[]) {
    if (!ids.length) return;
    // One query for all of them, in the note's order.
    const missing = (
      stmt(this.db, 'SELECT value FROM json_each(?) WHERE value NOT IN (SELECT id FROM images WHERE user_id = ?) ORDER BY key').all(JSON.stringify(ids), userId) as {
        value: string;
      }[]
    ).map((r) => r.value);
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

  /** Make the note's image links exactly `ids`, touching only the links that change. */
  private setImageLinks(seq: number, ids: string[]) {
    const list = JSON.stringify(ids);
    stmt(this.db, 'DELETE FROM note_images WHERE note_seq = ? AND image_id NOT IN (SELECT value FROM json_each(?))').run(seq, list);
    if (ids.length) stmt(this.db, 'INSERT OR IGNORE INTO note_images (note_seq, image_id) SELECT ?, value FROM json_each(?)').run(seq, list);
  }

  private noteOut(n: NoteRow, tags = this.tagsOf(n.seq)) {
    return {
      id: n.id,
      title: n.title,
      body: JSON.parse(n.body),
      version: n.version,
      folderId: n.folder_id,
      tags,
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
      this.identity.assertQuota(userId, body.bytes);
      const now = this.now();
      const id = crypto.randomUUID();
      const r = stmt(this.db, 
          `INSERT INTO notes (id, user_id, folder_id, title, body, body_text, body_size, version, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, userId, folder, body.serialized, body.text, body.bytes, now, now);
      this.ftsInsert(Number(r.lastInsertRowid), '', body.text, []);
      // The note as getNote would return it, from the values just written.
      return {
        id,
        title: '',
        body: JSON.parse(body.serialized),
        version: 1,
        folderId: folder,
        tags: [] as string[],
        createdAt: iso(now),
        updatedAt: iso(now),
        trashedAt: iso(null),
        origin: { type: 'user' as const },
      };
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
      const n = this.ownNoteMeta(userId, id);
      if (n.trashed_at !== null) throw new AppError(409, 'in_trash', 'This note is in Trash and cannot be edited.');
      if (n.version !== input.version) {
        throw new AppError(409, 'version_conflict', 'This note was changed somewhere else.', { version: n.version });
      }
      this.assertImagesOwned(userId, body.imageIds);
      this.identity.assertQuota(userId, body.bytes - n.body_size);
      const now = this.now();
      const version = n.version + 1;
      stmt(this.db, 'UPDATE notes SET title = ?, body = ?, body_text = ?, body_size = ?, version = ?, updated_at = ? WHERE seq = ?')
        .run(title, body.serialized, body.text, body.bytes, version, now, n.seq);
      this.setImageLinks(n.seq, body.imageIds);
      this.ftsUpdate(n.seq, { title, text: body.text });
      return { version, updatedAt: iso(now) };
    });
  }

  /** Folder and tag changes: no version check, last request wins. */
  patchNote(userId: string, id: unknown, changes: { folderId?: unknown; tags?: unknown }) {
    const tags = changes.tags !== undefined ? normalizeTags(changes.tags) : undefined;
    return this.tx(() => {
      const n = this.ownNoteMeta(userId, id);
      if (n.trashed_at !== null) throw new AppError(409, 'in_trash', 'This note is in Trash and cannot be changed.');
      let folderId = n.folder_id;
      if (changes.folderId !== undefined) {
        folderId = changes.folderId === null ? null : this.ownFolder(userId, changes.folderId).id;
        stmt(this.db, 'UPDATE notes SET folder_id = ? WHERE seq = ?').run(folderId, n.seq);
      }
      if (tags) {
        this.setTags(userId, n.seq, tags);
        this.ftsUpdate(n.seq, { tags });
      }
      // What was written, without reading it back (tags in the order tagsOf gives).
      return { folderId, tags: tags ? sortTags(tags) : this.tagsOf(n.seq) };
    });
  }

  trashNote(userId: string, id: unknown) {
    this.tx(() => {
      const n = this.ownNoteMeta(userId, id);
      if (n.trashed_at !== null) return;
      stmt(this.db, 'UPDATE notes SET trashed_at = ? WHERE seq = ?').run(this.now(), n.seq);
      stmt(this.db, 'DELETE FROM notes_fts WHERE rowid = ?').run(n.seq); // notes in Trash are not searched
    });
  }

  /** Restore a note from Trash; returns it as getNote would, from the row it reads (no second read). */
  restoreNote(userId: string, id: unknown) {
    return this.tx(() => {
      const n = this.ownNote(userId, id);
      if (n.trashed_at === null) return this.noteOut(n);
      // folder_id is already NULL if the folder was deleted (ON DELETE SET NULL / deleteFolder).
      stmt(this.db, 'UPDATE notes SET trashed_at = NULL WHERE seq = ?').run(n.seq);
      const tags = this.tagsOf(n.seq);
      this.ftsInsert(n.seq, n.title, n.body_text, tags);
      return this.noteOut({ ...n, trashed_at: null }, tags);
    });
  }

  /** Permanently delete one trashed note. */
  deleteNote(userId: string, id: unknown) {
    this.tx(() => {
      const n = this.ownNoteMeta(userId, id);
      if (n.trashed_at === null) throw new AppError(409, 'not_in_trash', 'Only a note in Trash can be deleted permanently.');
      stmt(this.db, 'DELETE FROM notes_fts WHERE rowid = ?').run(n.seq);
      stmt(this.db, 'DELETE FROM notes WHERE seq = ?').run(n.seq);
      this.gcTags(userId);
    });
  }

  emptyTrash(userId: string): string[] {
    return this.tx(() => {
      const ids = (stmt(this.db, 'SELECT id FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').all(userId) as { id: string }[]).map((r) => r.id);
      stmt(this.db, 'DELETE FROM notes_fts WHERE rowid IN (SELECT seq FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL)').run(userId);
      stmt(this.db, 'DELETE FROM notes WHERE user_id = ? AND trashed_at IS NOT NULL').run(userId);
      this.gcTags(userId);
      return ids;
    });
  }

  private listItems(rows: (NoteRow & { snippet_src?: string })[]) {
    const tags = new Map<number, string[]>();
    if (rows.length) {
      const q = stmt(this.db, 
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
    const rows = stmt(this.db, 
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
    return stmt(this.db, 
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
    const rows = stmt(this.db, 
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
      const live = stmt(this.db, 'SELECT 1 FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND a.revoked_at IS NULL AND u.disabled = 0')
        .get(agent.agentId);
      if (!live) throw new AppError(401, 'unauthorized', 'This agent token is no longer valid.');
      const calls = stmt(this.db, 'SELECT count(*) AS c FROM agent_calls WHERE agent_id = ? AND at > ?').get(agent.agentId, now - HOUR) as { c: number };
      if (calls.c >= this.opts.agentRatePerHour) {
        throw new AppError(429, 'rate_limited', `Rate limit reached: at most ${this.opts.agentRatePerHour} notes per hour for this agent. Try again later.`);
      }
      this.assertImagesOwned(agent.userId, input.body.imageIds);
      this.identity.assertQuota(agent.userId, input.body.bytes);
      const id = crypto.randomUUID();
      const r = stmt(this.db, 
          `INSERT INTO notes (id, user_id, folder_id, title, body, body_text, body_size, version, agent_id, agent_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(id, agent.userId, this.inboxId(agent.userId), input.title, input.body.serialized, input.body.text, input.body.bytes, agent.agentId, agent.agentName, now, now);
      const seq = Number(r.lastInsertRowid);
      this.setTags(agent.userId, seq, input.tags);
      this.setImageLinks(seq, input.body.imageIds);
      this.ftsInsert(seq, input.title, input.body.text, input.tags);
      stmt(this.db, 'DELETE FROM agent_calls WHERE agent_id = ? AND at <= ?').run(agent.agentId, now - HOUR);
      stmt(this.db, 'INSERT INTO agent_calls (agent_id, at) VALUES (?, ?)').run(agent.agentId, now);
      stmt(this.db, 'UPDATE agents SET notes_created = notes_created + 1, last_used = ? WHERE id = ?').run(now, agent.agentId);
      return { id };
    });
  }
}
