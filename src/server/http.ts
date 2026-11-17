// What the app and its route modules share: the request's user, the app's options, the session cookie's name,
// the page CSP and the error body. Nothing here imports a route module, so no import cycle goes through it.
import type { Writable } from 'node:stream';
import type { Config } from './config.js';
import type { SessionUser, Store } from './store.js';
import type { Timers } from './fonts/service.js';
import type { Fetcher } from './fonts/upstream.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export interface AppOptions {
  config: Config;
  store: Store;
  /** Where log lines go (default stdout). */
  logStream?: Writable;
  logLevel?: string;
  /** Font fetching (FONTS-SPEC 5.1); tests replace the upstream fetcher and the timers. */
  fonts?: { fetcher?: Fetcher; timers?: Timers };
}

export const SESSION_COOKIE = 'notes_session';

export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

/** Path without query string. */
export function pathOf(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
