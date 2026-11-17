// Image rows and files (SPEC 6.5): the row is written with the quota check, the file by images.ts; clean-up of
// unlinked images and the start-up reconciliation of rows and files.
import fs from 'node:fs';
import path from 'node:path';
import { stmt } from '../db.js';
import { notFound } from '../errors.js';
import { DAY } from '../units.js';
import { StorePart, type StoreContext } from './context.js';
import { copyInProgress } from './dataCopy.js';
import type { IdentityStore } from './identity.js';

export const IMAGE_GRACE_MS = DAY;

export class ImageStore extends StorePart {
  constructor(
    ctx: StoreContext,
    private readonly identity: IdentityStore,
  ) {
    super(ctx);
  }

  // ---- images (rows; files are handled by images.ts) -------------------

  insertImageRow(userId: string, id: string, mime: string, size: number) {
    this.tx(() => {
      this.identity.assertQuota(userId, size);
      stmt(this.db, 'INSERT INTO images (id, user_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, mime, size, this.now());
    });
  }

  deleteImageRow(id: string) {
    stmt(this.db, 'DELETE FROM images WHERE id = ?').run(id);
  }

  getImage(userId: string, id: unknown): { id: string; user_id: string; mime: string; size: number } {
    if (typeof id !== 'string') throw notFound();
    const r = stmt(this.db, 'SELECT id, user_id, mime, size FROM images WHERE id = ? AND user_id = ?').get(id, userId) as any;
    if (!r) throw notFound();
    return r;
  }

  imagePath(userId: string, id: string) {
    return path.join(this.imagesDir, userId, id);
  }

  /**
   * Delete images older than 24 hours that no note of their owner (Trash included) references. Row first, then
   * file. With a user, only that user's images (a permanent delete changes one user's links); without, everyone's
   * (start-up, daily, after a data copy). One transaction for all of them.
   */
  cleanupImages(userId?: string): number {
    const cutoff = this.now() - IMAGE_GRACE_MS;
    const victims = this.tx(() => {
      // While `data copy` runs (in this or another process), deleting is postponed to a later clean-up, so no
      // image the copy's snapshot refers to disappears. Checked inside the transaction: see dataCopy for why that
      // closes the race. Under the write lock no save can link an image meanwhile, so the NOT EXISTS below is the
      // final check.
      if (copyInProgress(this.opts.dataDir)) return [];
      const unlinked = 'created_at < ? AND NOT EXISTS (SELECT 1 FROM note_images ni WHERE ni.image_id = images.id)';
      return (
        userId === undefined
          ? stmt(this.db, `DELETE FROM images WHERE ${unlinked} RETURNING id, user_id`).all(cutoff)
          : stmt(this.db, `DELETE FROM images WHERE user_id = ? AND ${unlinked} RETURNING id, user_id`).all(userId, cutoff)
      ) as { id: string; user_id: string }[];
    });
    for (const v of victims) {
      try {
        fs.rmSync(this.imagePath(v.user_id, v.id), { force: true });
      } catch {
        // The row is gone; a file that cannot be removed now is removed by the
        // start-up reconciliation (files without a row).
      }
    }
    return victims.length;
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
    const has = stmt(this.db, 'SELECT 1 FROM images WHERE id = ? AND user_id = ?');
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
    for (const r of stmt(this.db, 'SELECT id, user_id FROM images').all() as { id: string; user_id: string }[]) {
      if (!fs.existsSync(this.imagePath(r.user_id, r.id))) {
        stmt(this.db, 'DELETE FROM images WHERE id = ?').run(r.id);
        orphanRows++;
      }
    }
    return { tmp, orphanFiles, orphanRows };
  }
}
