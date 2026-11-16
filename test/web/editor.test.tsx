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

describe('draft offer, round 2', () => {
  it('tags and Move to… are also locked while the offer is open', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    expect(v.container.querySelector('input[aria-label="Add tag"]')).toBe(null);
    expect((button(v.container, 'Move to…') as HTMLButtonElement).disabled).toBe(true);
    await click(button(v.container, 'Discard'));
    expect(v.container.querySelector('input[aria-label="Add tag"]')).not.toBe(null);
    expect((button(v.container, 'Move to…') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Discard keeps a newer draft another tab wrote after the offer appeared, and offers that one', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    const newer = { ...storedDraft, title: 'Other tab', body: doc('other tab text'), savedAt: Date.now(), owner: 'other-tab' };
    localDrafts.set('u1', NOTE_ID, newer);
    await click(button(v.container, 'Discard'));
    expect(localDrafts.get('u1', NOTE_ID)?.title).toBe('Other tab');
    expect(button(v.container, 'Restore')).toBeDefined(); // the offer stays, now for the newer draft
    await click(button(v.container, 'Discard'));
    expect(localDrafts.get('u1', NOTE_ID)).toBe(null);
  });

  it('a note with changes stored only on this device is not moved to Trash', async () => {
    localDrafts.set('u1', NOTE_ID, storedDraft);
    const v = await open();
    await waitFor(() => !!button(v.container, 'Restore'), 2000, 'restore banner');
    const t = button(v.container, 'Move to Trash');
    if (t && !t.disabled) await click(t);
    await settle();
    expect(requests.some((r) => r.path.endsWith('/trash'))).toBe(false);
    expect(localDrafts.get('u1', NOTE_ID)).not.toBe(null);
  });
});

describe('round 3', () => {
  it('when Trash is refused because another tab left a draft, that draft is offered', async () => {
    const v = await open();
    localDrafts.set('u1', NOTE_ID, { ...storedDraft, owner: 'closed-tab' }); // written by another tab after this one opened
    await click(button(v.container, 'Move to Trash'));
    await waitFor(() => !!button(v.container, 'Restore'), 3000, 'restore offer');
    expect(requests.some((r) => r.path.endsWith('/trash'))).toBe(false);
  });

  it('a save refused because an image no longer exists says so and offers to remove it', async () => {
    const missing = '44444444-4444-4444-8444-444444444444';
    const withImage = serverNote({ body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'server text' }] }, { type: 'image', attrs: { src: `/api/images/${missing}`, alt: 'gone', title: null, width: null, height: null } }] } });
    const v = await open(props(), withImage, (method, _path, body) =>
      method === 'PUT' && JSON.stringify(body.body).includes(missing)
        ? { status: 400, json: { error: { code: 'image_missing', message: 'The note refers to an image that no longer exists (an image that no note uses is removed after 24 hours). Remove it from the note to save.', images: [missing] } } }
        : null,
    );
    await act(async () => {
      editorOf(v.container).commands.insertContent(' edit');
    });
    await waitFor(() => !!button(v.container, 'Remove missing images'), 4000, 'remove button');
    expect(v.container.textContent).toMatch(/no longer exists/);
    await click(button(v.container, 'Remove missing images'));
    await waitFor(() => requests.some((r) => r.method === 'PUT' && !JSON.stringify(r.body.body).includes(missing)), 4000, 'save without the image');
    await waitFor(() => v.container.querySelector('.save-status')?.textContent === 'Saved', 4000, 'saved');
  });
});


// REDESIGN-BRIEF 2.3: one slim line (folder and tags left; dates, status, Move to Trash right), then the toolbar
// pill, the banners, and the paper with the title on it. Replaces the earlier 'title above the toolbar' layout.
describe('editor layout: the slim line, the toolbar, then the paper with the title and the body', () => {
  const focusable = (root: Element) =>
    [...root.querySelectorAll<HTMLElement>('button, input, [contenteditable="true"]')].filter((e) => !e.closest('datalist')).map((e) => e.getAttribute('aria-label') ?? e.textContent);

  it('puts folder, tags, dates and save status in the slim line, then the toolbar, then the paper with the title', async () => {
    const v = await open(props(), serverNote({ tags: ['work'] }));
    const pane = v.container.querySelector('.editor-pane')!;
    const header = pane.querySelector('.editor-header')!;
    expect(header.querySelector('[aria-label="Move to…"]')).toBeTruthy();
    expect(header.querySelector('.tag-editor')?.textContent).toContain('#work');
    expect(header.querySelector('input[aria-label="Add tag"]')).toBeTruthy();
    expect(header.querySelector('.editor-dates')?.textContent).toMatch(/^Created .+ · Updated .+/);
    expect(header.querySelector('.save-status')?.textContent).toBe('Saved');
    expect(header.querySelector('#note-title')).toBeNull(); // the title is on the paper now

    // Order in the page (and so the keyboard order): slim line, toolbar, paper (title, body).
    const kids = [...pane.children].map((e) => e.className.split(' ')[0]);
    expect(kids.indexOf('editor-header')).toBeLessThan(kids.indexOf('toolbar-wrap'));
    expect(kids.indexOf('toolbar-wrap')).toBeLessThan(kids.indexOf('editor-scroll'));
    const order = focusable(pane);
    const at = (label: string) => order.indexOf(label);
    expect(at('Move to…')).toBeGreaterThanOrEqual(0);
    expect(at('Move to…')).toBeLessThan(at('Add tag'));
    expect(at('Add tag')).toBeLessThan(at('Move to Trash'));
    expect(at('Move to Trash')).toBeLessThan(at('Bold'));
    expect(at('Bold')).toBeLessThan(at('Title'));
    expect(at('Title')).toBeLessThan(at('Note body'));

    // The paper: the title first, then the body, and nothing else.
    const paper = pane.querySelector('.editor-scroll.paper')!;
    const column = paper.querySelector('.paper-column')!;
    expect([...column.children].map((e) => e.id || e.className.split(' ')[0])).toEqual(['note-title', 'editor-content']);
    expect(paper.querySelectorAll('.tag-editor, .editor-dates, .save-status, .toolbar').length).toBe(0);
  });

  it('Enter in the title moves the focus to the body', async () => {
    const v = await open();
    const titleInput = v.container.querySelector('.paper #note-title') as HTMLInputElement;
    titleInput.focus();
    await act(async () => {
      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await settle();
    expect(document.activeElement).toBe(v.container.querySelector('.ProseMirror'));
  });

  it('the Updated time follows a confirmed save', async () => {
    const v = await open();
    const updated = () => v.container.querySelector('.editor-dates time:last-of-type')?.getAttribute('datetime');
    expect(updated()).toBe('2026-01-01T00:00:00Z');
    await act(async () => {
      editorOf(v.container).commands.insertContent(' edited');
    });
    await waitFor(() => updated() === '2026-01-02T00:00:00Z', 4000, 'updated time after save');
  });

  it('a note from an agent shows its mark in the slim line, beside the tags', async () => {
    const v = await open(props(), serverNote({ origin: { type: 'agent', name: 'Claude' } }));
    expect(v.container.querySelector('.editor-header .slim-left .agent-badge')?.textContent).toBe('by Claude');
  });

  it('a trashed note keeps its banner, has no toolbar, and the paper still holds only the title and the body', async () => {
    const v = await open(props(), serverNote({ trashedAt: '2026-01-03T00:00:00Z' }));
    const pane = v.container.querySelector('.editor-pane')!;
    expect(pane.querySelector('.editor-header')?.textContent).toContain('In Trash');
    expect(pane.querySelector('.banner')?.textContent).toContain('This note is in Trash and cannot be edited.');
    expect(pane.querySelector('.toolbar')).toBeNull();
    expect((pane.querySelector('.paper #note-title') as HTMLInputElement).readOnly).toBe(true);
    const kids = [...pane.children].map((e) => e.className.split(' ')[0]);
    expect(kids.indexOf('banner')).toBeLessThan(kids.indexOf('editor-scroll')); // banners sit above the paper
    expect(pane.querySelector('.paper-column')!.children.length).toBe(2);
  });
});

describe('the slim line', () => {
  it('one row: folder, agent mark and tags on the left; dates, status and Move to Trash on the right', async () => {
    const v = await open(props(), serverNote({ tags: ['work'], origin: { type: 'agent', name: 'Claude' } }));
    const rows = [...v.container.querySelectorAll('.editor-header > .editor-row')];
    expect(rows.length).toBe(1);
    const left = rows[0].querySelector('.slim-left')!;
    const right = rows[0].querySelector('.slim-right')!;
    expect([...left.querySelectorAll('[aria-label="Move to…"], .agent-badge, .tag-editor')].map((e) => e.getAttribute('aria-label') ?? e.className.split(' ')[0])).toEqual(['Move to…', 'agent-badge', 'tag-editor']);
    expect(left.querySelector('input[aria-label="Add tag"]')).toBeTruthy();
    expect([...right.children].map((e) => e.getAttribute('aria-label') ?? e.className.split(' ')[0])).toEqual(['editor-dates', 'save-status', 'Move to Trash']);
  });

  it('a read-only note with no tags shows no tag editor', async () => {
    const v = await open(props(), serverNote({ trashedAt: '2026-01-03T00:00:00Z' }));
    expect(v.container.querySelectorAll('.editor-header > .editor-row').length).toBe(1);
    expect(v.container.querySelector('.editor-header .tag-editor')).toBeNull();
  });
});

describe('closing a note while a save is pending', () => {
  it('the save still completes and reports to the list, without touching the destroyed editor', async () => {
    const p = props();
    // A real network: the save answers after the closed editor has been destroyed.
    const slowPut = (m: string) =>
      m === 'PUT' ? new Promise((r) => setTimeout(() => r({ status: 200, json: { version: 5, updatedAt: '2026-01-02T00:00:00Z' } }), 150)) : undefined;
    const v = await open(p, serverNote(), slowPut);
    const ed = editorOf(v.container);
    await act(async () => {
      ed.commands.insertContent(' closing');
    });
    await v.unmount(); // closed before the 1 s autosave: the editor flushes on unmount
    await waitFor(() => ed.isDestroyed, 2000, 'editor destroyed');
    view = null;
    await waitFor(() => (p.onMeta as any).mock.calls.length > 0, 4000, 'onMeta after the flush');
    expect(requests.some((r) => r.method === 'PUT' && JSON.stringify(r.body).includes('closing'))).toBe(true);
    const patch = (p.onMeta as any).mock.calls[0][1];
    expect(patch.title).toBe('Server title');
    expect(patch).not.toHaveProperty('snippet');
  });
});

