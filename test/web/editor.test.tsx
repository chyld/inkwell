// @vitest-environment happy-dom
// Browser draft and save paths in the real editor component (review findings).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { localDrafts } from '../../src/web/drafts';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';

const me = { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' };
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const serverNote = (over: Record<string, unknown> = {}) => ({
  id: NOTE_ID,
  title: 'Server title',
  body: doc('server text'),
  version: 4,
  folderId: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  trashedAt: null,
  origin: { type: 'user' },
  ...over,
});

function props(over: Record<string, unknown> = {}) {
  return {
    noteId: NOTE_ID,
    me,
    folders: [],
    allTags: [],
    autoFocusTitle: false,
    onMeta: vi.fn(),
    onTrashed: vi.fn(),
    onRestored: vi.fn(),
    onDeleted: vi.fn(),
    onTagsChanged: vi.fn(),
    onStorageChanged: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(p = props(), note = serverNote(), extra?: (m: string, path: string, b: any) => any) {
  mockFetch((method, path, body) => {
    const x = extra?.(method, path, body);
    if (x) return x;
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: note };
    if (method === 'PUT') return { status: 200, json: { version: (body?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    if (method === 'POST' && path.endsWith('/trash')) return { status: 200, json: { ok: true } };
    if (method === 'DELETE') return { status: 200, json: { ok: true } };
    return { status: 404, json: { error: { code: 'not_found', message: 'nope' } } };
  });
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(p as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
  return view;
}

const storedDraft = { title: 'Draft title', body: doc('unsaved draft text'), version: 3, savedAt: Date.now() - 60_000, owner: 'old-tab' };

describe('draft offer', () => {
  it('nothing can be typed until Restore or Discard is chosen, so the stored draft is not overwritten', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    const ed = editorOf(v.container);
    expect(ed.isEditable).toBe(false);
    expect((v.container.querySelector('#note-title') as HTMLInputElement).readOnly).toBe(true);
    await settle();
    expect(localDrafts.get('u1', NOTE_ID)?.title).toBe('Draft title');
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    await click(button(v.container, 'Discard'));
    expect(editorOf(v.container).isEditable).toBe(true);
    expect((v.container.querySelector('#note-title') as HTMLInputElement).readOnly).toBe(false);
    expect(localDrafts.get('u1', NOTE_ID)).toBe(null);
  });

  it('Restore uses the draft as it is stored now, not as it was when the note opened', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    // Another tab changed the draft meanwhile.
    localDrafts.set('u1', NOTE_ID, { ...storedDraft, title: 'Newer draft', body: doc('newer draft text'), version: 4, owner: 'other-tab' });
    await click(button(v.container, 'Restore'));
    await waitFor(() => requests.some((r) => r.method === 'PUT'), 3000, 'save');
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.body.title).toBe('Newer draft');
    expect(put.body.version).toBe(4);
    expect(JSON.stringify(put.body.body)).toContain('newer draft text');
  });

  it('a draft that was removed elsewhere is not restored', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    localDrafts.remove('u1', NOTE_ID);
    await click(button(v.container, 'Restore'));
    await settle();
    expect(button(v.container, 'Restore')).toBeUndefined();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(editorOf(v.container).getText()).toBe('server text');
  });
});

describe('Trash and Delete permanently', () => {
  it('a note whose last changes could not be saved is not moved to Trash', async () => {
    const v = await open(props(), serverNote(), (method) => (method === 'PUT' ? 'network-error' : null));
    const ed = editorOf(v.container);
    await act(async () => {
      ed.commands.insertContent(' more');
    });
    await click(button(v.container, 'Move to Trash'));
    await waitFor(() => v.container.ownerDocument.body.textContent!.includes('not moved to Trash'), 6000, 'notice');
    expect(requests.some((r) => r.path.endsWith('/trash'))).toBe(false);
  });

  it('Delete permanently mentions changes kept only on this device, and removes them', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const p = props();
    const v = await open(p, serverNote({ trashedAt: '2026-01-03T00:00:00Z' }));
    await click(button(v.container, 'Delete permanently'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    expect(document.querySelector('.modal')!.textContent).toMatch(/only on this device/);
    await click([...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Delete permanently'));
    await waitFor(() => p.onDeleted.mock.calls.length === 1, 2000, 'deleted');
    expect(localDrafts.get('u1', NOTE_ID)).toBe(null);
  });
});

describe('autosave callbacks', () => {
  it('a confirmed save reports to the current onMeta, not the one from the first render', async () => {
    const p = props();
    const v = await open(p);
    const later = vi.fn();
    await act(async () =>
      v.root.render(
        <DialogProvider>
          <NoteEditorPane {...(props({ onMeta: later }) as any)} />
        </DialogProvider>,
      ),
    );
    await act(async () => {
      editorOf(v.container).commands.insertContent(' edited');
    });
    await waitFor(() => later.mock.calls.length > 0, 4000, 'onMeta');
    expect(p.onMeta).not.toHaveBeenCalled();
  });
});
