// Empty Trash and local drafts (review round 2).
import { describe, expect, it, vi } from 'vitest';
import { emptyTrashFlow } from '../../src/web/trash.js';
import type { Draft, DraftStore } from '../../src/web/drafts.js';

function drafts(): DraftStore & { map: Map<string, Draft> } {
  const map = new Map<string, Draft>();
  return {
    map,
    get: (u, n) => map.get(`${u}:${n}`) ?? null,
    set: (u, n, d) => void map.set(`${u}:${n}`, d),
    remove: (u, n) => void map.delete(`${u}:${n}`),
    list: (u) => [...map.keys()].filter((k) => k.startsWith(u + ':')).map((k) => k.split(':')[1]),
    removeAllFor: () => {},
    removeAllExcept: () => {},
  };
}
const d: Draft = { title: 't', body: {}, version: 1, savedAt: 0 };

describe('Empty Trash', () => {
  it('mentions drafts of trashed notes in the confirmation and removes them with the notes', async () => {
    const store = drafts();
    store.set('u1', 'trashed-1', d);
    store.set('u1', 'live-1', d);
    const confirm = vi.fn(async (_m: string) => true);
    const r = await emptyTrashFlow({
      userId: 'u1',
      drafts: store,
      trashedIds: async () => ['trashed-1', 'trashed-2'],
      confirm,
      emptyTrash: async () => ({ deleted: 2, deletedIds: ['trashed-1', 'trashed-2'] }),
    });
    expect(r).toBe(true);
    expect(confirm.mock.calls[0][0]).toMatch(/only on this device/);
    expect(store.get('u1', 'trashed-1')).toBe(null);
    expect(store.get('u1', 'live-1')).not.toBe(null);
  });

  it('does nothing if not confirmed', async () => {
    const store = drafts();
    store.set('u1', 'trashed-1', d);
    const empty = vi.fn();
    expect(await emptyTrashFlow({ userId: 'u1', drafts: store, trashedIds: async () => ['trashed-1'], confirm: async () => false, emptyTrash: empty as any })).toBe(false);
    expect(empty).not.toHaveBeenCalled();
    expect(store.get('u1', 'trashed-1')).not.toBe(null);
  });
});
