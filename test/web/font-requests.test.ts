// @vitest-environment happy-dom
// CLEANUP-PLAN pass 3 item 5: /preview and /faces requests share one limit (6 in flight in all) and one 429 pause,
// as they share the server's rate bucket. Before, each loader had its own 6 (up to 12 at once) and its own pause.
import { beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { ApiError } from '../../src/web/api';
import { PreviewLoader } from '../../src/web/fonts/previews';
import { FontRequestGate, FONT_REQUEST_LIMIT } from '../../src/web/fonts/requests';
import { clearAllFonts, FaceLoader, isNoteFontRegistered } from '../../src/web/fonts/runtime';
import { HASH, installFontEnv, registeredFamilies } from './fonts-env';

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

describe('requests in flight at sign-out (BUGFIX-LIST item 11)', () => {
  it('a preview and a face that answer after reset() register nothing', async () => {
    const { p, f } = setup();
    p.setRendered('grid', ids.slice(0, 1));
    const done = f.ensure(ids[10], {});
    await flush();
    p.reset();
    f.reset();
    previews.get(ids[0])!.ok(HASH(2));
    faces.get(ids[10])!.ok();
    await flush();
    expect(p.isLoaded(ids[0])).toBe(false);
    expect(registeredFamilies()).not.toContain(`preview-${ids[0]}`);
    expect(isNoteFontRegistered(ids[10])).toBe(false); // before: registered for the next user
    expect(await done).toBe(false);
  });

  // BUGFIX-LIST-2 item 6: the same font asked for in the new session, while the old request is still in flight.
  it('a font asked for again after reset() gets its own request, and is registered', async () => {
    setup();
    const deps = { now: () => now, setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }) };
    const asked: (() => void)[] = [];
    const face = { faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(1) }] };
    const f = new FaceLoader({ ...deps, getFaces: () => new Promise((ok) => asked.push(() => ok(face))) }, new FontRequestGate(deps));
    const before = f.ensure(ids[11], {});
    await flush();
    f.reset(); // sign-out, then sign-in
    const after = f.ensure(ids[11], {});
    await flush();
    expect(asked).toHaveLength(2); // before: 1, the new session joined the old request
    asked[0](); // the old answer: registers nothing
    await flush();
    expect(await before).toBe(false);
    expect(isNoteFontRegistered(ids[11])).toBe(false);
    asked[1]();
    expect(await after).toBe(true); // before: false, and the note stayed on the fallback
    expect(isNoteFontRegistered(ids[11])).toBe(true);
  });

  it('a preview asked for again after reset() is not asked for a third time when the old request ends', async () => {
    setup();
    let asked = 0;
    const deps = { now: () => now, setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }) };
    const answers: ((h: string) => void)[] = [];
    const q = new PreviewLoader({ ...deps, fetchPreview: () => (asked++, new Promise((ok) => answers.push(ok))) }, new FontRequestGate(deps));
    q.setRendered('grid', [ids[12]]);
    await flush();
    q.reset();
    q.setRendered('grid', [ids[12]]); // the new session renders it too
    await flush();
    expect(asked).toBe(2);
    answers[0](HASH(3)); // the old request ends
    await flush();
    q.setRendered('grid', [ids[12]]); // any re-render
    await flush();
    expect(asked).toBe(2); // before: 3, the old request's end took the new one out of "loading"
  });
});

describe('the 429 pause (BUGFIX-LIST item 14)', () => {
  it('a timer that fires a little early waits again; the loaders are woken once the pause is over', () => {
    let t = 0;
    const scheduled: { at: number; fn: () => void }[] = [];
    const gate = new FontRequestGate({ now: () => t, setTimeout: (fn, ms) => scheduled.push({ at: t + ms, fn }) });
    let wakes = 0;
    gate.onWake(() => wakes++);
    gate.pause(2);
    t = 1999; // the timer fires 1 ms early
    scheduled.shift()!.fn();
    expect(wakes).toBe(0);
    expect(gate.canStart()).toBe(false);
    expect(scheduled).toHaveLength(1); // before: no second timer, so nothing woke the loaders again
    t = scheduled[0].at;
    scheduled.shift()!.fn();
    expect(wakes).toBe(1);
    expect(gate.canStart()).toBe(true);
  });
});
