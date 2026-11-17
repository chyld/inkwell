// `notes data copy` (SPEC 9): a consistent copy of the database and the image files while the app runs, and the
// marker files that make image clean-up wait for it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { HOUR } from '../units.js';
import { StorePart, type StoreContext } from './context.js';
import type { IdentityStore } from './identity.js';
import type { ImageStore } from './images.js';

/** Marker files of running `data copy` commands. */
export function copyLockDir(dataDir: string) {
  return path.join(dataDir, 'copy-locks');
}

/** True while a `data copy` is running. A marker older than COPY_LOCK_STALE_MS (a killed copy) is ignored. */
export function copyInProgress(dataDir: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(copyLockDir(dataDir));
  } catch {
    return false;
  }
  const now = Date.now();
  return names.some((f) => {
    try {
      return now - fs.statSync(path.join(copyLockDir(dataDir), f)).mtimeMs < COPY_LOCK_STALE_MS;
    } catch {
      return false;
    }
  });
}

export class DataCopy extends StorePart {
  constructor(
    ctx: StoreContext,
    private readonly identity: IdentityStore,
    private readonly images: ImageStore,
  ) {
    super(ctx);
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
    fs.mkdirSync(copyLockDir(this.opts.dataDir), { recursive: true });
    const lock = path.join(copyLockDir(this.opts.dataDir), `${process.pid}-${crypto.randomUUID()}`);
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
      if (!copyInProgress(this.opts.dataDir)) {
        try {
          this.images.cleanupImages();
          for (const dir of fs.readdirSync(this.imagesDir)) {
            if (!this.identity.getUser(dir)) fs.rmSync(path.join(this.imagesDir, dir), { recursive: true, force: true });
          }
        } catch {
          // Clean-up runs again daily and at start-up.
        }
      }
    }
  }

  private async copyImageFile(r: { id: string; user_id: string }, into: string): Promise<boolean> {
    const src = this.images.imagePath(r.user_id, r.id);
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
