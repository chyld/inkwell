// Acceptance criterion 7, client side: the browser's autosave logic against the real API.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';
import { NoteSaver, type SaveStatus } from '../src/web/saver.js';
import { ApiError, NetworkError } from '../src/web/api.js';
import type { Draft, DraftStore } from '../src/web/drafts.js';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv();
  c = await userClient(env, 'alice');
});
afterEach(async () => env.close());

function memDrafts(): DraftStore & { map: Map<string, Draft> } {
  const map = new Map<string, Draft>();
  return {
    map,
    get: (u, n) => map.get(`${u}:${n}`) ?? null,
    set: (u, n, d) => void map.set(`${u}:${n}`, d),
    remove: (u, n) => void map.delete(`${u}:${n}`),
    list: (u) => [...map.keys()].filter((k) => k.startsWith(u + ':')).map((k) => k.split(':')[1]),
    removeAllFor: (u) => [...map.keys()].filter((k) => k.startsWith(u + ':')).forEach((k) => map.delete(k)),
    removeAllExcept: (u) => [...map.keys()].filter((k) => !k.startsWith(u + ':')).forEach((k) => map.delete(k)),
  };
}

function makeSaver(noteId: string, version: number, opts: { fail?: () => boolean } = {}) {
  const statuses: SaveStatus[] = [];
  const conflicts: number[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let puts = 0;
  const drafts = memDrafts();
  const saver = new NoteSaver('u', noteId, version, {
    put: async (id, payload) => {
      puts++;
      if (opts.fail?.()) throw new NetworkError('down');
      const r = await c.put(`/api/notes/${id}`, payload);
      if (r.statusCode !== 200) {
        const e = r.json().error;
        const { code, message, ...extra } = e;
        throw new ApiError(r.statusCode, code, message, extra);
      }
      return r.json();
    },
    drafts,
    onStatus: (s) => statuses.push(s),
    onConflict: (v) => conflicts.push(v),
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as any);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const fire = async () => {
    const t = timers.shift();
    t?.fn();
    await new Promise((r) => setTimeout(r, 20));
    return t;
  };
  return { saver, statuses, conflicts, timers, drafts, fire, puts: () => puts };
}

describe('NoteSaver', () => {
  it('debounces 1 s, sends title, body and base version, and clears the draft only when confirmed', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const s = makeSaver(n.id, 1);
    s.saver.change('t', doc(p('a')));
    s.saver.change('t', doc(p('ab')));
    expect(s.timers).toHaveLength(1);
    expect(s.timers[0].ms).toBe(1000);
    expect(s.drafts.get('u', n.id)?.version).toBe(1);
    await s.fire();
    expect(s.puts()).toBe(1);
    expect(s.statuses.at(-1)).toBe('saved');
    expect(s.drafts.get('u', n.id)).toBe(null);
    expect((await c.get(`/api/notes/${n.id}`)).json().version).toBe(2);
  });

  it('keeps at most one save in flight and sends later changes as one further save', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const s = makeSaver(n.id, 1);
    s.saver.change('t', doc(p('1')), true);
    s.saver.change('t', doc(p('2')), true);
    s.saver.change('t', doc(p('3')), true);
    expect(await s.saver.flush(3000)).toBe(true);
    expect(s.puts()).toBe(2);
    const now = (await c.get(`/api/notes/${n.id}`)).json();
    expect(now.version).toBe(3);
    expect(now.body).toEqual(doc(p('3')));
  });

  it('on 409, "keep mine" saves with the version from the 409 and ends consistent', async () => {
    const n = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${n.id}`, { title: 'other tab', body: doc(p('theirs')), version: 1 });
    const s = makeSaver(n.id, 1);
    s.saver.change('mine', doc(p('mine')), true);
    await s.saver.flush(1000);
    expect(s.conflicts).toEqual([2]);
    expect(s.statuses.at(-1)).toBe('unsaved');
    expect(s.drafts.get('u', n.id)).not.toBe(null); // still kept locally
    s.saver.keepMine();
    expect(await s.saver.flush(3000)).toBe(true);
    const now = (await c.get(`/api/notes/${n.id}`)).json();
    expect(now).toMatchObject({ title: 'mine', body: doc(p('mine')), version: 3 });
    expect(s.saver.version).toBe(3);
    expect(s.drafts.get('u', n.id)).toBe(null);
  });

  it('on 409, "load theirs" discards the local copy and the server copy is unchanged', async () => {
    const n = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${n.id}`, { title: 'theirs', body: doc(p('theirs')), version: 1 });
    const s = makeSaver(n.id, 1);
    s.saver.change('mine', doc(p('mine')), true);
    await s.saver.flush(1000);
    s.saver.discardLocal();
    expect(s.drafts.get('u', n.id)).toBe(null);
    expect(s.saver.hasUnconfirmed()).toBe(false);
    const now = (await c.get(`/api/notes/${n.id}`)).json();
    expect(now).toMatchObject({ title: 'theirs', version: 2 });
  });

  it('retries network errors after 2, 5, then every 15 seconds', async () => {
    const n = (await c.post('/api/notes', {})).json();
    let failures = 4;
    const s = makeSaver(n.id, 1, { fail: () => failures-- > 0 });
    s.saver.change('t', doc(p('x')), true);
    await new Promise((r) => setTimeout(r, 20));
    const delays: number[] = [];
    while (s.timers.length) {
      delays.push(s.timers[0].ms);
      await s.fire();
    }
    expect(delays).toEqual([2000, 5000, 15000, 15000]);
    expect(s.statuses.at(-1)).toBe('saved');
  });

  it('does not retry 400, 404 or 413, and reports "Not saved"', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const s = makeSaver(n.id, 1);
    s.saver.change('t', { type: 'doc', content: [{ type: 'evil' }] }, true);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.statuses.at(-1)).toBe('unsaved');
    expect(s.timers).toHaveLength(0);
    expect(s.puts()).toBe(1);
    const gone = makeSaver('00000000-0000-4000-8000-000000000000', 1);
    gone.saver.change('t', doc(p('x')), true);
    await new Promise((r) => setTimeout(r, 30));
    expect(gone.statuses.at(-1)).toBe('unsaved');
    expect(gone.timers).toHaveLength(0);
  });
});

describe('NoteSaver review fixes', () => {
  function deferredPut() {
    const calls: { payload: any; resolve: (v: any) => void; reject: (e: unknown) => void }[] = [];
    const put = (_id: string, payload: any) =>
      new Promise<any>((resolve, reject) => {
        calls.push({ payload, resolve, reject });
      });
    return { put, calls };
  }
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const noTimers = { setTimer: () => ({}), clearTimer: () => {} };

  it('a save that finishes after sign-out (drafts discarded, saver disposed) writes no draft and sends nothing more', async () => {
    const drafts = memDrafts();
    const { put, calls } = deferredPut();
    const s = new NoteSaver('u', 'n1', 1, { put, drafts, onStatus: () => {}, onConflict: () => {}, ...noTimers });
    s.change('t', doc(p('first')), true);
    s.change('t', doc(p('second')), true); // made while the first save is in flight
    expect(calls).toHaveLength(1);
    // Sign-out: dispose the saver, then remove the user's drafts.
    s.dispose();
    drafts.removeAllFor('u');
    calls[0].resolve({ version: 2 });
    await tick();
    expect(drafts.map.size).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('one tab’s confirmed save does not delete a draft another tab wrote for the same note', async () => {
    const drafts = memDrafts();
    const a = deferredPut();
    const tabA = new NoteSaver('u', 'n1', 1, { put: a.put, drafts, onStatus: () => {}, onConflict: () => {}, ...noTimers });
    const tabB = new NoteSaver('u', 'n1', 1, { put: deferredPut().put, drafts, onStatus: () => {}, onConflict: () => {}, ...noTimers });
    tabA.change('A', doc(p('from A')), true);
    tabB.change('B', doc(p('from B'))); // debounced; A's draft is not overwritten (BUGFIX-LIST item 8)
    expect(drafts.get('u', 'n1')!.title).toBe('A');
    a.calls[0].resolve({ version: 2 });
    await tick();
    expect(drafts.get('u', 'n1')).toBeNull(); // A cleared only its own draft
    NoteSaver.writeAllDrafts(); // B's next chance (here pagehide) writes B's
    expect(drafts.get('u', 'n1')?.title).toBe('B');
    expect(tabB.hasUnconfirmed()).toBe(true);
  });

  it('after a save is refused because the note is in Trash, the next edit tries again (e.g. once it is restored)', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const s = makeSaver(n.id, 1);
    await c.post(`/api/notes/${n.id}/trash`);
    s.saver.change('t', doc(p('while trashed')), true);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.statuses.at(-1)).toBe('unsaved');
    expect(s.timers).toHaveLength(0); // not retried automatically
    await c.post(`/api/notes/${n.id}/restore`);
    s.saver.change('t', doc(p('after restore')), true);
    expect(await s.saver.flush(3000)).toBe(true);
    expect((await c.get(`/api/notes/${n.id}`)).json().body).toEqual(doc(p('after restore')));
  });
});

describe('NoteSaver round 2', () => {
  it('sign-out disposes every live saver, including one still flushing after a note switch', async () => {
    const drafts = memDrafts();
    let resolve: (v: any) => void = () => {};
    const calls: any[] = [];
    const put = (_id: string, payload: any) =>
      new Promise<any>((r) => {
        calls.push(payload);
        resolve = r;
      });
    const noteA = new NoteSaver('u', 'nA', 1, { put, drafts, onStatus: () => {}, onConflict: () => {}, setTimer: () => ({}), clearTimer: () => {} });
    noteA.change('t', doc(p('one')), true);
    noteA.change('t', doc(p('two')), true); // in flight + one more: still flushing after the switch
    NoteSaver.disposeAll(); // sign-out
    drafts.removeAllFor('u');
    resolve({ version: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(drafts.map.size).toBe(0);
    expect(calls).toHaveLength(1);
    expect(NoteSaver.anyUnconfirmed()).toBe(false);
  });
});


describe('the draft while typing goes on (BUGFIX-LIST item 7)', () => {
  it('10 s of typing, a keystroke every 250 ms: the draft is never more than 2 s behind, and is not written per keystroke', () => {
    let now = 1_000_000;
    const drafts = memDrafts();
    const writes: number[] = [];
    const set = drafts.set;
    drafts.set = (u, n, d) => (writes.push(now), set(u, n, d));
    const s = new NoteSaver('u', 'n1', 1, { put: async () => ({ version: 2 }), drafts, onStatus: () => {}, onConflict: () => {}, setTimer: () => ({}), clearTimer: () => {}, now: () => now });
    let text = '';
    for (let i = 0; i < 40; i++) {
      text += 'x';
      s.change('t', doc(p(text)));
      const age = now - writes[writes.length - 1];
      expect(age, `keystroke ${i}`).toBeLessThan(2000 + 250); // before: only the first keystroke's draft
      now += 250;
    }
    expect(writes.length).toBeGreaterThanOrEqual(5);
    expect(writes.length).toBeLessThanOrEqual(6); // one per 2 s, not 40
    expect(JSON.stringify(drafts.get('u', 'n1')!.body)).toContain('x'.repeat(33));
  });
});

describe('two tabs on one note (BUGFIX-LIST item 8)', () => {
  const quiet = { onStatus: () => {}, onConflict: () => {}, setTimer: () => ({}), clearTimer: () => {} };
  it("a tab's edits and successful save leave another tab's draft as it was", async () => {
    const drafts = memDrafts();
    const a = new NoteSaver('u', 'n1', 1, { ...quiet, drafts, put: () => new Promise(() => {}) }); // A's save never confirms (a conflict, offline)
    a.change('A', doc(p('A typed this')));
    expect(drafts.get('u', 'n1')!.title).toBe('A');
    const b = new NoteSaver('u', 'n1', 1, { ...quiet, drafts, put: async () => ({ version: 2 }) });
    b.change('B', doc(p('B typed this')), true); // written and sent at once; the save confirms
    await new Promise((r) => setTimeout(r, 20));
    expect(b.hasUnconfirmed()).toBe(false);
    expect(drafts.get('u', 'n1')?.title).toBe('A'); // before: replaced by B's, then deleted by B's save
    a.dispose();
    b.dispose();
  });

  it('a restored draft is taken over: this tab replaces it and clears it once saved', async () => {
    const drafts = memDrafts();
    drafts.set('u', 'n1', { title: 'old', body: doc(p('old')), version: 1, savedAt: 0, owner: 'an earlier opening' });
    const s = new NoteSaver('u', 'n1', 1, { ...quiet, drafts, put: async () => ({ version: 2 }) });
    s.takeOverDraft();
    s.change('old', doc(p('old')), true);
    await new Promise((r) => setTimeout(r, 20));
    expect(drafts.get('u', 'n1')).toBeNull();
    s.dispose();
  });
});

describe('closing an editor with changes not yet in its draft (BUGFIX-LIST item 9)', () => {
  it('a conflicted saver disposed (e.g. its note closed by Empty Trash) first writes its latest changes as the draft', async () => {
    const n = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${n.id}`, { title: 'theirs', body: doc(p('theirs')), version: 1 }); // another tab saved: version 2
    const s = makeSaver(n.id, 1);
    s.saver.change('mine', doc(p('first')), true);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.saver.isConflicted()).toBe(true);
    s.saver.change('mine', doc(p('first and later edits')));
    expect(JSON.stringify(s.drafts.get('u', n.id)!.body)).not.toContain('later edits'); // not written yet
    s.saver.dispose();
    expect(JSON.stringify(s.drafts.get('u', n.id)!.body)).toContain('first and later edits'); // before: lost
  });
});
