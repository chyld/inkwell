// Images (SPEC 6.5): decoded server-side, stored as files next to the database.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp, { type Metadata } from 'sharp';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { AppError, badRequest } from './errors.js';
import type { AppOptions } from './app.js';
import { MiB } from './units.js';
import { imageSrc } from '../shared/noteRules.js';

/** Served images may not run anything, even if a file's bytes say otherwise. */
export const IMAGE_CSP = "default-src 'none'; sandbox";
export const MAX_IMAGE_BYTES = 10 * MiB;
export const MAX_IMAGE_SIDE = 10_000;
const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

sharp.cache(false);

/** One decode at a time: a full decode of a large image is the most memory-hungry thing the app does. */
export const decodeStats = { active: 0, maxActive: 0 };
let decodeChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(f: () => Promise<T>): Promise<T> {
  const run = decodeChain.then(async () => {
    decodeStats.active++;
    decodeStats.maxActive = Math.max(decodeStats.maxActive, decodeStats.active);
    try {
      return await f();
    } finally {
      decodeStats.active--;
    }
  });
  decodeChain = run.catch(() => {});
  return run;
}

function fsyncPath(p: string) {
  const fd = fs.openSync(p, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const notAnImage = () => badRequest('The file is not a PNG, JPEG, GIF or WebP image that can be read.', 'invalid_image');

/** Decide the type by fully decoding the file. Throws AppError 400 if it is not acceptable. */
export function inspectImage(file: string): Promise<{ mime: string; width: number; height: number }> {
  return exclusive(() => inspectImageNow(file));
}

async function inspectImageNow(file: string): Promise<{ mime: string; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(file, { animated: true, failOn: 'error' }).metadata();
  } catch {
    throw notAnImage();
  }
  const mime = meta.format ? MIME[meta.format] : undefined;
  if (!mime) throw notAnImage();
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (width < 1 || height < 1) throw notAnImage();
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw badRequest(`The image is larger than ${MAX_IMAGE_SIDE.toLocaleString('en')} pixels on a side.`, 'invalid_image');
  }
  try {
    // stats() reads every pixel of every frame: a full decode.
    await sharp(file, { animated: true, failOn: 'error', sequentialRead: true }).stats();
  } catch {
    throw notAnImage();
  }
  return { mime, width, height };
}

export async function registerImageRoutes(api: FastifyInstance, opts: AppOptions) {
  const { store } = opts;
  await api.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 4, parts: 5, headerPairs: 100 } });

  api.post('/images', { bodyLimit: 11 * MiB }, async (req, reply) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > 11 * MiB) throw new AppError(413, 'too_large', 'An image can be at most 10 MB.');
    if (!req.isMultipart()) throw badRequest('Send the image as multipart/form-data.');
    const user = req.user!;
    fs.mkdirSync(store.tmpDir, { recursive: true });
    const tmp = path.join(store.tmpDir, `${crypto.randomUUID()}.upload`);
    try {
      const part = await req.file();
      if (!part) throw badRequest('No file was sent.');
      try {
        await pipeline(part.file, fs.createWriteStream(tmp, { flags: 'wx' }));
      } catch (e) {
        if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || part.file.truncated) {
          throw new AppError(413, 'too_large', 'An image can be at most 10 MB.');
        }
        throw e;
      }
      if (part.file.truncated) throw new AppError(413, 'too_large', 'An image can be at most 10 MB.');
      const { mime } = await inspectImage(tmp);
      const size = fs.statSync(tmp).size;
      // The file is on disk before the row says it exists, and the rename is on disk before 201.
      fsyncPath(tmp);
      const id = crypto.randomUUID();
      // One transaction checks the storage limit and inserts the row; then the file is renamed into place.
      store.images.insertImageRow(user.id, id, mime, size);
      try {
        const dest = store.images.imagePath(user.id, id);
        const created = fs.mkdirSync(path.dirname(dest), { recursive: true }) !== undefined;
        fs.renameSync(tmp, dest);
        fsyncPath(path.dirname(dest));
        if (created) fsyncPath(store.imagesDir); // the new user directory's own entry
      } catch (e) {
        store.images.deleteImageRow(id);
        throw e;
      }
      return reply.status(201).send({ id, src: imageSrc(id) });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  api.get('/images/:id', { config: { identity: true } }, async (req, reply) => {
    const img = store.images.getImage(req.user!.id, (req.params as { id: string }).id);
    // Cached copies must be revalidated with the session on every use, so a cached
    // image is never shown to someone else using the same browser. Revalidation of
    // the owner's copy is cheap: image ids never change content.
    const etag = `"${img.id}"`;
    reply
      .header('etag', etag)
      .header('cache-control', 'private, no-cache')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', IMAGE_CSP);
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    // Opened once (no separate access check); a missing file is a 404.
    let file: fs.promises.FileHandle;
    try {
      file = await fs.promises.open(store.images.imagePath(img.user_id, img.id), 'r');
    } catch {
      throw new AppError(404, 'not_found', 'Not found.');
    }
    // nosniff and the CSP are set above (and nosniff for every reply by app.ts).
    reply.header('content-type', img.mime).header('content-length', String(img.size)).header('content-disposition', 'inline');
    return reply.send(file.createReadStream());
  });
}
