// @vitest-environment happy-dom
// BUGFIX-LIST item 19: a failed GET /folders or /tags is not dropped without a word: a notice says so (once), the
// rail keeps what it had, and the request is tried again until it works.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { click, mockFetch, railButton, render, requests, resetPage, signedInBackend, waitFor } from './harness';

let failing: { folders: number; tags: number };
let view: Awaited<ReturnType<typeof render>> | null = null;
const inbox = { id: 'inbox', name: 'Inbox', parentId: null, isInbox: true, noteCount: 0, children: [] };

beforeEach(() => {
  setExpectedUser(null);
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  failing = { folders: 1, tags: 2 };
  const backend = signedInBackend(
    (_m, p) => {
      if (p.startsWith('/api/notes?')) return { status: 200, json: { notes: [], nextCursor: null } };
      if (p === '/api/styles') return { status: 200, json: [] };
      return { status: 404, json: { error: { code: 'x', message: 'x' } } };
    },
    { folders: [inbox], tags: [{ name: 'work', count: 1 }] },
  );
  mockFetch((method, path, body, headers) => {
    for (const k of ['folders', 'tags'] as const)
      if (method === 'GET' && path === `/api/${k}` && failing[k] > 0) {
        failing[k]--;
        return { status: 500, json: { error: { code: 'internal', message: 'Something went wrong on the server.' } } };
      }
    return backend(method, path, body, headers);
  });
});
afterEach(async () => {
  await resetPage(view);
  view = null;
});

const gets = (k: string) => requests.filter((r) => r.method === 'GET' && r.path === `/api/${k}`).length;
const notices = () => [...document.querySelectorAll('.notice')].map((n) => n.textContent ?? '');

describe('the folders and the tags when their first fetch fails', () => {
  it('a notice for each (once), then tried again until it works: the Inbox and the tag appear', async () => {
    view = await render(<App />);
    await waitFor(() => notices().some((t) => t.startsWith('Your folders could not be loaded')), 3000, 'the folders notice'); // before: nothing
    expect(railButton(view.container, 'Inbox')).toBeFalsy(); // no Inbox until the folders load
    await waitFor(() => !!railButton(view!.container, 'Inbox'), 5000, 'the Inbox after a retry'); // before: never
    expect(gets('folders')).toBe(2);
    // The tags failed twice: one notice, then a retry 2 s and another 4 s later.
    await waitFor(() => gets('tags') === 3, 9000, 'the tags tried again');
    expect(notices().filter((t) => t.startsWith('Your tags could not be loaded'))).toHaveLength(1);
    await click(railButton(view.container, 'Tags'));
    await waitFor(() => !!document.querySelector('.rail-panel .tag-chip'), 2000, 'the tag');
  }, 20_000);
});
