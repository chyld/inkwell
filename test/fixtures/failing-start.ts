// Starts the app with one extra migration that fails (used by cli.test.ts).
import { start } from '../../src/server/main.js';
import { MIGRATIONS } from '../../src/server/db.js';

await start({
  migrations: [
    ...MIGRATIONS,
    {
      version: 999,
      name: 'deliberately failing test migration',
      up: (db) => {
        db.exec('CREATE TABLE half_done (x INTEGER)');
        db.exec('INSERT INTO users (id) VALUES (NULL)'); // violates NOT NULL
      },
    },
  ],
});
