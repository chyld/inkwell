// Plays "another process" that is in the middle of migrating to the next version (argv[3]):
// takes the write lock, applies the change, prints "locked", commits after a delay.
const Database = require('better-sqlite3');
const db = new Database(process.argv[2]);
db.pragma('busy_timeout = 5000');
db.exec('BEGIN IMMEDIATE');
db.exec('CREATE TABLE v2_marker (x INTEGER)');
db.pragma(`user_version = ${Number(process.argv[3])}`);
process.stdout.write('locked\n');
setTimeout(() => {
  db.exec('COMMIT');
  db.close();
}, 800);
