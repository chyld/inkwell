import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import type { Config } from './config.js';
import type { Store, UserRow } from './store.js';
import { AppError } from './errors.js';
import { registerApi } from './api.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export interface AppOptions {
  config: Config;
  store: Store;
  /** Where log lines go (default stdout). */
  logStream?: Writable;
  logLevel?: string;
}

export const SESSION_COOKIE = 'notes_session';
export const MiB = 1024 * 1024;

export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const IMAGE_CSP = "default-src 'none'; sandbox";

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

/** Path without query string. */
export function pathOf(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
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
      store.db.prepare('SELECT 1').get();
    } catch {
      return reply.status(503).send({ ok: false });
    }
    if (!ready) return reply.status(503).send({ ok: false });
    return { ok: true };
  });

  await app.register(async (api) => registerApi(api, opts), { prefix: '/api' });

  // Built front end (if present).
  const indexFile = path.join(config.webDir, 'index.html');
  const haveWeb = fs.existsSync(indexFile);
  if (haveWeb) {
    await app.register(fastifyStatic, { root: config.webDir, index: false, wildcard: false, serve: true, cacheControl: false });
    app.addHook('onSend', async (req, reply, payload) => {
      if (req.url.startsWith('/assets/')) reply.header('cache-control', 'public, max-age=31536000, immutable');
      return payload;
    });
  }

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const p = pathOf(req.url);
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
