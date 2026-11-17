// @vitest-environment happy-dom
// BUGFIX-LIST item 3: tags pasted together, or added while a save of the tags is in flight, are all kept. One
// change builds the whole new list and sends one request; a change made meanwhile is applied to the latest list
// and sent next, in order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { clearAllFonts, setFaceLoader } from '../../src/web/fonts/runtime';
import { resetStyles } from '../../src/web/stylesStore';
import { mockFetch, render, requests, waitFor } from './harness';
import { installFontEnv } from './fonts-env';

const NOTE = '12121212-1212-4121-8121-121212121212';
const props = { noteId: NOTE, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onRemoved: vi.fn(), onTagsChanged: vi.fn(), onBack: vi.fn() };
let answers: ((tags: string[]) => void)[];
let view: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setFaceLoader(null);
  localStorage.clear();
  resetStyles();
  answers = [];
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE}`) return { status: 200, json: { id: NOTE, title: 'Tags', body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 1, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PATCH') return new Promise((ok) => answers.push(() => ok({ status: 200, json: { tags: b.tags } })));
    if (path === '/api/styles') return { status: 200, json: [] };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function type(el: Element, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const patches = () => requests.filter((r) => r.method === 'PATCH').map((r) => r.body.tags);
const chips = () => [...view!.container.querySelectorAll('.tag-editor .tag-chip')].map((c) => c.textContent);

describe('adding tags quickly', () => {
  it("pasting 'a,b,c' adds a and b in one request (c stays in the box); a tag added while it is in flight goes next", async () => {
    view = await render(
      <DialogProvider>
        <NoteEditorPane {...(props as any)} />
      </DialogProvider>,
    );
    await waitFor(() => !!view!.container.querySelector('input[aria-label="Add tag"]'), 3000, 'tag box');
    const box = view.container.querySelector('input[aria-label="Add tag"]')!;
    await type(box, 'a,b,c');
    expect(patches()).toEqual([['a', 'b']]); // before: a then b, each from the empty list (only b kept)
    expect((box as HTMLInputElement).value).toBe('c');
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(patches()).toHaveLength(1); // one request at a time
    await act(async () => answers.shift()!([]));
    await waitFor(() => patches().length === 2, 2000, 'the next request');
    expect(patches()[1]).toEqual(['a', 'b', 'c']); // applied to the latest list, not the empty one on screen
    await act(async () => answers.shift()!([]));
    await waitFor(() => chips().length === 3, 2000, 'chips');
    expect(chips()).toEqual(['#a', '#b', '#c']);
  });
});
