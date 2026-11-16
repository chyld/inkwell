import fs from 'node:fs';
import { loadConfig, ConfigError, type Config } from './config.js';
import { openDatabase, migrate, MigrationError, MIGRATIONS, type Migration } from './db.js';
import { Store, DAY } from './store.js';
import { buildApp } from './app.js';

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  migrations?: Migration[];
}

function log(level: 'info' | 'error', msg: string) {
  process.stdout.write(JSON.stringify({ level, time: new Date().toISOString(), msg }) + '\n');
}

export async function start(opts: StartOptions = {}) {
  let config: Config;
  try {
    config = loadConfig(opts.env ?? process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      log('error', `configuration error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  try {
    migrate(db, config.dataDir, opts.migrations ?? MIGRATIONS, (m) => log('info', m));
  } catch (e) {
    if (e instanceof MigrationError) {
      log('error', `database migration failed, not starting: ${e.message}`);
      db.close();
      process.exit(1);
    }
    throw e;
  }
  const store = new Store(db, { dataDir: config.dataDir, userQuotaBytes: config.userQuotaBytes, agentRatePerHour: config.agentRatePerHour, fontCacheBytes: config.fontCacheBytes });
  const purged = store.purgeExpiredSessions();
  const rec = store.reconcileImageFiles();
  const cleaned = store.cleanupImages();
  const fontRec = store.fonts.reconcile();
  log('info', `startup: ${purged} expired sessions removed; ${rec.tmp} temp files, ${rec.orphanFiles} files without a row, ${rec.orphanRows} rows without a file, ${cleaned} unused images removed; fonts: ${fontRec.droppedUnits} units with a missing file dropped, ${fontRec.deletedFiles} unreferenced files deleted`);
  const timer = setInterval(() => {
    try {
      const n = store.cleanupImages();
      log('info', `image clean-up: ${n} unused images removed`);
    } catch (e) {
      log('error', `image clean-up failed: ${(e as Error).message}`);
    }
  }, DAY);
  timer.unref();

  const app = await buildApp({ config, store });
  await app.listen({ host: '0.0.0.0', port: config.port });
  log('info', `listening on port ${config.port} for https://${config.host}`);

  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/server/main.js')) {
  start().catch((e) => {
    log('error', `fatal: ${(e as Error).stack ?? e}`);
    process.exit(1);
  });
}
