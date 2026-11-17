// @vitest-environment happy-dom
// BUGFIX-LIST item 4: a navigation that finishes late (it waited for a slow save) must not override a later one;
// the screen always matches the address. Back then Forward during a slow save.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { App } from '../../src/web/App';
import { encodeNoteId } from '../../src/shared/noteAddress';
import { editorOf, mockFetch, render, requests, resetPage, settle, signedInBackend, waitFor } from './harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path = (id: string) => `/n/${encodeNoteId(id)}`;
const item = (id: string, title: string) => ({ id, title, snippet: 'x', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } });
const note = (id: string, title: string) => ({ ...item(id, title), body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] }, version: 1 });
let finishSave: () => void;
let view: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', path(A));
  mockFetch(
    signedInBackend((method, p, b) => {
      if (p.startsWith('/api/notes?')) return { status: 200, json: { notes: [item(A, 'Alpha'), item(B, 'Bravo')], nextCursor: null } };
      if (method === 'GET' && p === `/api/notes/${A}`) return { status: 200, json: note(A, 'Alpha') };
      if (method === 'GET' && p === `/api/notes/${B}`) return { status: 200, json: note(B, 'Bravo') };
      if (method === 'PUT') return new Promise((ok) => (finishSave = () => ok({ status: 200, json: { version: b.version + 1, updatedAt: '2026-01-02T00:00:00Z' } })));
      if (p === '/api/styles') return { status: 200, json: [] };
      return { status: 404, json: { error: { code: 'x', message: 'x' } } };
    }),
  );
});
afterEach(async () => {
  await resetPage(view);
  view = null;
});

async function travel(p: string) {
  await act(async () => {
    history.replaceState({ notes: 1 }, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { notes: 1 } }));
  });
}
const title = () => (view!.container.querySelector('#note-title') as HTMLInputElement | null)?.value;

describe('navigations that finish late', () => {
  it('Back then Forward during a slow save: the note on screen is the one the address names', async () => {
    view = await render(<App />);
    await waitFor(() => title() === 'Alpha' && !!editorOf(view!.container), 4000, 'note A open');
    await act(async () => void editorOf(view!.container).commands.insertContent(' edited'));
    await travel(path(B)); // Back: waits for A's save before opening B
    await waitFor(() => requests.some((r) => r.method === 'PUT'), 3000, 'the save of A');
    await travel(path(A)); // Forward, while the save is still in flight
    await act(async () => finishSave());
    await settle();
    await settle();
    expect(location.pathname).toBe(path(A));
    expect(title()).toBe('Alpha'); // before the fix: Bravo, under the address of A
  });
});
