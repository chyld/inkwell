// Acceptance criterion 10, plus the image parts of 2 and 14.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    const r = env.store.dataCopy(dest);
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
