// @vitest-environment happy-dom
// FONTS-SPEC 7, progressive loading: the row arithmetic for a stated viewport (criterion 2) and the
// preview loader's queue, limit, 429 pause, 400-face limit and private names (criteria 2 and 22).
import { beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { ApiError } from '../../src/web/api';
import { columnsFor, rowsToRender, ROW_HEIGHT } from '../../src/web/fonts/grid';
import { MAX_REGISTERED_PREVIEWS, PreviewLoader } from '../../src/web/fonts/previews';
import { clearAllFonts } from '../../src/web/fonts/runtime';
import { FakeFontFace, HASH, installFontEnv, registeredFamilies } from './fonts-env';

describe('rows to render', () => {
  it('one column at 390 px, more when wider; the column count depends only on the width', () => {
    expect(columnsFor(390)).toBe(1);
    expect(columnsFor(390 - 24)).toBe(1);
    expect(columnsFor(1000)).toBe(4);
    expect(columnsFor(0)).toBe(1);
  });

  it('the rows intersecting the viewport extended by one viewport height above and below', () => {
    // 1,000 items, 4 columns: 250 rows of 92 px. Viewport 460 px high.
    expect(rowsToRender(0, 460, 1000, 1000)).toEqual({ columns: 4, rowCount: 250, first: 0, last: Math.ceil(920 / ROW_HEIGHT) - 1 });
    const mid = rowsToRender(9200, 460, 1000, 1000); // row 100 at the top of the viewport
    expect(mid.first).toBe(Math.floor((9200 - 460) / ROW_HEIGHT));
    expect(mid.last).toBe(Math.ceil((9200 + 920) / ROW_HEIGHT) - 1);
    const end = rowsToRender(249 * ROW_HEIGHT, 460, 1000, 1000);
    expect(end.last).toBe(249);
    expect(rowsToRender(0, 460, 1000, 0)).toMatchObject({ rowCount: 0, last: -1 });
    expect(rowsToRender(0, 0, 1000, 10).last).toBe(-1);
  });
});

// ---- the loader --------------------------------------------------------------------

let pending: Map<string, { ok: (h: string) => void; fail: (e: unknown) => void }>;
let now: number;
let timers: { at: number; fn: () => void }[];
function loader() {
  pending = new Map();
  now = 1_000_000;
  timers = [];
  return new PreviewLoader({
    fetchPreview: (id) => new Promise((ok, fail) => pending.set(id, { ok, fail })),
    now: () => now,
    setTimeout: (fn, ms) => timers.push({ at: now + ms, fn }),
  });
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const ids = (n: number, from = 0) => FONT_CATALOGUE.slice(from, from + n).map((f) => f.id);

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
});

describe('the preview loader', () => {
  it('loads rendered cards top to bottom, never more than 6 at once, under private preview-<id> names', async () => {
    const l = loader();
    const rendered = ids(20);
    l.setRendered('grid', rendered);
    expect([...pending.keys()]).toEqual(rendered.slice(0, 6));
    for (let i = 0; i < 20; i++) {
      const id = [...pending.keys()][0];
      pending.get(id)!.ok(HASH(i + 1));
      pending.delete(id);
      await flush();
      expect(pending.size).toBeLessThanOrEqual(6);
    }
    expect(l.maxLoading).toBe(6);
    expect(l.started).toEqual(rendered);
    expect(registeredFamilies().sort()).toEqual(rendered.map((id) => `preview-${id}`).sort());
    expect(FakeFontFace.made.every((f) => f.source.startsWith('url(/api/fonts/file/') && f.loadCalls === 1)).toBe(true);
    expect(rendered.every((id) => l.isLoaded(id))).toBe(true);
  });

  it('jumping to the end loads the end, not everything on the way; one already loading finishes; a dropped card loads when rendered again', async () => {
    const l = loader();
    const top = ids(30);
    const end = ids(10, 1500);
    l.setRendered('grid', top);
    const inFlight = [...pending.keys()];
    expect(inFlight).toEqual(top.slice(0, 6));
    l.setRendered('grid', end); // jump: the queue now holds only the end
    // The six in flight finish; then only end cards start.
    for (const id of inFlight) {
      pending.get(id)!.ok(HASH(1));
      pending.delete(id);
    }
    await flush();
    expect([...pending.keys()]).toEqual(end.slice(0, 6));
    for (const id of [...pending.keys()]) {
      pending.get(id)!.ok(HASH(2));
      pending.delete(id);
    }
    await flush();
    for (const id of [...pending.keys()]) {
      pending.get(id)!.ok(HASH(3));
      pending.delete(id);
    }
    await flush();
    expect(l.started).toEqual([...top.slice(0, 6), ...end]); // top[6..29] were skipped
    expect(l.isLoaded(top[0])).toBe(true); // in flight at the jump: allowed to finish
    // Back to the top: the skipped cards are candidates again and load.
    l.setRendered('grid', top);
    expect([...pending.keys()]).toEqual(top.slice(6, 12));
  });

  it('changing the search or category empties the queue', async () => {
    const l = loader();
    l.setRendered('grid', ids(20));
    l.setRendered('grid', ids(3, 800)); // a new search renders other cards
    expect(l.candidates()).toEqual(ids(3, 800));
  });

  it('a failure leaves the fallback; the card is a candidate again the next time it is rendered, not in a loop', async () => {
    const l = loader();
    const [a, b] = ids(2);
    l.setRendered('grid', [a, b]);
    pending.get(a)!.fail(new Error('502'));
    pending.delete(a);
    await flush();
    expect(l.isLoaded(a)).toBe(false);
    expect(pending.has(a)).toBe(false);
    l.setRendered('grid', [a, b]); // still rendered: not retried
    expect(pending.has(a)).toBe(false);
    l.setRendered('grid', [b]);
    l.setRendered('grid', [a, b]); // rendered again
    expect(pending.has(a)).toBe(true);
    // A constructor that throws, or a bad hash, is a failure too.
    FakeFontFace.throwFor.add(`preview-${b}`);
    pending.get(b)!.ok(HASH(9));
    pending.get(a)!.ok('NOT-A-HASH');
    await flush();
    expect(l.isLoaded(a) || l.isLoaded(b)).toBe(false);
    expect(registeredFamilies()).toEqual([]);
  });

  it('a 429 pauses all loading until the time given', async () => {
    const l = loader();
    const r = ids(10);
    l.setRendered('grid', r);
    pending.get(r[0])!.fail(new ApiError(429, 'font_rate_limited', 'Too many', { retryAfter: 7 }));
    pending.delete(r[0]);
    await flush();
    expect(pending.has(r[6])).toBe(false); // nothing new starts while paused
    l.setRendered('grid', r);
    expect(pending.has(r[0])).toBe(false);
    now += 7000;
    timers.filter((t) => t.at <= now).forEach((t) => t.fn());
    expect(pending.has(r[0])).toBe(true); // the card was not marked failed
  });

  it('beyond 400 registered previews, the least recently rendered are released and load again when rendered next', async () => {
    const l = loader();
    const all = ids(MAX_REGISTERED_PREVIEWS + 10);
    for (let i = 0; i < all.length; i += 6) {
      const batch = all.slice(i, i + 6);
      l.setRendered('grid', batch);
      for (const id of batch) {
        pending.get(id)!.ok(HASH(i + 1));
        pending.delete(id);
      }
      await flush();
    }
    expect(l.registeredCount).toBe(MAX_REGISTERED_PREVIEWS);
    expect(registeredFamilies().length).toBe(MAX_REGISTERED_PREVIEWS);
    const released = all.slice(0, 10);
    expect(released.every((id) => !l.isLoaded(id))).toBe(true);
    expect(all.slice(10).every((id) => l.isLoaded(id))).toBe(true);
    l.setRendered('grid', released.slice(0, 2));
    expect([...pending.keys()]).toEqual(released.slice(0, 2));
  });

  it('the chips, the menu and the grid share one queue and one limit', async () => {
    const l = loader();
    l.setRendered('chips', ids(4));
    l.setRendered('menu', ids(4, 10));
    l.setRendered('grid', ids(10, 20));
    expect(pending.size).toBe(6);
    expect([...pending.keys()]).toEqual([...ids(4), ...ids(2, 10)]);
  });

  it('sign-out removes every preview face', async () => {
    const l = loader();
    l.setRendered('grid', ids(3));
    for (const [, p] of pending) p.ok(HASH(1));
    await flush();
    expect(registeredFamilies().length).toBe(3);
    l.reset();
    expect(registeredFamilies()).toEqual([]);
  });
});
