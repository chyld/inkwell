// Acceptance criterion 10, plus the image parts of 2 and 14.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEnv, userClient, upload, doc, p, type Client, type Env } from './helpers.js';
import { DAY, HOUR } from '../src/server/store.js';

let env: Env;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  env = await makeEnv();
  alice = await userClient(env, 'alice');
  bob = await userClient(env, 'bob');
});
afterEach(async () => env.close());

const img = (w = 8, h = 6) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } });
const imageNode = (src: string) => ({ type: 'image', attrs: { src, alt: 'pic' } });

async function put(c: Client, title: string, ...content: unknown[]) {
  const n = (await c.post('/api/notes', {})).json();
  const r = await c.put(`/api/notes/${n.id}`, { title, body: doc(...content), version: 1 });
  return { id: n.id as string, r };
}

describe('image upload', () => {
  it('accepts PNG, JPEG, GIF and WebP, decided by decoding, and serves the original bytes', async () => {
    const files: [string, Buffer, string][] = [
      ['a.png', await img().png().toBuffer(), 'image/png'],
      ['a.jpg', await img().jpeg().toBuffer(), 'image/jpeg'],
      ['a.gif', await img().gif().toBuffer(), 'image/gif'],
      ['a.webp', await img().webp().toBuffer(), 'image/webp'],
    ];
    for (const [name, data, mime] of files) {
      // Declared type and name are ignored: send everything as octet-stream named .txt.
      const r = await upload(alice, name.replace(/\.\w+$/, '.txt'), 'application/octet-stream', data);
      expect(r.statusCode, name).toBe(201);
      const { id, src } = r.json();
      expect(src).toBe(`/api/images/${id}`);
      const g = await alice.get(src);
      expect(g.statusCode).toBe(200);
      expect(g.headers['content-type']).toBe(mime);
      expect(g.headers['x-content-type-options']).toBe('nosniff');
      expect(g.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(String(g.headers['cache-control'])).toMatch(/^private/);
      expect(Buffer.compare(g.rawPayload, data)).toBe(0);
    }
  });

  it('refuses anything that is not a decodable PNG, JPEG, GIF or WebP', async () => {
    const png = await img().png().toBuffer();
    const bad: [string, Buffer][] = [
      ['text', Buffer.from('hello, I am not an image')],
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')],
      ['tiff', await img().tiff().toBuffer()],
      ['truncated png', png.subarray(0, png.length - 20)],
      ['png header + garbage', Buffer.concat([png.subarray(0, 40), crypto.randomBytes(400)])],
      ['html', Buffer.from('<!doctype html><script>alert(1)</script>')],
      ['empty', Buffer.alloc(0)],
      ['too wide', await img(10_001, 1).png().toBuffer()],
      ['too tall', await img(1, 10_001).png().toBuffer()],
    ];
    for (const [name, data] of bad) {
      const r = await upload(alice, 'x.png', 'image/png', data);
      expect(r.statusCode, name).toBe(400);
    }
    expect((await upload(alice, 'edge.png', 'image/png', await img(10_000, 1).png().toBuffer())).statusCode).toBe(201);
    expect(env.store.db.prepare('SELECT count(*) c FROM images').get()).toEqual({ c: 1 });
    expect(fs.readdirSync(env.store.tmpDir)).toEqual([]);
  });

  it('refuses files over 10 MB with 413 and records nothing', async () => {
    const big = Buffer.concat([await img().png().toBuffer(), crypto.randomBytes(10 * 1024 * 1024)]);
    const r = await upload(alice, 'big.png', 'image/png', big);
    expect(r.statusCode).toBe(413);
    expect(env.store.db.prepare('SELECT count(*) c FROM images').get()).toEqual({ c: 0 });
    expect(fs.readdirSync(env.store.tmpDir)).toEqual([]);
  });

  it('requires a session and the app Origin', async () => {
    const data = await img().png().toBuffer();
    const anon = new (alice.constructor as any)(env) as Client;
    expect((await upload(anon, 'a.png', 'image/png', data)).statusCode).toBe(401);
    const m = (await import('./helpers.js')).multipart('a.png', 'image/png', data);
    expect((await alice.req('POST', '/api/images', m.payload, { ...m.headers, origin: 'https://evil.example' })).statusCode).toBe(403);
  });
});

describe('image ownership', () => {
  it('an image is never served to another user, and cannot be used in their notes', async () => {
    const { id, src } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const r = await bob.get(src);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual((await bob.get('/api/images/00000000-0000-4000-8000-000000000000')).json());
    const anon = await env.app.inject({ method: 'GET', url: src });
    expect(anon.statusCode).toBe(401);
    const { r: save } = await put(bob, 'steal', imageNode(src));
    expect(save.statusCode).toBe(400);
    // The owner can use it.
    const { r: ok } = await put(alice, 'mine', p('see'), imageNode(src));
    expect(ok.statusCode).toBe(200);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('external and data: image sources are refused', async () => {
    for (const src of ['https://example.com/a.png', 'data:image/png;base64,AAAA', '/api/images/../../etc/passwd', '//evil.example/a.png']) {
      const { r } = await put(alice, 'x', imageNode(src));
      expect(r.statusCode, src).toBe(400);
    }
  });
});

describe('image clean-up', () => {
  it('an image used in two notes survives the permanent deletion of one of them', async () => {
    const { src, id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const one = await put(alice, 'one', imageNode(src));
    const two = await put(alice, 'two', p('copy'), imageNode(src));
    env.clock.t += 2 * DAY;
    await alice.post(`/api/notes/${one.id}/trash`);
    expect((await alice.del(`/api/notes/${one.id}`)).statusCode).toBe(200);
    env.store.cleanupImages();
    expect((await alice.get(src)).statusCode).toBe(200);
    // Still referenced from Trash: kept.
    await alice.post(`/api/notes/${two.id}/trash`);
    env.store.cleanupImages();
    expect((await alice.get(src)).statusCode).toBe(200);
    // Empty Trash removes the last reference; the image is old, so it goes (row first, then file).
    expect((await alice.del('/api/trash')).statusCode).toBe(200);
    expect((await alice.get(src)).statusCode).toBe(404);
    expect(fs.existsSync(env.store.imagePath(env.store.getUserByUsername('alice')!.id, id))).toBe(false);
  });

  it('an unreferenced image older than 24 hours is removed; a younger one is kept', async () => {
    const old = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    env.clock.t += 20 * HOUR;
    const young = (await upload(alice, 'b.png', 'image/png', await img().png().toBuffer())).json();
    env.clock.t += 5 * HOUR;
    expect(env.store.cleanupImages()).toBe(1);
    expect((await alice.get(old.src)).statusCode).toBe(404);
    expect((await alice.get(young.src)).statusCode).toBe(200);
    // A save that drops the reference makes an old image eligible.
    const n = await put(alice, 'n', imageNode(young.src));
    env.clock.t += 2 * DAY;
    expect(env.store.cleanupImages()).toBe(0);
    await alice.put(`/api/notes/${n.id}`, { title: 'n', body: doc(p('no image now')), version: 2 });
    expect(env.store.cleanupImages()).toBe(1);
    expect((await alice.get(young.src)).statusCode).toBe(404);
  });

  it('start-up removes leftover temporary files, files with no row and rows with no file', async () => {
    const keep = (await upload(alice, 'k.png', 'image/png', await img().png().toBuffer())).json();
    const rowOnly = (await upload(alice, 'r.png', 'image/png', await img().png().toBuffer())).json();
    const aliceId = env.store.getUserByUsername('alice')!.id;
    fs.rmSync(env.store.imagePath(aliceId, rowOnly.id));
    fs.writeFileSync(path.join(env.store.tmpDir, 'leftover.upload'), 'x');
    const orphan = env.store.imagePath(aliceId, crypto.randomUUID());
    fs.writeFileSync(orphan, 'x');
    fs.mkdirSync(path.join(env.store.imagesDir, 'not-a-user'));
    fs.writeFileSync(path.join(env.store.imagesDir, 'not-a-user', 'f'), 'x');
    const r = env.store.reconcileImageFiles();
    expect(r).toEqual({ tmp: 1, orphanFiles: 2, orphanRows: 1 });
    expect(fs.existsSync(orphan)).toBe(false);
    expect(env.store.db.prepare('SELECT id FROM images').all()).toEqual([{ id: keep.id }]);
    expect((await alice.get(keep.src)).statusCode).toBe(200);
  });

  it('images count toward the storage limit; an upload over it is refused and leaves nothing behind', async () => {
    await env.close();
    env = await makeEnv({ NOTES_USER_QUOTA_MB: '1' });
    alice = await userClient(env, 'alice');
    const noisy = await sharp(crypto.randomBytes(400 * 400 * 3), { raw: { width: 400, height: 400, channels: 3 } }).png().toBuffer();
    expect(noisy.length).toBeGreaterThan(400_000);
    expect((await upload(alice, 'a.png', 'image/png', noisy)).statusCode).toBe(201);
    expect((await upload(alice, 'b.png', 'image/png', noisy)).statusCode).toBe(201);
    const used = (await alice.get('/api/me')).json().storageUsed;
    expect(used).toBe(2 * noisy.length);
    const r = await upload(alice, 'c.png', 'image/png', noisy);
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('storage_limit');
    expect((await alice.get('/api/me')).json().storageUsed).toBe(used);
    expect(env.store.db.prepare('SELECT count(*) c FROM images').get()).toEqual({ c: 2 });
    expect(fs.readdirSync(env.store.tmpDir)).toEqual([]);
    const aliceDir = path.join(env.store.imagesDir, env.store.getUserByUsername('alice')!.id);
    expect(fs.readdirSync(aliceDir)).toHaveLength(2);
  });

  it('data copy includes the image files', async () => {
    const { id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const dest = path.join(env.dir, 'copy');
    const r = await env.store.dataCopy(dest);
    expect(r.images).toBe(1);
    const aliceId = env.store.getUserByUsername('alice')!.id;
    expect(fs.existsSync(path.join(dest, 'images', aliceId, id))).toBe(true);
  });

  it('user delete removes the user’s image files', async () => {
    await upload(alice, 'a.png', 'image/png', await img().png().toBuffer());
    const aliceId = env.store.getUserByUsername('alice')!.id;
    expect(fs.existsSync(path.join(env.store.imagesDir, aliceId))).toBe(true);
    env.store.deleteUser('alice');
    expect(fs.existsSync(path.join(env.store.imagesDir, aliceId))).toBe(false);
    expect(env.store.db.prepare('SELECT count(*) c FROM images').get()).toEqual({ c: 0 });
  });
});

describe('image review fixes', () => {
  it('a cached image must be revalidated (with the session) before reuse, so another user of the browser cannot see it', async () => {
    const { src } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const first = await alice.get(src);
    const cc = String(first.headers['cache-control']);
    expect(cc).toMatch(/\bprivate\b/);
    expect(cc).toMatch(/\bno-cache\b/);
    expect(cc).not.toMatch(/immutable|max-age=[1-9]/);
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^".+"$/);
    // The owner revalidates cheaply; anyone else still gets 404, never 304.
    const notModified = await alice.req('GET', src, undefined, { 'if-none-match': etag });
    expect(notModified.statusCode).toBe(304);
    // A 304's headers are merged into the cached copy, so it must carry the image's sandbox CSP.
    expect(notModified.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect((await bob.req('GET', src, undefined, { 'if-none-match': etag })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'GET', url: src, headers: { 'if-none-match': etag } })).statusCode).toBe(401);
  });

  it('data copy fails, and leaves no partial directory, if an image file is missing', async () => {
    const { id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    fs.rmSync(env.store.imagePath(env.store.getUserByUsername('alice')!.id, id));
    const dest = path.join(env.dir, 'copy-missing');
    await expect(env.store.dataCopy(dest)).rejects.toThrow(/missing/i);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readdirSync(env.dir).filter((f) => f.startsWith('copy-missing'))).toEqual([]);
  });

  // Round 2: this test used to assert that the copy holds the write lock. That lock was the
  // regression (it stalled the app's writes), so the test now checks what the lock was for:
  // clean-up cannot remove an image the copy needs, even when it runs in the middle.
  it('image clean-up that runs in the middle of a data copy does not remove an image the copy needs', async () => {
    const { src, id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const n = await put(alice, 'n', imageNode(src));
    env.clock.t += 2 * DAY;
    await alice.post(`/api/notes/${n.id}/trash`);
    const aliceId = env.store.getUserByUsername('alice')!.id;
    const dest = path.join(env.dir, 'copy-cleanup');
    await env.store.dataCopy(dest, {
      afterSnapshot: async () => {
        // The snapshot still has the note and the image; now the note is deleted permanently,
        // which runs the clean-up for an unreferenced image older than 24 hours.
        expect((await alice.del(`/api/notes/${n.id}`)).statusCode).toBe(200);
      },
    });
    expect(fs.existsSync(path.join(dest, 'images', aliceId, id))).toBe(true);
    // Round 3: the postponed clean-up runs as soon as the copy ends (this used to call
    // cleanupImages() by hand here; now nothing has to).
    expect(fs.existsSync(env.store.imagePath(aliceId, id))).toBe(false);
    expect(env.store.db.prepare('SELECT count(*) c FROM images WHERE id = ?').get(id)).toEqual({ c: 0 });
  });

  it('data copy does not block the running app’s writes', async () => {
    await upload(alice, 'a.png', 'image/png', await img().png().toBuffer());
    const other = new (await import('better-sqlite3')).default(path.join(env.dir, 'notes.db'));
    other.pragma('busy_timeout = 0');
    let wrote = false;
    await env.store.dataCopy(path.join(env.dir, 'copy-nolock'), {
      afterSnapshot: () => {
        other.prepare("UPDATE users SET created_at = created_at WHERE username = 'alice'").run();
        wrote = true;
      },
    });
    other.close();
    expect(wrote).toBe(true);
  });

  it('an image whose file is renamed into place just after the snapshot is copied, not reported missing', async () => {
    const { id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const file = env.store.imagePath(env.store.getUserByUsername('alice')!.id, id);
    const aside = file + '.aside';
    const dest = path.join(env.dir, 'copy-upload');
    await env.store.dataCopy(dest, {
      afterSnapshot: () => {
        // As during an upload: the row is committed, the rename follows a moment later.
        fs.renameSync(file, aside);
        setTimeout(() => fs.renameSync(aside, file), 200);
      },
    });
    expect(fs.existsSync(path.join(dest, 'images', env.store.getUserByUsername('alice')!.id, id))).toBe(true);
  });

  it('the target directory appears only when the copy is complete; a partial one from an interrupted run does not block the next', async () => {
    await upload(alice, 'a.png', 'image/png', await img().png().toBuffer());
    const dest = path.join(env.dir, 'copy-target');
    const stale = `${dest}.partial-999999999`; // left by a copy that was killed
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, 'notes.db'), 'half');
    let seenDuring = true;
    await env.store.dataCopy(dest, { afterSnapshot: () => void (seenDuring = fs.existsSync(dest)) });
    expect(seenDuring).toBe(false);
    expect(fs.existsSync(path.join(dest, 'notes.db'))).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.readdirSync(env.dir).filter((f) => f.includes('.partial-'))).toEqual([]);
  });

  it('decodes one image at a time, however many uploads arrive together', async () => {
    const { decodeStats } = await import('../src/server/images.js');
    decodeStats.maxActive = 0;
    const data = await img(800, 800).png().toBuffer();
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => upload(alice, `p${i}.png`, 'image/png', data)));
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(decodeStats.maxActive).toBe(1);
  });

  it('a file that cannot be unlinked does not turn a committed delete into an error', async () => {
    const { src } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const n = await put(alice, 'n', imageNode(src));
    env.clock.t += 2 * DAY;
    await alice.post(`/api/notes/${n.id}/trash`);
    const dir = path.join(env.store.imagesDir, env.store.getUserByUsername('alice')!.id);
    fs.chmodSync(dir, 0o555);
    try {
      const r = await alice.del(`/api/notes/${n.id}`);
      expect(r.statusCode).toBe(200);
      expect((await alice.get(src)).statusCode).toBe(404);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    // The stranded file is removed by the start-up reconciliation.
    expect(env.store.reconcileImageFiles().orphanFiles).toBe(1);
  });
});

describe('image review fixes, round 2', () => {
  it('syncs the uploaded file before recording it, and its directory after the rename', async () => {
    const calls: string[] = [];
    const realFsync = fs.fsyncSync;
    const realInsert = env.store.insertImageRow.bind(env.store);
    const spy = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd: number) => {
      calls.push(fs.fstatSync(fd).isDirectory() ? 'fsync-dir' : 'fsync-file');
      return realFsync(fd);
    });
    env.store.insertImageRow = (...a: Parameters<typeof realInsert>) => {
      calls.push('insert-row');
      return realInsert(...a);
    };
    try {
      expect((await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).statusCode).toBe(201);
    } finally {
      spy.mockRestore();
      env.store.insertImageRow = realInsert;
    }
    // Round 3: a first upload creates the user's directory, so images/ (its parent) is synced too.
    expect(calls).toEqual(['fsync-file', 'insert-row', 'fsync-dir', 'fsync-dir']);
    const dirs: string[] = [];
    const spy2 = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd: number) => {
      if (fs.fstatSync(fd).isDirectory()) dirs.push(String(fs.fstatSync(fd).ino));
      return realFsync(fd);
    });
    try {
      expect((await upload(alice, 'b.png', 'image/png', await img().png().toBuffer())).statusCode).toBe(201);
    } finally {
      spy2.mockRestore();
    }
    // Later uploads: the user's directory already exists, only it is synced.
    expect(dirs).toEqual([String(fs.statSync(path.join(env.store.imagesDir, env.store.getUserByUsername('alice')!.id)).ino)]);
  });
});

describe('image review fixes, round 3', () => {
  it('an image can be shown by an <img> element (which cannot send X-Notes-User), still only to its owner', async () => {
    const { src } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    expect((await alice.req('GET', src, undefined, { 'x-notes-user': '' })).statusCode).toBe(200);
    expect((await bob.req('GET', src, undefined, { 'x-notes-user': '' })).statusCode).toBe(404);
    // Only reading an image is exempt; uploading one still needs the header.
    const m = (await import('./helpers.js')).multipart('a.png', 'image/png', await img().png().toBuffer());
    expect((await alice.req('POST', '/api/images', m.payload, { ...m.headers, 'x-notes-user': '' })).statusCode).toBe(401);
  });

  it('deleting a user during a data copy does not remove image files the copy needs; they go when it ends', async () => {
    const { id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const aliceId = env.store.getUserByUsername('alice')!.id;
    const dest = path.join(env.dir, 'copy-userdel');
    await env.store.dataCopy(dest, { afterSnapshot: () => env.store.deleteUser('alice') });
    expect(fs.existsSync(path.join(dest, 'images', aliceId, id))).toBe(true);
    expect(fs.existsSync(path.join(env.store.imagesDir, aliceId))).toBe(false);
  });

  it('an image clean-up postponed by a data copy runs when the copy ends', async () => {
    const { id } = (await upload(alice, 'a.png', 'image/png', await img().png().toBuffer())).json();
    const aliceId = env.store.getUserByUsername('alice')!.id;
    env.clock.t += 2 * DAY; // old enough, and used by no note
    await env.store.dataCopy(path.join(env.dir, 'copy-postponed'), {
      afterSnapshot: () => expect(env.store.cleanupImages()).toBe(0), // postponed during the copy
    });
    expect(fs.existsSync(env.store.imagePath(aliceId, id))).toBe(false);
    expect((await alice.get(`/api/images/${id}`)).statusCode).toBe(404);
  });

  it('a save that refers to an image removed by clean-up gets a clear error naming the image', async () => {
    const missing = '33333333-3333-4333-8333-333333333333';
    const n = (await alice.post('/api/notes', {})).json();
    const r = await alice.put(`/api/notes/${n.id}`, { title: 't', body: doc(p('x'), imageNode(`/api/images/${missing}`)), version: 1 });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('image_missing');
    expect(r.json().error.images).toEqual([missing]);
    expect(r.json().error.message).toMatch(/24 hours/);
  });
});

