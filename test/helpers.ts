import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig, type Config } from '../src/server/config.js';
import { openDatabase, migrate } from '../src/server/db.js';
import { Store } from '../src/server/store.js';

export const HOST = 'notes.test';
export const ORIGIN = `https://${HOST}`;
export const PASSWORD = 'correct horse battery';

export interface Env {
  dir: string;
  config: Config;
  store: Store;
  app: FastifyInstance;
  clock: { t: number };
  logs: () => string;
  close: () => Promise<void>;
}

export async function makeEnv(overrides: Record<string, string> = {}): Promise<Env> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
  const config = loadConfig({ NOTES_HOST: HOST, NOTES_DATA_DIR: dir, NOTES_WEB_DIR: path.join(dir, 'no-web'), ...overrides });
  const db = openDatabase(config.dbPath);
  migrate(db, dir);
  const clock = { t: Date.UTC(2026, 0, 1) };
  const store = new Store(db, { dataDir: dir, userQuotaBytes: config.userQuotaBytes, agentRatePerHour: config.agentRatePerHour, now: () => clock.t });
  store.reconcileImageFiles();
  const stream = new PassThrough();
  let logText = '';
  stream.on('data', (c) => (logText += c.toString()));
  const app = await buildApp({ config, store, logStream: stream });
  await app.ready();
  return {
    dir,
    config,
    store,
    app,
    clock,
    logs: () => logText,
    close: async () => {
      await app.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class Client {
  cookie = '';
  constructor(
    public env: Env,
    public ip = '172.30.87.2',
  ) {}

  async req(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (!['GET', 'HEAD'].includes(method) && !('origin' in h)) h.origin = ORIGIN;
    if (h.origin === '') delete h.origin;
    return this.env.app.inject({ method: method as any, url, payload: payload as any, headers: h, remoteAddress: this.ip });
  }

  get(url: string) {
    return this.req('GET', url);
  }
  post(url: string, payload?: unknown) {
    return this.req('POST', url, payload ?? {});
  }
  put(url: string, payload: unknown) {
    return this.req('PUT', url, payload);
  }
  patch(url: string, payload: unknown) {
    return this.req('PATCH', url, payload);
  }
  del(url: string) {
    return this.req('DELETE', url);
  }

  async signIn(username: string, password = PASSWORD) {
    const r = await this.req('POST', '/api/session', { username, password });
    if (r.statusCode === 200) {
      const c = r.cookies.find((c) => c.name === 'notes_session');
      this.cookie = `notes_session=${c!.value}`;
    }
    return r;
  }
}

export async function userClient(env: Env, username: string): Promise<Client> {
  if (!env.store.getUserByUsername(username)) await env.store.createUser(username, PASSWORD);
  const c = new Client(env);
  const r = await c.signIn(username);
  if (r.statusCode !== 200) throw new Error(`sign-in failed: ${r.body}`);
  return c;
}

export function doc(...content: unknown[]) {
  return { type: 'doc', content };
}
export function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
