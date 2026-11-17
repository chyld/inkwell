// @vitest-environment happy-dom
// CLEANUP-PLAN pass 3 item 5: /preview and /faces requests share one limit (6 in flight in all) and one 429 pause,
// as they share the server's rate bucket. Before, each loader had its own 6 (up to 12 at once) and its own pause.
import { beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { ApiError } from '../../src/web/api';
import { PreviewLoader } from '../../src/web/fonts/previews';
import { FontRequestGate, FONT_REQUEST_LIMIT } from '../../src/web/fonts/requests';
import { clearAllFonts, FaceLoader } from '../../src/web/fonts/runtime';
import { HASH, installFontEnv } from './fonts-env';

let now: number;
let timers: { at: number; fn: () => void }[];
let previews: Map<string, { ok: (h: string) => void; fail: (e: unknown) => void }>;
let faces: Map<string, { ok: () => void }>;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const advance = async (ms: number) => {
  now += ms;
  for (const t of timers.filter((x) => x.at <= now)) t.fn();
  timers = timers.filter((x) => x.at > now);
  await flush();
};
const ids = FONT_CATALOGUE.slice(0, 20).map((f) => f.id);

function setup() {
  now = 1_000_000;
  timers = [];
  previews = new Map();
  faces = new Map();
  const deps = { now: () => now, setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }) };
  const gate = new FontRequestGate(deps);
  const p = new PreviewLoader({ ...deps, fetchPreview: (id) => new Promise((ok, fail) => previews.set(id, { ok, fail })) }, gate);
  const f = new FaceLoader(
    { ...deps, getFaces: (id) => new Promise((ok) => faces.set(id, { ok: () => ok({ faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(1) }] }) })) },
    gate,
  );
  return { p, f };
}

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
});

describe('one limit and one pause for previews and faces', () => {
  it('previews and faces together never exceed 6 in flight; a finished request lets the other kind start', async () => {
    const { p, f } = setup();
    p.setRendered('grid', ids.slice(0, 4));
    const owner = {};
    for (const id of ids.slice(10, 14)) void f.ensure(id, owner);
    await flush();
    expect(previews.size + faces.size).toBe(FONT_REQUEST_LIMIT); // 4 previews and 2 faces, not 4 + 4
    expect([previews.size, faces.size]).toEqual([4, 2]);
    previews.get(ids[0])!.ok(HASH(2));
    await flush();
    expect(faces.size).toBe(3); // the freed slot went to the next face
  });

  it('a 429 on a preview pauses the faces too, until the time given', async () => {
    const { p, f } = setup();
    p.setRendered('grid', ids.slice(0, 1));
    await flush();
    previews.get(ids[0])!.fail(new ApiError(429, 'busy', 'Too many requests.', { retryAfter: 3 }));
    await flush();
    void f.ensure(ids[10], {});
    await flush();
    expect(faces.size).toBe(0); // paused
    await advance(2999);
    expect(faces.size).toBe(0);
    await advance(1);
    expect(faces.size).toBe(1);
  });
});
