// @vitest-environment happy-dom
// The two cross-tab sequences from reviews-code4 (b01, b04), on the whole App.
// The mock server's cookie switches from Alice to Bob, as when another tab signs in as Bob.
// Like the server before this fix, it refuses a wrong X-Notes-User but accepts a request
// without one as the cookie's user: the client must never send such a request.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { App } from '../../src/web/App';
import { setExpectedUser } from '../../src/web/api';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';

const NOTE = '66666666-6666-4666-8666-666666666666';
const users: Record<string, any> = {
  alice: { id: 'alice', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox-a' },
  bob: { id: 'bob', username: 'bob', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox-b' },
};
const item = { id: NOTE, title: 'Alice note', snippet: 'x', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } };
const note = { ...item, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alice text' }] }] }, version: 1 };

let cookieUser = 'alice';
let switchedAt = 0;
let accepted: { method: string; path: string; as: string }[] = [];
let view: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  cookieUser = 'alice';
  accepted = [];
  setExpectedUser(null); // a fresh tab (module state is shared between tests)
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* ignore */
  }
  mockFetch((method, path, _body, headers) => {
    const said = headers['x-notes-user'];
    if (method === 'GET' && path === '/api/session') return { status: 200, json: { id: users[cookieUser].id, username: cookieUser } };
    if (said !== undefined && said !== cookieUser) return { status: 401, json: { error: { code: 'wrong_user', message: 'Signed in as someone else in another tab.' } } };
    accepted.push({ method, path, as: cookieUser });
    if (path === '/api/me') return { status: 200, json: users[cookieUser] };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (method === 'GET' && path.startsWith('/api/notes?')) return { status: 200, json: { notes: cookieUser === 'alice' ? [item] : [], nextCursor: null } };
    if (method === 'GET' && path === `/api/notes/${NOTE}`) return { status: 200, json: note };
    if (method === 'PUT') return { status: 200, json: { version: 2, updatedAt: '2026-01-02T00:00:00Z' } };
    if (method === 'POST' && path === '/api/notes') return { status: 201, json: { ...item, id: '77777777-7777-4777-8777-777777777777', title: '', version: 1 } };
    if (method === 'POST' && path === '/api/images') return { status: 201, json: { id: '88888888-8888-4888-8888-888888888888', src: '/api/images/88888888-8888-4888-8888-888888888888' } };
    return { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } };
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function aliceWithNoteOpen() {
  view = await render(<App />);
  await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'note list');
  await click(view.container.querySelector('.note-item'));
  await waitFor(() => !!editorOf(view!.container), 3000, 'editor');
  // Another tab signs out and signs in as Bob.
  cookieUser = 'bob';
  switchedAt = requests.length;
}

function afterSwitch() {
  return requests.slice(switchedAt);
}

function expectNothingAcceptedForBob() {
  expect(accepted.filter((a) => a.as === 'bob')).toEqual([]);
  for (const r of afterSwitch()) expect(r.headers['x-notes-user'], `${r.method} ${r.path}`).toBe('alice');
}

describe('a stale tab after another tab signed in as someone else', () => {
  it('b01: a multi-file upload stops at the first refusal and never sends a file as the other user', async () => {
    await aliceWithNoteOpen();
    const input = view!.container.querySelector('input[type=file]') as HTMLInputElement;
    const files = [1, 2, 3].map((i) => new File([new Uint8Array([137, 80, 78, 71])], `p${i}.png`, { type: 'image/png' }));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => !!button(view!.container, 'Sign in'), 4000, 'sign-in page');
    await settle();
    await settle();
    expect(afterSwitch().filter((r) => r.path === '/api/images')).toHaveLength(1);
    expectNothingAcceptedForBob();
  });

  it('b04: New note after a refused save neither creates a note for the other user nor opens their account', async () => {
    await aliceWithNoteOpen();
    await act(async () => {
      editorOf(view!.container).commands.insertContent(' typed');
    });
    await click(button(view!.container, 'New note'));
    await waitFor(() => !!button(view!.container, 'Sign in'), 5000, 'sign-in page');
    await settle();
    await settle();
    expect(afterSwitch().some((r) => r.method === 'POST' && r.path === '/api/notes')).toBe(false);
    expect(view!.container.textContent).not.toContain('bob');
    expect(button(view!.container, 'Sign in')).toBeDefined();
    expectNothingAcceptedForBob();
  });
});
