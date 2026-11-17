// The composition root: builds the Fastify app from its parts (logging, headers, errors, static files, /api, /mcp).
// Shared HTTP pieces live in http.ts, so no route module imports this file.
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';
import { stmt } from './db.js';
import { registerApi } from './api.js';
import { FontService } from './fonts/service.js';
import { registerMcp } from './mcp.js';
import { MiB } from './units.js';
import { errorBody, pathOf, PAGE_CSP, type AppOptions } from './http.js';

export type { AppOptions } from './http.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The font fetcher (FONTS-SPEC 5.1), reachable for tests that observe its queue. */
    fontService: FontService;
  }
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { config, store } = opts;
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? 'info',
      stream: opts.logStream ?? process.stdout,
      // Never log request or reply objects (headers, cookies); only what we pass explicitly.
      serializers: { req: () => ({}), res: () => ({}) },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'headers.authorization', 'headers.cookie'],
        censor: '[redacted]',
      },
    },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy,
    bodyLimit: 2 * MiB,
    return503OnClosing: true,
  });

  let ready = false;

  // Access log: method, path without query, status, duration. Nothing else.
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ method: req.method, path: pathOf(req.url), status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });

  // Security headers on every response.
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.getHeader('content-security-policy')) reply.header('content-security-policy', PAGE_CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    // STYLES-SPEC 6: every answer of the styles routes, errors and early refusals included.
    const p = pathOf(req.url);
    if (p === '/api/styles' || p.startsWith('/api/styles/')) reply.header('cache-control', 'private, no-store');
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(errorBody(err.code, err.message, err.extra));
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 413) return reply.status(413).send(errorBody('too_large', 'The request is too large.'));
    if (status >= 400 && status < 500) {
      return reply.status(status).send(errorBody('invalid_request', err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Unsupported content type.' : 'The request is not valid.'));
    }
    req.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.status(500).send(errorBody('internal', 'Something went wrong on the server.'));
  });

  await app.register(cookie);

  app.get('/healthz', async (_req, reply) => {
    try {
      stmt(store.db, 'SELECT 1').get();
    } catch {
      return reply.status(503).send({ ok: false });
    }
    if (!ready) return reply.status(503).send({ ok: false });
    return { ok: true };
  });

  const fontService = new FontService(store.fonts, { now: store.now, fetcher: opts.fonts?.fetcher, timers: opts.fonts?.timers });
  app.decorate('fontService', fontService);
  await app.register(async (api) => registerApi(api, { ...opts, fontService }), { prefix: '/api' });
  await app.register(async (scope) => registerMcp(scope, opts));

  // Built front end (if present).
  const indexFile = path.join(config.webDir, 'index.html');
  const haveWeb = fs.existsSync(indexFile);
  if (haveWeb) {
    await app.register(fastifyStatic, { root: config.webDir, index: false, wildcard: false, serve: true, cacheControl: false });
    app.addHook('onSend', async (req, reply, payload) => {
      // Only a file that was found is immutable; a miss must not be cached (BUGFIX-LIST item 2).
      if (req.url.startsWith('/assets/') && reply.statusCode === 200) reply.header('cache-control', 'public, max-age=31536000, immutable');
      return payload;
    });
  }

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const p = pathOf(req.url);
    // A missing /assets/ file (a chunk of an earlier build) is a 404: answering it with the page would make the
    // browser run HTML as a script.
    if (p.startsWith('/assets/')) return reply.status(404).header('cache-control', 'no-store').send(errorBody('not_found', 'Not found.'));
    if (haveWeb && (req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/') && p !== '/api' && p !== '/mcp') {
      reply.header('cache-control', 'no-cache');
      return reply.type('text/html; charset=utf-8').send(fs.createReadStream(indexFile));
    }
    return reply.status(404).send(errorBody('not_found', 'Not found.'));
  });

  app.addHook('onReady', async () => {
    ready = true;
  });

  return app;
}
