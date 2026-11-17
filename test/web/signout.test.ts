// Sign-out (SPEC 6.3 draft privacy; review finding: offline sign-out left a live session).
import { describe, expect, it, vi } from 'vitest';
import { signOutFlow } from '../../src/web/signout.js';
import { ApiError, NetworkError } from '../../src/web/api.js';
import type { Draft, DraftStore } from '../../src/web/drafts.js';

function drafts(): DraftStore & { map: Map<string, Draft> } {
  const map = new Map<string, Draft>();
  return {
    map,
    get: (u, n) => map.get(`${u}:${n}`) ?? null,
    set: (u, n, d) => void map.set(`${u}:${n}`, d),
    removeOne: (u, n) => void map.delete(`${u}:${n}`),
    remove: (u, n) => void map.delete(`${u}:${n}`),
    list: (u) => [...map.keys()].filter((k) => k.startsWith(u + ':')).map((k) => k.split(':')[1]),
    removeAllFor: (u) => [...map.keys()].filter((k) => k.startsWith(u + ':')).forEach((k) => map.delete(k)),
    removeAllExcept: () => {},
  };
}
const d: Draft = { title: 't', body: {}, version: 1, savedAt: 0 };

function deps(over: Partial<Parameters<typeof signOutFlow>[0]> = {}) {
  const store = drafts();
  store.set('u1', 'n1', d);
  return {
    userId: 'u1',
    drafts: store,
    confirmDiscard: vi.fn(async () => true),
    deleteSession: vi.fn(async () => {}),
    disposeSaver: vi.fn(),
    notice: vi.fn(),
    ...over,
  };
}

describe('sign-out', () => {
  it('when the server cannot be reached, stays signed in, keeps the drafts and says so', async () => {
    const x = deps({ deleteSession: vi.fn(async () => Promise.reject(new NetworkError('offline'))) });
    expect(await signOutFlow(x)).toBe(false);
    expect(x.drafts.map.size).toBe(1);
    expect(x.disposeSaver).not.toHaveBeenCalled();
    expect(String(x.notice.mock.calls[0][0])).toMatch(/not signed out/i);
  });

  it('a 5xx answer is a failure too', async () => {
    const x = deps({ deleteSession: vi.fn(async () => Promise.reject(new ApiError(503, 'x', 'unavailable'))) });
    expect(await signOutFlow(x)).toBe(false);
  });

  it('succeeds when the server ended the session, or the session had already ended (401)', async () => {
    for (const del of [vi.fn(async () => {}), vi.fn(async () => Promise.reject(new ApiError(401, 'unauthorized', 'Please sign in.')))]) {
      const x = deps({ deleteSession: del });
      expect(await signOutFlow(x)).toBe(true);
      expect(x.drafts.map.size).toBe(0);
      expect(x.disposeSaver).toHaveBeenCalled();
    }
  });

  it('asks before discarding unsaved drafts, and does nothing if the user declines', async () => {
    const x = deps({ confirmDiscard: vi.fn(async () => false) });
    expect(await signOutFlow(x)).toBe(false);
    expect(x.confirmDiscard).toHaveBeenCalledWith(1);
    expect(x.deleteSession).not.toHaveBeenCalled();
    expect(x.drafts.map.size).toBe(1);
  });
});
