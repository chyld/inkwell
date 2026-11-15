import path from 'node:path';

export interface Config {
  host: string;
  /** Exactly `https://<host>`; the only Origin accepted on state-changing /api requests. */
  origin: string;
  dataDir: string;
  dbPath: string;
  userQuotaBytes: number;
  agentRatePerHour: number;
  port: number;
  /** Addresses/subnets whose X-Forwarded-For is trusted (the Compose network). */
  trustProxy: string | string[] | false;
  webDir: string;
}

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export class ConfigError extends Error {}

export function parseHost(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new ConfigError('NOTES_HOST is not set. Expected a bare hostname, for example NOTES_HOST=chyld-notes.duckdns.org');
  }
  const v = value.trim().toLowerCase();
  if (!HOST_RE.test(v)) {
    throw new ConfigError(
      `NOTES_HOST="${value}" is not a bare hostname. Expected a form like NOTES_HOST=chyld-notes.duckdns.org ` +
        '(no "https://", no port, no slash).',
    );
  }
  return v;
}

function intSetting(env: NodeJS.ProcessEnv, name: string, def: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name}="${raw}" must be a whole number of at least ${min}.`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = parseHost(env.NOTES_HOST);
  const dataDir = env.NOTES_DATA_DIR || '/data';
  const proxy = env.NOTES_TRUSTED_PROXY?.trim();
  return {
    host,
    origin: `https://${host}`,
    dataDir,
    dbPath: path.join(dataDir, 'notes.db'),
    userQuotaBytes: intSetting(env, 'NOTES_USER_QUOTA_MB', 1024, 1) * 1024 * 1024,
    agentRatePerHour: intSetting(env, 'NOTES_AGENT_RATE_PER_HOUR', 60, 1),
    port: intSetting(env, 'PORT', 3000, 1),
    trustProxy: proxy ? proxy.split(',').map((s) => s.trim()) : false,
    webDir: env.NOTES_WEB_DIR || path.resolve(import.meta.dirname, '../web'),
  };
}
