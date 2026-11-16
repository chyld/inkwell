// CLEANUP-PLAN pass 1 item 4: recording a font does work proportional to that font. Full scans of the cache's
// tables and the font directory happen only when eviction may be needed (and at start-up); a replaced copy's
// files are deleted exactly. Eviction itself is covered by the font store tests.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEnv, userClient, type Env } from './helpers.js';
import type { DownloadedFile } from '../src/server/fonts/store.js';

let env: Env;
beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.close();
});

/** A downloaded file waiting in tmp, as the font service leaves it. */
function download(content: string): DownloadedFile {
  const bytes = Buffer.from(content);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(env.store.fonts.tmpDir, { recursive: true });
  const tmpPath = path.join(env.store.fonts.tmpDir, `${hash}.part`);
  fs.writeFileSync(tmpPath, bytes);
  return { hash, size: bytes.length, tmpPath };
}
const preview = (fontId: string, content: string) => {
  const f = download(content);
  env.store.fonts.record(fontId, { kind: 'preview', file: f.hash }, [f]);
  return f;
};
// The whole-cache statements the old code ran on every record.
const CACHE_WIDE = [/SELECT hash, size FROM font_files$/, /SELECT font_id, file FROM font_previews$/, /SELECT DISTINCT font_id, file FROM font_faces$/, /DELETE FROM font_files WHERE hash NOT IN/];

describe('recording a font', () => {
  it('with 200 previews cached, one more costs no cache-wide statement and no directory listing', async () => {
    for (let i = 0; i < 200; i++) preview(`fam-${i}`, `preview ${i}`);
    const readdir = vi.spyOn(fs, 'readdirSync');
    env.sql.reset();
    preview('abel', 'preview of abel');
    const wide = env.sql.executed.filter((q) => CACHE_WIDE.some((re) => re.test(q.trim())));
    if (process.env.FONT_REPORT === '1') console.log(`FONT record: executed ${env.sql.executed.length}, cache-wide ${wide.length}, readdir ${readdir.mock.calls.length}`);
    expect(wide).toEqual([]); // before: all four on every record
    expect(readdir).not.toHaveBeenCalled(); // before: the whole font directory, on every record
    expect(env.sql.executed.length).toBeLessThanOrEqual(12);
    expect(env.store.fonts.getPreview('abel')).toBeTruthy();
  });

  it('replacing a unit deletes exactly the files only it used; a file another unit uses stays', async () => {
    const shared = download('shared face');
    const only = download('only abel uses this');
    env.store.fonts.record('abel', { kind: 'faces', faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: shared.hash }, { weight: '700', style: 'normal', unicodeRange: 'U+0000-00FF', file: only.hash }] }, [shared, only]);
    env.store.fonts.record('actor', { kind: 'faces', faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: shared.hash }] }, [download('shared face')]);
    const fresh = download('abel again');
    env.store.fonts.record('abel', { kind: 'faces', faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: fresh.hash }] }, [fresh]);
    const onDisk = (h: string) => fs.existsSync(env.store.fonts.filePath(h));
    expect(onDisk(only.hash)).toBe(false); // freed with its last reference
    expect(env.store.fonts.recordedPath(only.hash)).toBeNull();
    expect(onDisk(shared.hash)).toBe(true); // actor still uses it
    expect(onDisk(fresh.hash)).toBe(true);
    expect(env.store.fonts.getFaces('abel')!.map((f) => f.file)).toEqual([fresh.hash]);
    expect(env.store.fonts.totalBytes()).toBe(shared.size + fresh.size);
  });

  it('a font file is streamed, not read whole and synchronously; a file gone from disk is a 404 and drops its units', async () => {
    const c = await userClient(env, 'alice');
    const f = preview('abel', 'woff2 bytes of abel');
    const readFileSync = vi.spyOn(fs, 'readFileSync');
    const r = await c.get(`/api/fonts/file/${f.hash}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('woff2 bytes of abel');
    expect(r.headers['content-length']).toBe(String(f.size));
    expect(r.headers['content-type']).toBe('font/woff2');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(readFileSync.mock.calls.filter((call) => String(call[0]).includes(f.hash))).toEqual([]); // before: one per request
    fs.rmSync(env.store.fonts.filePath(f.hash));
    expect((await c.get(`/api/fonts/file/${f.hash}`)).statusCode).toBe(404);
    expect(env.store.fonts.getPreview('abel')).toBeNull(); // dropped, so it is fetched again next time
  });
});
