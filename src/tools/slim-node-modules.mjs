// Slims a production node_modules (after `npm prune --omit=dev`) for the Docker image: removes what is never read
// at run time. Source maps; better-sqlite3's SQLite and C++ sources (needed only to compile it) and its prebuilt
// binaries for other platforms (it loads build/Release when compiled, otherwise the prebuild for this platform).
// Usage: node src/tools/slim-node-modules.mjs <node_modules dir>
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'node_modules');
if (!fs.existsSync(path.join(root, '.package-lock.json')) && !fs.existsSync(path.join(root, 'fastify'))) {
  console.error(`${root} does not look like a node_modules directory`);
  process.exit(1);
}
let files = 0;
let bytes = 0;
const remove = (p) => {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) remove(path.join(p, e));
    fs.rmdirSync(p);
  } else {
    files++;
    bytes += st.size;
    fs.rmSync(p);
  }
};

// Source maps.
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith('.map')) remove(p);
  }
};
walk(root);

// better-sqlite3: sources, and every prebuild but this platform's.
const bs = path.join(root, 'better-sqlite3');
if (fs.existsSync(bs)) {
  remove(path.join(bs, 'deps'));
  remove(path.join(bs, 'src'));
  const musl = process.platform === 'linux' && fs.existsSync('/proc/self/maps') && /\/ld-musl-[^/\s]*\.so/.test(fs.readFileSync('/proc/self/maps', 'latin1'));
  const keep = `${musl ? 'linuxmusl' : process.platform}-${process.arch}.node`;
  const pre = path.join(bs, 'prebuilds');
  if (fs.existsSync(pre)) for (const f of fs.readdirSync(pre)) if (f !== keep) remove(path.join(pre, f));
}
console.log(`slim-node-modules: removed ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
