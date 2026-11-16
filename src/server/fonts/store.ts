// The font store (FONTS-SPEC 5.2) and the per-user collections (6). The store is a cache shared by
// all users: files under <data>/fonts named by their SHA-256, rows per family for its preview unit
// and its note-face unit. Recording, eviction and file deletion are synchronous, so they run one at
// a time; downloads of an operation in progress are in <data>/tmp and are never evicted.
import fs from 'node:fs';
import path from 'node:path';
import { stmt, type DB } from '../db.js';
import { COLLECTION_MAX, FONT_HASH_RE, fontById } from '../../shared/fonts.js';
import { HOUR } from '../units.js';

export interface StoredFace {
  weight: string;
  style: 'normal' | 'italic';
  unicodeRange: string;
  file: string;
}

export interface DownloadedFile {
  hash: string;
  size: number;
  /** Where the download waits, under <data>/tmp. */
  tmpPath: string;
}

export type Unit = { kind: 'preview'; file: string } | { kind: 'faces'; faces: StoredFace[] };

export class FontStoreFull extends Error {}

export class FontStore {
  readonly dir: string;
  readonly tmpDir: string;

  constructor(
    private db: DB,
    private opts: { dataDir: string; tmpDir: string; now: () => number; capBytes: number },
  ) {
    this.dir = path.join(opts.dataDir, 'fonts');
    this.tmpDir = opts.tmpDir;
  }

  // ---- collections ----------------------------------------------------------

  collection(userId: string): string[] {
    return (stmt(this.db, 'SELECT font_id FROM font_collection WHERE user_id = ? ORDER BY seq').all(userId) as { font_id: string }[]).map((r) => r.font_id);
  }

  /** One query: whether the font is in the user's collection, how many fonts it holds, and the next position. */
  collectionState(userId: string, fontId: string): { present: boolean; count: number; nextSeq: number } {
    const r = stmt(this.db, 'SELECT count(*) AS n, ifnull(max(font_id = @font), 0) AS present, ifnull(max(seq), 0) + 1 AS next FROM font_collection WHERE user_id = @user').get({ user: userId, font: fontId }) as {
      n: number;
      present: number;
      next: number;
    };
    return { present: r.present === 1, count: r.n, nextSeq: r.next };
  }

  /** In one transaction: check again, then insert. Parallel adds can never leave more than the maximum. */
  addToCollection(userId: string, fontId: string): 'added' | 'present' | 'full' {
    return this.db
      .transaction(() => {
        const s = this.collectionState(userId, fontId);
        if (s.present) return 'present' as const;
        if (s.count >= COLLECTION_MAX) return 'full' as const;
        stmt(this.db, 'INSERT INTO font_collection (user_id, font_id, seq) VALUES (?, ?, ?)').run(userId, fontId, s.nextSeq);
        return 'added' as const;
      })
      .immediate();
  }

  removeFromCollection(userId: string, fontId: string): void {
    stmt(this.db, 'DELETE FROM font_collection WHERE user_id = ? AND font_id = ?').run(userId, fontId);
  }

  // ---- reading the store ------------------------------------------------------

  getPreview(fontId: string): string | null {
    const r = stmt(this.db, 'SELECT file FROM font_previews WHERE font_id = ?').get(fontId) as { file: string } | undefined;
    return r ? r.file : null;
  }

  getFaces(fontId: string): StoredFace[] | null {
    if (!stmt(this.db, 'SELECT 1 FROM font_face_units WHERE font_id = ?').get(fontId)) return null;
    return (stmt(this.db, 'SELECT weight, style, unicode_range AS unicodeRange, file FROM font_faces WHERE font_id = ? ORDER BY seq').all(fontId) as StoredFace[]).map((f) => ({ ...f }));
  }

  /** "Last used", updated at most once an hour per family and unit. */
  touch(kind: 'preview' | 'faces', fontId: string): void {
    const table = kind === 'preview' ? 'font_previews' : 'font_face_units';
    const now = this.opts.now();
    stmt(this.db, `UPDATE ${table} SET last_used = ? WHERE font_id = ? AND last_used <= ?`).run(now, fontId, now - HOUR);
  }


  filePath(hash: string): string {
    return path.join(this.dir, hash);
  }

  /**
   * The path of a recorded file, or null. A recorded file that turns out to be missing drops every
   * unit that refers to it, so the next /faces or /preview for those families fetches them again.
   */
  fileFor(hash: string): string | null {
    if (!FONT_HASH_RE.test(hash)) return null;
    if (!stmt(this.db, 'SELECT 1 FROM font_files WHERE hash = ?').get(hash)) return null;
    const p = this.filePath(hash);
    if (fs.existsSync(p)) return p;
    this.db
      .transaction(() => {
        stmt(this.db, 'DELETE FROM font_previews WHERE file = ?').run(hash);
        stmt(this.db, 'DELETE FROM font_face_units WHERE font_id IN (SELECT DISTINCT font_id FROM font_faces WHERE file = ?)').run(hash);
        this.deleteUnreferencedRows();
      })
      .immediate();
    this.deleteUnrecordedFiles();
    return null;
  }

  /** The path of a recorded file without checking the disk (the caller opens it; on failure it calls fileFor). */
  recordedPath(hash: string): string | null {
    if (!FONT_HASH_RE.test(hash)) return null;
    return stmt(this.db, 'SELECT 1 FROM font_files WHERE hash = ?').get(hash) ? this.filePath(hash) : null;
  }

  totalBytes(): number {
    return (stmt(this.db, 'SELECT ifnull(sum(size), 0) AS n FROM font_files').get() as { n: number }).n;
  }

  // ---- recording -------------------------------------------------------------

  /**
   * Record one unit whole, evicting least recently used note faces of families that are in no
   * collection and not retired if that makes room. Throws FontStoreFull, changing nothing, if not.
   *
   * The common case (the unit fits) does work proportional to this unit: it reads only the files involved and
   * deletes exactly the files that lose their last reference. Only when eviction may be needed does it build the
   * cache-wide bookkeeping (planEviction) and sweep rows and the directory afterwards (as start-up does).
   */
  record(fontId: string, unit: Unit, files: DownloadedFile[]): void {
    const distinct = new Map(files.map((f) => [f.hash, f]));
    const known = new Set(
      (stmt(this.db, 'SELECT hash FROM font_files WHERE hash IN (SELECT value FROM json_each(?))').all(JSON.stringify([...distinct.keys()])) as { hash: string }[]).map(
        (r) => r.hash,
      ),
    );
    const newFiles = [...distinct.values()].filter((f) => !known.has(f.hash));
    const newBytes = newFiles.reduce((n, f) => n + f.size, 0);
    // The files of the older copy of this unit (being replaced) that the new copy does not use.
    const oldFiles = (
      unit.kind === 'preview'
        ? (stmt(this.db, 'SELECT file FROM font_previews WHERE font_id = ?').all(fontId) as { file: string }[])
        : (stmt(this.db, 'SELECT DISTINCT file FROM font_faces WHERE font_id = ?').all(fontId) as { file: string }[])
    )
      .map((r) => r.file)
      .filter((h) => !distinct.has(h));
    // Of those, the bytes freed: files nothing else refers to. Conservative: if this says the unit does not fit,
    // the full computation below decides, exactly as before.
    const freedOld = oldFiles.reduce((n, h) => (this.otherRefs(h, unit.kind, fontId) === 0 ? n + this.fileSize(h) : n), 0);
    const fits = this.totalBytes() - freedOld + newBytes <= this.opts.capBytes;
    const evict = fits ? [] : this.planEviction(fontId, unit, distinct, newBytes);

    // Files first (a row never points at a missing file), then the rows, then unreferenced files go.
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of newFiles) {
      const dest = this.filePath(f.hash);
      if (!fs.existsSync(dest)) fs.renameSync(f.tmpPath, dest);
    }
    const now = this.opts.now();
    let unreferenced: string[] = [];
    this.db
      .transaction(() => {
        for (const id of evict) stmt(this.db, 'DELETE FROM font_face_units WHERE font_id = ?').run(id);
        if (unit.kind === 'preview') stmt(this.db, 'DELETE FROM font_previews WHERE font_id = ?').run(fontId);
        else stmt(this.db, 'DELETE FROM font_face_units WHERE font_id = ?').run(fontId);
        const addFile = stmt(this.db, 'INSERT OR IGNORE INTO font_files (hash, size) VALUES (?, ?)');
        for (const f of distinct.values()) addFile.run(f.hash, f.size);
        if (unit.kind === 'preview') {
          stmt(this.db, 'INSERT INTO font_previews (font_id, file, fetched_at, last_used) VALUES (?, ?, ?, ?)').run(fontId, unit.file, now, now);
        } else {
          stmt(this.db, 'INSERT INTO font_face_units (font_id, fetched_at, last_used) VALUES (?, ?, ?)').run(fontId, now, now);
          const add = stmt(this.db, 'INSERT INTO font_faces (font_id, seq, weight, style, unicode_range, file) VALUES (?, ?, ?, ?, ?, ?)');
          unit.faces.forEach((f, i) => add.run(fontId, i, f.weight, f.style, f.unicodeRange, f.file));
        }
        if (fits) {
          // Only the replaced copy's files can have lost their last reference.
          unreferenced = (
            stmt(
              this.db,
              'DELETE FROM font_files WHERE hash IN (SELECT value FROM json_each(?)) AND hash NOT IN (SELECT file FROM font_previews) AND hash NOT IN (SELECT file FROM font_faces) RETURNING hash',
            ).all(JSON.stringify(oldFiles)) as { hash: string }[]
          ).map((r) => r.hash);
        } else this.deleteUnreferencedRows();
      })
      .immediate();
    if (fits) for (const h of unreferenced) fs.rmSync(this.filePath(h), { force: true });
    else this.deleteUnrecordedFiles();
  }

  /** How many units other than this one (kind and family) refer to a file. */
  private otherRefs(hash: string, kind: Unit['kind'], fontId: string): number {
    return (
      stmt(
        this.db,
        `SELECT (SELECT count(*) FROM font_previews WHERE file = @hash AND NOT (@kind = 'preview' AND font_id = @font))
              + (SELECT count(DISTINCT font_id) FROM font_faces WHERE file = @hash AND NOT (@kind = 'faces' AND font_id = @font)) AS n`,
      ).get({ hash, kind, font: fontId }) as { n: number }
    ).n;
  }

  private fileSize(hash: string): number {
    return (stmt(this.db, 'SELECT ifnull(max(size), 0) AS n FROM font_files WHERE hash = ?').get(hash) as { n: number }).n;
  }

  /**
   * The units to evict so this one fits, from the whole cache's bookkeeping (only run when it may not fit).
   * Throws FontStoreFull if evicting every candidate is not enough.
   */
  private planEviction(fontId: string, unit: Unit, distinct: Map<string, DownloadedFile>, newBytes: number): string[] {
    const sizes = new Map((stmt(this.db, 'SELECT hash, size FROM font_files').all() as { hash: string; size: number }[]).map((r) => [r.hash, r.size]));
    let total = [...sizes.values()].reduce((n, s) => n + s, 0);

    // References each recorded file has; the unit being recorded replaces any older copy of itself.
    const refs = new Map<string, number>();
    const unitFiles = new Map<string, string[]>(); // face unit -> its distinct files
    for (const r of stmt(this.db, 'SELECT font_id, file FROM font_previews').all() as { font_id: string; file: string }[]) {
      if (unit.kind === 'preview' && r.font_id === fontId) continue;
      refs.set(r.file, (refs.get(r.file) ?? 0) + 1);
    }
    for (const r of stmt(this.db, 'SELECT DISTINCT font_id, file FROM font_faces').all() as { font_id: string; file: string }[]) {
      if (unit.kind === 'faces' && r.font_id === fontId) continue;
      refs.set(r.file, (refs.get(r.file) ?? 0) + 1);
      unitFiles.set(r.font_id, [...(unitFiles.get(r.font_id) ?? []), r.file]);
    }
    for (const h of distinct.keys()) refs.set(h, (refs.get(h) ?? 0) + 1);
    // Files that only the replaced older copy referred to are freed anyway.
    for (const [h, size] of sizes) if (!refs.get(h)) total -= size;

    const evict: string[] = [];
    if (total + newBytes > this.opts.capBytes) {
      const inCollection = new Set((stmt(this.db, 'SELECT DISTINCT font_id FROM font_collection').all() as { font_id: string }[]).map((r) => r.font_id));
      const candidates = (stmt(this.db, 'SELECT font_id FROM font_face_units ORDER BY last_used, font_id').all() as { font_id: string }[])
        .map((r) => r.font_id)
        .filter((id) => id !== fontId && !inCollection.has(id) && fontById(id)?.retired !== true);
      let freed = 0;
      for (const id of candidates) {
        if (total + newBytes - freed <= this.opts.capBytes) break;
        evict.push(id);
        for (const h of unitFiles.get(id) ?? []) {
          const n = (refs.get(h) ?? 0) - 1;
          refs.set(h, n);
          if (n === 0) freed += sizes.get(h) ?? 0;
        }
      }
      if (total + newBytes - freed > this.opts.capBytes) throw new FontStoreFull('The font store is full.');
    }
    return evict;
  }

  private deleteUnreferencedRows() {
    stmt(this.db, 'DELETE FROM font_files WHERE hash NOT IN (SELECT file FROM font_previews) AND hash NOT IN (SELECT file FROM font_faces)').run();
  }

  /** Delete every file in the store that no row refers to. */
  private deleteUnrecordedFiles(): number {
    if (!fs.existsSync(this.dir)) return 0;
    const known = new Set((stmt(this.db, 'SELECT hash FROM font_files').all() as { hash: string }[]).map((r) => r.hash));
    let n = 0;
    for (const f of fs.readdirSync(this.dir)) {
      if (known.has(f)) continue;
      fs.rmSync(path.join(this.dir, f), { force: true, recursive: true });
      n++;
    }
    return n;
  }

  /** Start-up: drop every unit with a missing file, then delete rows and files nothing refers to. */
  reconcile(): { droppedUnits: number; deletedFiles: number } {
    fs.mkdirSync(this.dir, { recursive: true });
    const exists = (h: string) => fs.existsSync(this.filePath(h));
    let dropped = 0;
    this.db
      .transaction(() => {
        for (const r of stmt(this.db, 'SELECT font_id, file FROM font_previews').all() as { font_id: string; file: string }[]) {
          if (!exists(r.file)) {
            stmt(this.db, 'DELETE FROM font_previews WHERE font_id = ?').run(r.font_id);
            dropped++;
          }
        }
        const units = new Map<string, string[]>();
        for (const r of stmt(this.db, 'SELECT font_id, file FROM font_faces').all() as { font_id: string; file: string }[]) units.set(r.font_id, [...(units.get(r.font_id) ?? []), r.file]);
        for (const u of stmt(this.db, 'SELECT font_id FROM font_face_units').all() as { font_id: string }[]) {
          const files = units.get(u.font_id) ?? [];
          if (files.length === 0 || !files.every(exists)) {
            stmt(this.db, 'DELETE FROM font_face_units WHERE font_id = ?').run(u.font_id);
            dropped++;
          }
        }
        this.deleteUnreferencedRows();
      })
      .immediate();
    return { droppedUnits: dropped, deletedFiles: this.deleteUnrecordedFiles() };
  }
}
