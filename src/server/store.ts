// The shared data-access module (SPEC 4). The web server, the MCP endpoint and the CLI all go through it. Store
// wires the parts together around one database handle and one transaction helper: identity (users, sessions,
// agents), notes (folders, notes, tags, search), images (rows and files), the data copy, fonts and styles.
import path from 'node:path';
import type { DB } from './db.js';
import { FontStore } from './fonts/store.js';
import { StyleStore } from './styles.js';
import type { StoreContext, StoreOptions } from './store/context.js';
import { IdentityStore } from './store/identity.js';
import { NoteStore } from './store/notes.js';
import { ImageStore } from './store/images.js';
import { DataCopy } from './store/dataCopy.js';

export { DAY, HOUR } from './units.js';
export type { StoreOptions } from './store/context.js';
export { SESSION_IDLE_MS, SESSION_MAX_MS, normalizeUsername, checkUsername, type UserRow, type SessionUser, type AgentAuth } from './store/identity.js';
export { FOLDER_MAX_DEPTH, PAGE_SIZE, normalizeTags, buildFtsQuery, type FolderNode, type NoteView } from './store/notes.js';
export { IMAGE_GRACE_MS } from './store/images.js';
export { COPY_LOCK_STALE_MS } from './store/dataCopy.js';

export class Store {
  readonly now: () => number;
  readonly imagesDir: string;
  readonly tmpDir: string;
  /** Users, sessions, agent tokens, storage use. */
  readonly identity: IdentityStore;
  /** Folders, notes, tags, search, agent notes. */
  readonly notes: NoteStore;
  /** Image rows and files. */
  readonly images: ImageStore;
  /** `notes data copy`. */
  readonly copy: DataCopy;
  /** The shared font store and the per-user font collections (FONTS-SPEC 5.2, 6). */
  readonly fonts: FontStore;
  /** Each user's text styles (STYLES-SPEC). */
  readonly styles: StyleStore;

  constructor(
    readonly db: DB,
    readonly opts: StoreOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.imagesDir = path.join(opts.dataDir, 'images');
    this.tmpDir = path.join(opts.dataDir, 'tmp');
    const ctx: StoreContext = { db, opts, now: this.now, imagesDir: this.imagesDir, tmpDir: this.tmpDir, tx: (fn) => this.tx(fn) };
    this.identity = new IdentityStore(ctx);
    this.notes = new NoteStore(ctx, this.identity);
    this.images = new ImageStore(ctx, this.identity);
    this.copy = new DataCopy(ctx, this.identity, this.images);
    this.fonts = new FontStore(db, { dataDir: opts.dataDir, tmpDir: this.tmpDir, now: this.now, capBytes: opts.fontCacheBytes ?? 500 * 1024 * 1024 });
    this.styles = new StyleStore(db, this.now);
  }

  /** Run fn in one BEGIN IMMEDIATE transaction. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}
