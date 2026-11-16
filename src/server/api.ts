import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, errorBody, type AppOptions } from './app.js';
import { AppError } from './errors.js';
import { SignInLimiter } from './ratelimit.js';
import { normalizeUsername } from './store.js';
import { registerImageRoutes } from './images.js';
import { registerFontRoutes } from './fonts/routes.js';
import { registerStyleRoutes } from './styles.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) throw new AppError(400, 'invalid_request', 'Expected a JSON object.');
  return b as Record<string, unknown>;
}

export async function registerApi(api: FastifyInstance, opts: AppOptions) {
  const { config, store } = opts;
  const limiter = new SignInLimiter(store.now);

  // CSRF (SPEC 5): state-changing requests must carry Origin == https://<NOTES_HOST>.
  api.addHook('onRequest', async (req, reply) => {
    if (UNSAFE.has(req.method) && req.headers.origin !== config.origin) {
      return reply.status(403).send(errorBody('bad_origin', 'This request did not come from the notes app.'));
    }
  });

  // Session authentication: cookie only. An agent bearer token is never accepted here.
  api.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.config && (req.routeOptions.config as { public?: boolean }).public) return;
    const user = store.authenticateSession(req.cookies[SESSION_COOKIE]);
    if (!user) {
      return reply.status(401).send(errorBody('unauthorized', 'Please sign in.'));
    }
    // Every request says which user its tab is signed in as. If the shared cookie belongs to
    // someone else (another tab signed in as them), or the request does not say, it is refused,
    // so a tab can never act on an account it did not sign in to. Exceptions: GET /session, part
    // of signing in (it tells a new tab whose session the cookie holds), and GET /images/:id,
    // which an <img> element loads without custom headers (a read, owner-checked by the cookie's
    // user; a stale tab only knows its own user's image ids, so it can only get 404).
    const expected = req.headers['x-notes-user'];
    const identityOnly = (req.routeOptions.config as { identity?: boolean } | undefined)?.identity === true;
    if (!identityOnly && expected !== user.id) {
      return reply.status(401).send(errorBody('wrong_user', 'You were signed in as someone else in another tab. Please sign in again.'));
    }
    req.user = user;
  });

  api.post('/session', { config: { public: true } }, async (req, reply) => {
    const b = body(req);
    const username = normalizeUsername(typeof b.username === 'string' ? b.username : '').slice(0, 64);
    const password = typeof b.password === 'string' ? b.password : '';
    const ip = req.ip;
    const attempt = limiter.begin(username, ip);
    if (!attempt) {
      return reply.status(429).send(errorBody('rate_limited', 'Too many failed sign-in attempts. Please wait 15 minutes and try again.'));
    }
    let token: string | null = null;
    let user;
    try {
      user = await store.checkCredentials(username, password);
      // A fresh session; any session id already in the request is ignored. It is created only if
      // the password and enabled state are still the ones just verified.
      if (user) token = store.createSessionIfUnchanged(user);
    } finally {
      attempt.finish(token === null);
    }
    if (!user || token === null) {
      return reply.status(401).send(errorBody('invalid_credentials', 'Incorrect username or password.'));
    }
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_S });
    return { id: user.id, username: user.username };
  });

  // Which user the session cookie belongs to (id and username only).
  api.get('/session', { config: { identity: true } }, async (req) => ({ id: req.user!.id, username: req.user!.username }));

  api.delete('/session', async (req, reply) => {
    store.deleteSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  });

  api.get('/me', async (req) => {
    const u = req.user!;
    return { id: u.id, username: u.username, storageUsed: store.usage(u.id), storageLimit: store.opts.userQuotaBytes, inboxId: store.inboxId(u.id) };
  });

  // ---- notes ----
  api.get('/notes', async (req) => {
    const q = req.query as Record<string, unknown>;
    return store.listNotes(req.user!.id, { view: q.view || 'all', folder: q.folder, tag: q.tag, cursor: q.cursor });
  });

  api.post('/notes', async (req, reply) => {
    const b = body(req);
    const note = store.createNote(req.user!.id, b.folderId ?? null);
    return reply.status(201).send(note);
  });

  api.get('/notes/:id', async (req) => store.getNote(req.user!.id, (req.params as { id: string }).id));

  api.put('/notes/:id', async (req) => {
    const b = body(req);
    return store.saveNote(req.user!.id, (req.params as { id: string }).id, { title: b.title, body: b.body, version: b.version });
  });

  api.patch('/notes/:id', async (req) => {
    const b = body(req);
    const changes: { folderId?: unknown; tags?: unknown } = {};
    if ('folderId' in b) changes.folderId = b.folderId;
    if ('tags' in b) changes.tags = b.tags;
    return store.patchNote(req.user!.id, (req.params as { id: string }).id, changes);
  });

  api.post('/notes/:id/trash', async (req) => {
    store.trashNote(req.user!.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  api.post('/notes/:id/restore', async (req) => {
    store.restoreNote(req.user!.id, (req.params as { id: string }).id);
    return store.getNote(req.user!.id, (req.params as { id: string }).id);
  });

  api.delete('/notes/:id', async (req) => {
    store.deleteNote(req.user!.id, (req.params as { id: string }).id);
    store.cleanupImages();
    return { ok: true };
  });

  api.delete('/trash', async (req) => {
    const deletedIds = store.emptyTrash(req.user!.id);
    store.cleanupImages();
    return { deleted: deletedIds.length, deletedIds };
  });

  // ---- folders ----
  api.get('/folders', async (req) => ({ folders: store.listFolders(req.user!.id) }));

  api.post('/folders', async (req, reply) => {
    const b = body(req);
    return reply.status(201).send(store.createFolder(req.user!.id, b.name, b.parentId ?? null));
  });

  api.patch('/folders/:id', async (req) => {
    const b = body(req);
    const changes: { name?: unknown; parentId?: unknown } = {};
    if ('name' in b) changes.name = b.name;
    if ('parentId' in b) changes.parentId = b.parentId;
    store.updateFolder(req.user!.id, (req.params as { id: string }).id, changes);
    return { ok: true };
  });

  api.delete('/folders/:id', async (req) => {
    store.deleteFolder(req.user!.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- images ----
  await registerImageRoutes(api, opts);

  // ---- fonts (FONTS-SPEC 6) ----
  await registerFontRoutes(api, store, opts.fontService!);

  // ---- text styles (STYLES-SPEC 6) ----
  await registerStyleRoutes(api, store.styles);

  // ---- tags & search ----
  api.get('/tags', async (req) => ({ tags: store.listTags(req.user!.id) }));

  api.post('/search', async (req) => {
    const b = body(req);
    return store.search(req.user!.id, { query: b.query, folderId: b.folderId ?? null, tag: b.tag ?? null, unfiled: b.unfiled === true });
  });
}
