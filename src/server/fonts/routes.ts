// /api/fonts (FONTS-SPEC 6). Session and X-Notes-User as everywhere under /api, except
// GET /file/:hash, which the browser's font loader requests without custom headers.
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, notFound } from '../errors.js';
import type { Store } from '../store.js';
import { COLLECTION_MAX, FONT_HASH_RE, fontById, type FontEntry } from '../../shared/fonts.js';
import type { FontService } from './service.js';

const collectionFull = () => new AppError(409, 'collection_full', `You can keep at most ${COLLECTION_MAX} fonts. Remove one to add another.`);
const retired = () => new AppError(409, 'retired', 'This font is no longer available from Google Fonts.');

/** The catalogue entry named by :id, checked against the snapshot before any use. */
function entry(req: FastifyRequest): FontEntry {
  const f = fontById((req.params as { id?: unknown }).id);
  if (!f) throw notFound();
  return f;
}

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'private, no-store');

/** Run a fetching step; a rate-limit refusal carries Retry-After in whole seconds. */
async function fetching<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && typeof e.extra.retryAfter === 'number') reply.header('retry-after', String(e.extra.retryAfter));
    throw e;
  }
}

export async function registerFontRoutes(api: FastifyInstance, store: Store, fonts: FontService) {
  api.get('/fonts/collection', async (req, reply) => {
    noStore(reply);
    return store.fonts.collection(req.user!.id);
  });

  api.put('/fonts/collection/:id', async (req, reply) => {
    const f = entry(req);
    const userId = req.user!.id;
    noStore(reply);
    if (store.fonts.inCollection(userId, f.id)) return reply.status(200).send({ id: f.id }); // nothing fetched, the row untouched
    if (f.retired) throw retired();
    if (store.fonts.collectionCount(userId) >= COLLECTION_MAX) throw collectionFull(); // no upstream request
    await fetching(reply, () => fonts.ensureFaces(userId, f)); // on failure the collection is unchanged
    const r = store.fonts.addToCollection(userId, f.id); // the count checked again, in one transaction
    if (r === 'full') throw collectionFull();
    return reply.status(r === 'added' ? 201 : 200).send({ id: f.id });
  });

  api.delete('/fonts/collection/:id', async (req, reply) => {
    const f = entry(req);
    noStore(reply);
    store.fonts.removeFromCollection(req.user!.id, f.id);
    return { ok: true };
  });

  api.get('/fonts/preview/:id', async (req, reply) => {
    const f = entry(req);
    noStore(reply);
    return { file: await fetching(reply, () => fonts.preview(req.user!.id, f)) };
  });

  api.get('/fonts/faces/:id', async (req, reply) => {
    const f = entry(req);
    noStore(reply);
    return { faces: await fetching(reply, () => fonts.faces(req.user!.id, f)) };
  });

  api.get('/fonts/file/:hash', { config: { identity: true } }, async (req, reply) => {
    const hash = (req.params as { hash?: unknown }).hash;
    if (typeof hash !== 'string' || !FONT_HASH_RE.test(hash)) throw notFound();
    const p = store.fonts.recordedPath(hash); // the only request value in a path: matched and found in the tables
    if (!p) throw notFound();
    // Opened once, asynchronously, and streamed (it was read whole and synchronously, up to 2 MB per request).
    let file: fs.promises.FileHandle;
    let size: number;
    try {
      file = await fs.promises.open(p, 'r');
      size = (await file.stat()).size;
    } catch {
      store.fonts.fileFor(hash); // gone: drops the units that refer to it
      throw notFound();
    }
    // Public, identical for every user and named by its content: a browser may keep it.
    reply.header('content-type', 'font/woff2');
    reply.header('content-length', String(size));
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(file.createReadStream());
  });
}
