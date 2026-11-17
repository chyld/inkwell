// @vitest-environment happy-dom
// Text colour and highlight in the editor: paste sanitising, the toolbar pickers (keyboard,
// selection state, outside click, Remove), and a round trip through save, reload and drafts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { noteExtensions } from '../../src/shared/schema';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { localDrafts } from '../../src/web/drafts';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';

describe('paste sanitising', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions, content: '<p></p>' });
  });
  afterEach(() => editor.destroy());

  const marksOf = (html: string) => {
    editor.commands.setContent('<p></p>');
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    const marks: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText) marks.push(...n.marks.map((m) => (m.attrs.color ? `${m.type.name}:${m.attrs.color}` : m.type.name)));
    });
    return { marks, html: editor.getHTML() };
  };

  it('keeps only our own attribute with an allowed name', () => {
    expect(marksOf('<p><span style="color:red">a</span></p>').marks).toEqual([]);
    expect(marksOf('<p><font color="red">a</font></p>').marks).toEqual([]);
    expect(marksOf('<p><span data-text-color="red">a</span></p>').marks).toEqual([]);
    expect(marksOf('<p><span data-text-color="topaz">a</span></p>').marks).toEqual([]); // a highlight name
    expect(marksOf('<p><mark>a</mark></p>').marks).toEqual([]);
    expect(marksOf('<p><mark style="background:#ff0">a</mark></p>').marks).toEqual([]);
    expect(marksOf('<p><mark data-highlight="onyx">a</mark></p>').marks).toEqual([]); // a text colour name
    expect(marksOf('<p><span style="background-color:yellow">a</span></p>').marks).toEqual([]);

    const ok = marksOf('<p><span data-text-color="ruby" style="color:#000" class="x" onclick="alert(1)">a</span></p>');
    expect(ok.marks).toEqual(['textColor:ruby']);
    expect(ok.html).toBe('<p><span data-text-color="ruby">a</span></p>'); // no style, class or handler survives
    const hl = marksOf('<p><mark data-highlight="aqua" style="background:red">b</mark></p>');
    expect(hl.marks).toEqual(['highlight:aqua']);
    expect(hl.html).toBe('<p><mark data-highlight="aqua">b</mark></p>');
  });

  it('combines with other marks, and never applies inside code', () => {
    expect(marksOf('<p><strong><em><span data-text-color="teal"><mark data-highlight="coral">x</mark></span></em></strong></p>').marks.sort()).toEqual(
      ['bold', 'highlight:coral', 'italic', 'textColor:teal'],
    );
    expect(marksOf('<p><code><span data-text-color="ruby">x</span></code></p>').marks).toEqual(['code']);
    expect(marksOf('<pre><code><span data-text-color="ruby">x</span><mark data-highlight="aqua">y</mark></code></pre>').marks).toEqual([]);
  });
});

// ---- the editor component -------------------------------------------------

const me = { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' };
const NOTE_ID = '77777777-7777-4777-8777-777777777777';
const docOf = (...content: unknown[]) => ({ type: 'doc', content });
const serverNote = (body: unknown) => ({
  id: NOTE_ID,
  title: 'Colours',
  body,
  version: 3,
  folderId: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  trashedAt: null,
  origin: { type: 'user' },
});
const props = {
  noteId: NOTE_ID,
  me,
  folders: [],
  allTags: [],
  autoFocusTitle: false,
  onMeta: vi.fn(),
  onRemoved: vi.fn(),
  onTagsChanged: vi.fn(),
  onStorageChanged: vi.fn(),
  onBack: vi.fn(),
};

let view: Awaited<ReturnType<typeof render>> | null = null;
let stored: unknown;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(body: unknown) {
  stored = body;
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: serverNote(stored) };
    if (method === 'PUT') {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    return { status: 404, json: { error: { code: 'not_found', message: 'nope' } } };
  });
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(props as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
  return view;
}
const key = async (k: string) =>
  act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
const selectWord = async (from: number, to: number) =>
  act(async () => {
    editorOf(view!.container).chain().focus().setTextSelection({ from, to }).run();
  });
const colourButton = () => [...view!.container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Text colour')) as HTMLButtonElement;
const highlightButton = () => [...view!.container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Highlight')) as HTMLButtonElement;

describe('toolbar colour pickers', () => {
  it('opens a labelled popover, moves by arrow keys, applies, shows the colour in use and Escape returns focus', async () => {
    await open(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }));
    await selectWord(1, 6); // "hello"
    const btn = colourButton();
    expect(btn.getAttribute('aria-label')).toBe('Text colour');
    expect(btn.getAttribute('title')).toBe('Text colour');
    expect(btn.getAttribute('aria-haspopup')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const pop = view!.container.querySelector('.color-popover')!;
    expect(pop.getAttribute('role')).toBe('group');
    const swatches = [...pop.querySelectorAll('button')];
    expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual(['Ruby', 'Garnet', 'Amber', 'Emerald', 'Teal', 'Sapphire', 'Amethyst', 'Onyx', 'Remove text colour']);
    expect(swatches.every((s) => s.title)).toBe(true);
    expect(document.activeElement).toBe(swatches[0]);
    await key('ArrowRight');
    expect(document.activeElement).toBe(swatches[1]);
    await key('ArrowDown');
    expect(document.activeElement).toBe(swatches[5]);
    await key('ArrowUp');
    await key('ArrowLeft');
    expect(document.activeElement).toBe(swatches[0]);
    await key('End');
    expect(document.activeElement).toBe(swatches[8]);
    await key('Home');
    await key('ArrowRight');
    await click(document.activeElement); // Enter/Space on a focused button is a click
    expect(view!.container.querySelector('.color-popover')).toBeNull();
    expect(view!.container.querySelector('.ProseMirror span[data-text-color="garnet"]')?.textContent).toBe('hello');
    expect(view!.container.querySelector('.ProseMirror [style]')).toBeNull();

    // The button shows the colour at the cursor.
    await selectWord(3, 3);
    expect(colourButton().getAttribute('aria-label')).toBe('Text colour: Garnet');
    expect(colourButton().querySelector('.color-bar[data-text-color="garnet"]')).toBeTruthy();
    await click(colourButton());
    const again = [...view!.container.querySelectorAll('.color-popover button')];
    expect(again[1].getAttribute('aria-pressed')).toBe('true');
    expect(again[0].getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(again[1]); // opens on the colour in use
    await key('Escape');
    expect(view!.container.querySelector('.color-popover')).toBeNull();
    expect(document.activeElement).toBe(colourButton());

    await selectWord(9, 9);
    expect(colourButton().getAttribute('aria-label')).toBe('Text colour');
  });

  it('closes on an outside click; Remove takes the colour away', async () => {
    await open(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'warm', marks: [{ type: 'highlight', attrs: { color: 'coral' } }] }] }));
    await selectWord(2, 2);
    expect(highlightButton().getAttribute('aria-label')).toBe('Highlight: Coral');
    await click(highlightButton());
    expect(view!.container.querySelector('.color-popover')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(view!.container.querySelector('.color-popover')).toBeNull();
    await click(highlightButton());
    await click(button(view!.container, 'Remove highlight'));
    expect(view!.container.querySelector('.ProseMirror mark')).toBeNull(); // the whole word, though nothing was selected
    await waitFor(() => requests.some((r) => r.method === 'PUT'), 4000, 'save');
    expect(JSON.stringify(stored)).not.toContain('highlight');
  });

  it('is unavailable inside code', async () => {
    await open(docOf({ type: 'codeBlock', content: [{ type: 'text', text: 'let x' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'b', marks: [{ type: 'code' }] }] }));
    await selectWord(2, 2);
    expect(colourButton().disabled).toBe(true);
    expect(highlightButton().disabled).toBe(true);
    await selectWord(10, 11); // the inline code "b"
    expect(colourButton().disabled).toBe(true);
  });

  it('round-trips through save and reload, and through a local draft', async () => {
    await open(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'save me' }] }));
    await selectWord(1, 5);
    await click(highlightButton());
    await click(button(view!.container, 'Sapphire'));
    await selectWord(6, 8);
    await click(colourButton());
    await click(button(view!.container, 'Amber'));
    await waitFor(() => JSON.stringify(stored).includes('amber'), 4000, 'save with both marks');
    expect(stored).toEqual(
      docOf({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'save', marks: [{ type: 'highlight', attrs: { color: 'sapphire' } }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'me', marks: [{ type: 'textColor', attrs: { color: 'amber' } }] },
        ],
      }),
    );
    // Reload from the server.
    await view!.unmount();
    view = null;
    await open(stored);
    expect(view!.container.querySelector('.ProseMirror mark[data-highlight="sapphire"]')?.textContent).toBe('save');
    expect(view!.container.querySelector('.ProseMirror span[data-text-color="amber"]')?.textContent).toBe('me');

    // A draft with colours is offered and restored as it was.
    await view!.unmount();
    view = null;
    const draftBody = docOf({ type: 'paragraph', content: [{ type: 'text', text: 'drafted', marks: [{ type: 'textColor', attrs: { color: 'onyx' } }] }] });
    localDrafts.set('u1', NOTE_ID, { title: 'Colours', body: draftBody, version: 3, savedAt: Date.now(), owner: 'other-tab' });
    await open(stored);
    await waitFor(() => !!button(view!.container, 'Restore'), 3000, 'draft offer');
    await click(button(view!.container, 'Restore'));
    await settle();
    expect(view!.container.querySelector('.ProseMirror span[data-text-color="onyx"]')?.textContent).toBe('drafted');
  });
});
