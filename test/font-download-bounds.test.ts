// BUGFIX-LIST item 10: a broken or hostile upstream cannot fill the disk. One font operation downloads at most
// MAX_OPERATION_FILES files and MAX_OPERATION_BYTES in all; past either bound it fails before writing more, and
// nothing of it is kept. A normal font is unaffected.
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OPERATION_BYTES, MAX_OPERATION_FILES } from '../src/server/fonts/service.js';
import { makeEnv, userClient, type Client, type Env } from './helpers.js';
import { FakeUpstream } from './fonts-upstream.js';

let env: Env;
let up: FakeUpstream;
let alice: Client;
beforeEach(async () => {
  up = new FakeUpstream();
  env = await makeEnv({}, { fonts: { fetcher: up.fetcher } });
  alice = await userClient(env, 'alice');
});
afterEach(async () => env.close());

const woff2 = (n: number, size: number) => Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(size - 4, n)]);
/** An Abel faces answer with `count` latin blocks, each its own file. */
function stylesheet(count: number) {
  return Array.from({ length: count }, (_, i) => `/* latin */\n@font-face {\n  font-family: 'Abel';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/abel/f${i}.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`).join('');
}
const tmpFiles = () => (fs.existsSync(env.store.fonts.tmpDir) ? fs.readdirSync(env.store.fonts.tmpDir) : []);
const fileRequests = () => up.calls.filter((c) => c.url.includes('fonts.gstatic.com')).length;

describe('the bounds of one font download', () => {
  it(`more than ${MAX_OPERATION_FILES} files: refused before downloading any`, async () => {
    up.route = (url) => (url.includes('googleapis') ? FakeUpstream.ok(stylesheet(MAX_OPERATION_FILES + 1)) : FakeUpstream.ok(woff2(1, 1000)));
    const r = await alice.get('/api/fonts/faces/abel');
    expect(r.statusCode).toBe(502);
    expect(fileRequests()).toBe(0); // before: every one of them was downloaded
    expect(env.store.fonts.getFaces('abel')).toBeNull();
    expect(tmpFiles()).toEqual([]);
  });

  it(`more than ${MAX_OPERATION_BYTES / 1024 / 1024} MB in all: stops before writing past it, keeps nothing`, async () => {
    const size = 1.5 * 1024 * 1024; // within the 2 MB per file; 6 of them are 9 MB
    up.route = (url) => (url.includes('googleapis') ? FakeUpstream.ok(stylesheet(6)) : FakeUpstream.ok(woff2(Number(/f(\d+)/.exec(url)![1]), size)));
    const r = await alice.get('/api/fonts/faces/abel');
    expect(r.statusCode).toBe(502);
    expect(env.store.fonts.getFaces('abel')).toBeNull();
    expect(tmpFiles()).toEqual([]);
    expect(env.store.fonts.totalBytes()).toBe(0);
  });

  it('a font within the bounds is downloaded and kept as before', async () => {
    up.route = (url) => (url.includes('googleapis') ? FakeUpstream.ok(stylesheet(3)) : FakeUpstream.ok(woff2(Number(/f(\d+)/.exec(url)![1]), 5000)));
    expect((await alice.get('/api/fonts/faces/abel')).statusCode).toBe(200);
    expect(env.store.fonts.getFaces('abel')).toHaveLength(3);
  });
});
