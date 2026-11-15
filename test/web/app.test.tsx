// @vitest-environment happy-dom
// Round 3: cancelling Empty Trash, or a failed Trash listing, leaves the open note alone.
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';
import { button, click, mockFetch, render, settle, waitFor } from './harness';

const NOTE = '55555555-5555-4555-8555-555555555555';
const item = { id: NOTE, title: 'Trashed one', snippet: 'x', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: '2026-01-02T00:00:00Z', origin: { type: 'user' } };
const note = { ...item, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }, version: 2 };

let view: Awaited<ReturnType<typeof render>> | null = null;
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function openTrashedNote(trashListing: () => { status: number; json?: unknown }) {
  let listed = 0;
  mockFetch((method, path) => {
    if (path === '/api/me') return { status: 200, json: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (path.startsWith('/api/notes?view=trash')) return listed++ === 0 ? { status: 200, json: { notes: [item], nextCursor: null } } : trashListing();
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [], nextCursor: null } };
    if (path === `/api/notes/${NOTE}` && method === 'GET') return { status: 200, json: note };
    return { status: 500, json: { error: { code: 'x', message: 'unexpected' } } };
  });
  view = await render(<App />);
  await waitFor(() => !!button(view!.container, /Trash/), 3000, 'sidebar');
  await click([...view.container.querySelectorAll('.view-button')].find((b) => b.textContent?.includes('Trash')));
  await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'trash list');
  await click(view.container.querySelector('.note-item'));
  await waitFor(() => !!view!.container.querySelector('#note-title'), 3000, 'editor');
  await click(button(view.container, 'Empty Trash'));
}

describe('Empty Trash', () => {
  it('cancelling keeps the open note open', async () => {
    await openTrashedNote(() => ({ status: 200, json: { notes: [item], nextCursor: null } }));
    await waitFor(() => !!document.querySelector('.modal'), 3000, 'confirm');
    await click([...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Cancel'));
    await settle();
    expect((view!.container.querySelector('#note-title') as HTMLInputElement | null)?.value).toBe('Trashed one');
  });

  it('a failed Trash listing keeps the open note open and says so', async () => {
    await openTrashedNote(() => ({ status: 500, json: { error: { code: 'x', message: 'Something went wrong on the server.' } } }));
    await waitFor(() => document.body.textContent!.includes('Something went wrong'), 3000, 'notice');
    expect((view!.container.querySelector('#note-title') as HTMLInputElement | null)?.value).toBe('Trashed one');
  });
});
