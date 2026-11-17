// What every part of the store shares: one database handle, the options, the clock, the data directories and the
// one transaction helper (Store.tx, BEGIN IMMEDIATE).
import type { DB } from '../db.js';

export interface StoreOptions {
  dataDir: string;
  userQuotaBytes: number;
  agentRatePerHour: number;
  now?: () => number;
  /** Cap on the font store (default 500 MB). */
  fontCacheBytes?: number;
}

export interface StoreContext {
  db: DB;
  opts: StoreOptions;
  now: () => number;
  imagesDir: string;
  tmpDir: string;
  tx: <T>(fn: () => T) => T;
}

export const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** A part of the store (identity, notes, images, data copy): the shared handle, clock, directories and tx. */
export abstract class StorePart {
  readonly db: DB;
  readonly opts: StoreOptions;
  readonly now: () => number;
  readonly imagesDir: string;
  readonly tmpDir: string;

  constructor(private readonly ctx: StoreContext) {
    this.db = ctx.db;
    this.opts = ctx.opts;
    this.now = ctx.now;
    this.imagesDir = ctx.imagesDir;
    this.tmpDir = ctx.tmpDir;
  }

  /** Run fn in one BEGIN IMMEDIATE transaction (the store's one helper). */
  protected tx<T>(fn: () => T): T {
    return this.ctx.tx(fn);
  }
}
