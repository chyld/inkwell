// @vitest-environment happy-dom
// Resizing an image in the editor (DEVIATIONS 44): handles on a selected image, one transaction per completed
// drag and none for a cancelled one, the limits, reset, the keyboard, read-only notes, and no inline style.
// happy-dom has no layout, so the image's measurements are stubbed: an 800 × 400 image in a 600 px column.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { undo, redo } from '@tiptap/pm/history';
import { validateBody } from '../../src/shared/schema';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { clearAllFonts, setFaceLoader } from '../../src/web/fonts/runtime';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { RESIZE_HELP } from '../../src/web/ImageView';
import { resetStyles } from '../../src/web/stylesStore';
import { editorOf, mockFetch, render, requests, settle, waitFor } from './harness';
import { HASH, installFontEnv } from './fonts-env';

const NOTE_ID = '77777777-7777-4777-8777-777777777777';
const SRC = '/api/images/11111111-1111-4111-8111-111111111111';
const COLUMN = 600;
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const image = (attrs: Record<string, unknown> = {}) => ({ type: 'image', attrs: { src: SRC, alt: 'A cat', ...attrs } });
const props = { noteId: NOTE_ID, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onRemoved: vi.fn(), onTagsChanged: vi.fn(), onStorageChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn(), onManageStyles: vi.fn() };

let view: Awaited<ReturnType<typeof render>> | null = null;
let stored: any;
let docChanges = 0;
const restore: (() => void)[] = [];
function stub<T extends object>(proto: T, key: string, desc: PropertyDescriptor) {
  const before = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, ...desc });
  restore.push(() => (before ? Object.defineProperty(proto, key, before) : delete (proto as any)[key]));
}

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setFaceLoader(null);
  setPreviewLoader(new PreviewLoader({ fetchPreview: async () => HASH(9), now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }));
  localStorage.clear();
  resetStyles();
  docChanges = 0;
  // An 800 × 400 image; shown at its width attribute, or its own width, never wider than the column (max-width: 100%).
  stub(HTMLImageElement.prototype, 'naturalWidth', { get: () => 800 });
  stub(HTMLImageElement.prototype, 'naturalHeight', { get: () => 400 });
  stub(HTMLImageElement.prototype, 'getBoundingClientRect', {
    value(this: HTMLImageElement) {
      const w = Math.min(Number(this.getAttribute('width')) || 800, COLUMN);
      return { x: 0, y: 0, top: 0, left: 0, width: w, height: w / 2, right: w, bottom: w / 2, toJSON() {} };
    },
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
  while (restore.length) restore.pop()!();
});

async function open(content: unknown[], trashed = false) {
  stored = { type: 'doc', content };
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: { id: NOTE_ID, title: 'Pictures', body: stored, version: 3, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: trashed ? '2026-01-02T00:00:00Z' : null, origin: { type: 'user' } } };
    if (method === 'PUT' && path === `/api/notes/${NOTE_ID}`) {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/styles') return { status: 200, json: [] };
    if (path === '/api/fonts/collection') return { status: 200, json: [] };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(props as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
  Object.defineProperty(pm(), 'clientWidth', { configurable: true, get: () => COLUMN });
  ed().on('transaction', ({ transaction }: any) => transaction.docChanged && docChanges++);
}
const ed = () => editorOf(view!.container);
const pm = () => view!.container.querySelector('.ProseMirror') as HTMLElement;
const imagePos = () => {
  let at = -1;
  ed().state.doc.descendants((n: any, pos: number) => {
    if (n.type.name === 'image' && at < 0) at = pos;
  });
  return at;
};
const attrs = () => ed().state.doc.nodeAt(imagePos()).attrs;
const img = () => view!.container.querySelector('.image-view img') as HTMLImageElement;
const handles = () => [...view!.container.querySelectorAll('.image-handle')] as HTMLElement[];
const handle = (corner = 'bottom-right') => view!.container.querySelector(`.image-handle[data-corner="${corner}"]`) as HTMLElement;
const slider = () => view!.container.querySelector('.image-handle[role="slider"]') as HTMLElement;
const selectImage = () => act(async () => void ed().view.dispatch(ed().state.tr.setSelection(NodeSelection.create(ed().state.doc, imagePos()))));
const pointer = (el: Element, type: string, x: number, y: number, id = 1) =>
  act(async () => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'mouse' })));
const key = (el: Element, k: string, shift = false) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })));
async function drag(corner: string, moves: [number, number][], end: 'pointerup' | 'pointercancel' | 'escape' = 'pointerup') {
  const h = handle(corner);
  await pointer(h, 'pointerdown', 0, 0);
  for (const [x, y] of moves) await pointer(h, 'pointermove', x, y);
  if (end === 'escape') await key(document.body, 'Escape');
  else await pointer(h, end, ...moves.at(-1)!);
}
const noInlineStyle = () => {
  expect(pm().innerHTML).not.toMatch(/\sstyle=/);
  expect(ed().getHTML()).not.toMatch(/\sstyle=/);
};

describe('handles', () => {
  it('a selected image has an outline and four corner handles, one of them a named slider; none once deselected', async () => {
    await open([p('before'), image(), p('after')]);
    expect(handles()).toHaveLength(0);
    expect(img().hasAttribute('width')).toBe(false); // no stored size: rendered as before
    expect(img().getAttribute('alt')).toBe('A cat');
    await selectImage();
    expect(view!.container.querySelector('.image-view')!.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(handles().map((h) => h.dataset.corner)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    expect(slider()).toBe(handle('bottom-right'));
    expect(slider().getAttribute('aria-label')).toBe('Image size');
    expect(slider().getAttribute('aria-valuetext')).toBe('600 × 300 pixels'); // 800 wide, shown at the column's 600
    expect(slider().getAttribute('aria-valuemin')).toBe('40');
    expect(slider().getAttribute('aria-valuemax')).toBe('600');
    expect(slider().tabIndex).toBe(0);
    expect(slider().title).toBe(RESIZE_HELP);
    expect(handles().filter((h) => h !== slider()).every((h) => h.getAttribute('aria-hidden') === 'true')).toBe(true);
    await act(async () => void ed().view.dispatch(ed().state.tr.setSelection(TextSelection.create(ed().state.doc, 2))));
    expect(handles()).toHaveLength(0);
    expect(docChanges).toBe(0);
  });

  it('a read-only note (the Trash) shows no handles, even with the image selected', async () => {
    await open([p('before'), image(), p('after')], true);
    expect(pm().getAttribute('contenteditable')).toBe('false');
    await selectImage();
    expect(handles()).toHaveLength(0);
    expect(img().getAttribute('src')).toBe(SRC);
  });
});

describe('dragging', () => {
  it('resizes live without a transaction; releasing commits one, keeping the ratio and the selection; undo and redo', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    const h = handle();
    await pointer(h, 'pointerdown', 0, 0);
    await pointer(h, 'pointermove', -100, 0);
    await pointer(h, 'pointermove', -200, 0);
    expect(img().getAttribute('width')).toBe('400'); // live, as an attribute
    expect(img().getAttribute('height')).toBe('200');
    expect(view!.container.querySelector('.image-size')!.textContent).toBe('400 × 200');
    expect(view!.container.querySelector('.image-view')!.classList.contains('show-size')).toBe(true);
    expect(docChanges).toBe(0);
    expect(attrs().width).toBeNull();
    await pointer(h, 'pointerup', -200, 0);
    expect(docChanges).toBe(1);
    expect(attrs()).toMatchObject({ width: 400, height: 200, alt: 'A cat', src: SRC });
    expect(ed().state.selection instanceof NodeSelection).toBe(true);
    noInlineStyle();
    await act(async () => void undo(ed().state, ed().view.dispatch));
    expect(attrs().width).toBeNull();
    expect(img().hasAttribute('width')).toBe(false);
    await act(async () => void redo(ed().state, ed().view.dispatch));
    expect(attrs()).toMatchObject({ width: 400, height: 200 });
    expect(img().getAttribute('width')).toBe('400');
  });

  it('a drag reads the layout once, at its start, not after each move (CLEANUP-PLAN pass 1 item 5)', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    const h = handle();
    const reads = vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect');
    await pointer(h, 'pointerdown', 0, 0);
    const atStart = reads.mock.calls.length;
    for (let i = 1; i <= 5; i++) await pointer(h, 'pointermove', -20 * i, 0);
    expect(reads.mock.calls.length - atStart).toBe(0); // before: one per move
    expect(img().getAttribute('width')).toBe('500'); // the moves still resize, live
    expect(slider().getAttribute('aria-valuetext')).toBe('500 × 250 pixels');
    await pointer(h, 'pointerup', -100, 0);
    expect(attrs()).toMatchObject({ width: 500, height: 250 });
  });

  it('every corner, by either axis; a click without moving stores nothing', async () => {
    await open([p('before'), image({ width: 400, height: 200 }), p('after')]);
    await selectImage();
    await drag('top-left', [[-50, 0]]);
    expect(attrs()).toMatchObject({ width: 450, height: 225 });
    await drag('bottom-left', [[0, -25]]);
    expect(attrs()).toMatchObject({ width: 400, height: 200 });
    await drag('top-right', [[0, -50]]);
    expect(attrs()).toMatchObject({ width: 500, height: 250 });
    expect(docChanges).toBe(3);
    await drag('bottom-right', [[0, 0]]);
    expect(docChanges).toBe(3);
  });

  it('never wider than the column nor narrower than 40 px', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    await drag('bottom-right', [[5000, 0]]);
    expect(attrs()).toMatchObject({ width: COLUMN, height: 300 });
    await drag('bottom-right', [[-5000, 0]]);
    expect(attrs()).toMatchObject({ width: 40, height: 20 });
    await drag('top-left', [[5000, 5000]]);
    expect(attrs()).toMatchObject({ width: 40, height: 20 });
  });

  it('Escape during a drag cancels it, as does pointercancel: no transaction, the stored size shown again', async () => {
    await open([p('before'), image({ width: 300, height: 150 }), p('after')]);
    await selectImage();
    await drag('bottom-right', [[100, 0]], 'escape');
    expect(docChanges).toBe(0);
    expect(img().getAttribute('width')).toBe('300');
    expect(attrs().width).toBe(300);
    await drag('bottom-right', [[100, 0]], 'pointercancel');
    expect(docChanges).toBe(0);
    expect(img().getAttribute('width')).toBe('300');
    // A move from another pointer is ignored.
    const h = handle();
    await pointer(h, 'pointerdown', 0, 0, 1);
    await pointer(h, 'pointermove', 200, 0, 2);
    await pointer(h, 'pointerup', 200, 0, 2);
    expect(img().getAttribute('width')).toBe('300');
    await pointer(h, 'pointerup', 0, 0, 1);
    expect(docChanges).toBe(0);
  });

  it('a double-click on a handle returns to the image’s own size in one transaction', async () => {
    await open([p('before'), image({ width: 300, height: 150 }), p('after')]);
    await selectImage();
    await act(async () => void handle('top-right').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    expect(docChanges).toBe(1);
    expect(attrs()).toMatchObject({ width: null, height: null, alt: 'A cat' });
    expect(img().hasAttribute('width')).toBe(false);
    await act(async () => void handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    expect(docChanges).toBe(1); // already its own size
    await act(async () => void undo(ed().state, ed().view.dispatch));
    expect(attrs()).toMatchObject({ width: 300, height: 150 });
  });
});

describe('the keyboard', () => {
  it('Tab from the selected image reaches the handle; arrows, Shift, Page keys, Home, End and R; Escape goes back', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    await act(async () => void ed().view.focus());
    await key(pm(), 'Tab');
    expect(document.activeElement).toBe(slider());
    expect(view!.container.querySelector('.image-view')!.classList.contains('show-size')).toBe(true);
    const steps: [string, boolean, number][] = [
      ['ArrowLeft', false, 590],
      ['ArrowDown', true, 589],
      ['PageDown', false, 539],
      ['ArrowRight', true, 540],
      ['PageUp', false, 590],
      ['Home', false, 40],
      ['End', false, 600],
      ['ArrowRight', false, 600],
    ];
    for (const [k, shift, w] of steps) {
      await key(slider(), k, shift);
      expect(attrs().width, k).toBe(w);
      expect(attrs().height).toBe(Math.round(w / 2));
      expect(slider().getAttribute('aria-valuetext')).toBe(`${w} × ${Math.round(w / 2)} pixels`);
      expect(slider().getAttribute('aria-valuenow')).toBe(String(w));
    }
    expect(document.activeElement).toBe(slider()); // focus stays on the handle
    await key(slider(), 'r');
    expect(attrs()).toMatchObject({ width: null, height: null });
    await key(slider(), 'Escape');
    expect(document.activeElement).toBe(pm());
    expect(ed().state.selection instanceof NodeSelection).toBe(true);
    noInlineStyle();
  });

  it('each press is one undo step; other keys are left alone', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    await act(async () => void slider().focus());
    await key(slider(), 'ArrowLeft');
    await key(slider(), 'ArrowLeft');
    await key(slider(), 'ArrowLeft');
    expect(attrs().width).toBe(570);
    expect(docChanges).toBe(3);
    await act(async () => void undo(ed().state, ed().view.dispatch));
    expect(attrs().width).toBe(580);
    await act(async () => void undo(ed().state, ed().view.dispatch));
    await act(async () => void undo(ed().state, ed().view.dispatch));
    expect(attrs().width).toBeNull();
    const before = docChanges;
    await key(slider(), 'a');
    await key(slider(), 'Enter');
    expect(docChanges).toBe(before);
  });

  it('Tab elsewhere is not taken', async () => {
    await open([p('before'), image(), p('after')]);
    await act(async () => void ed().chain().focus().setTextSelection(3).run());
    await key(pm(), 'Tab');
    expect(document.activeElement).not.toBe(slider());
    expect(handles()).toHaveLength(0);
  });
});

describe('storage and HTML', () => {
  it('the size is saved as whole numbers the server accepts, rendered as width/height attributes with no inline style, and parsed back', async () => {
    await open([p('before'), image(), p('after')]);
    await selectImage();
    await drag('bottom-right', [[-333.3, 0]]);
    expect(attrs()).toMatchObject({ width: 267, height: 134 });
    await waitFor(() => requests.some((r) => r.method === 'PUT' && JSON.stringify(r.body?.body).includes('"width":267')), 4000, 'saved');
    const body = requests.filter((r) => r.method === 'PUT').at(-1)!.body.body;
    const v = validateBody(body);
    expect(v.imageIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(JSON.stringify(body)).not.toMatch(/style/);
    const html = ed().getHTML();
    expect(html).toContain(`<img src="${SRC}" alt="A cat" width="267" height="134">`);
    noInlineStyle();
    // Copy and paste use the same HTML: the size comes back as numbers.
    await act(async () => void ed().commands.setContent(html + html));
    const sizes: unknown[] = [];
    ed().state.doc.descendants((n: any) => {
      if (n.type.name === 'image') sizes.push([n.attrs.width, n.attrs.height, n.attrs.alt]);
    });
    expect(sizes).toEqual([
      [267, 134, 'A cat'],
      [267, 134, 'A cat'],
    ]);
    await settle();
  });
});

describe('a press on the paper around the text (CLEANUP-PLAN pass 2 item 5b)', () => {
  // The paper is 640 px wide at x 0; the text column (the editable element) runs from x 20 to 620.
  async function paperSetup() {
    await open([p('Short line'), image({ width: 300, height: 150 }), p('After')]);
    const paper = view!.container.querySelector('.paper') as HTMLElement;
    stub(paper, 'clientWidth', { get: () => 640 });
    stub(paper, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 800, width: 640, height: 800, toJSON() {} }) });
    stub(ed().view.dom, 'getBoundingClientRect', { value: () => ({ x: 20, y: 10, left: 20, top: 10, right: 620, bottom: 400, width: 600, height: 390, toJSON() {} }) });
    const at = vi.spyOn(ed().view, 'posAtCoords').mockReturnValue({ pos: 11, inside: -1 }); // the end of "Short line"
    const press = (target: Element, init: MouseEventInit) => {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
      target.dispatchEvent(e);
      return e;
    };
    return { paper, at, press };
  }

  it('deselects a selected image and puts the cursor at the nearest point of the text; the focus stays in the editor', async () => {
    const { paper, at, press } = await paperSetup();
    await selectImage();
    expect(handles()).toHaveLength(4);
    let e!: MouseEvent;
    await act(async () => void (e = press(paper, { clientX: 630, clientY: 30 }))); // in the right padding
    expect(at).toHaveBeenCalledWith({ left: 619, top: 30 }); // clamped into the text column
    expect(ed().state.selection).toBeInstanceOf(TextSelection);
    expect(ed().state.selection.from).toBe(11);
    expect(handles()).toHaveLength(0);
    expect(e.defaultPrevented).toBe(true); // the focus does not go to the page
    await act(async () => void press(paper, { clientX: 300, clientY: 700 })); // below the last line
    expect(at).toHaveBeenLastCalledWith({ left: 300, top: 399 });
  });

  it('leaves alone a press inside the text, another button, the scrollbar and a read-only note', async () => {
    const { paper, at, press } = await paperSetup();
    await selectImage();
    await act(async () => void press(paper, { clientX: 630, clientY: 30, button: 2 }));
    await act(async () => void press(paper, { clientX: 645, clientY: 30 })); // beyond clientWidth: the scrollbar
    expect(at).not.toHaveBeenCalled();
    expect(ed().state.selection).toBeInstanceOf(NodeSelection);
    // A press on the text is the editor's own (ProseMirror looks up the raw point; the paper would clamp it to 619).
    await act(async () => void press(ed().view.dom.querySelector('p')!, { clientX: 630, clientY: 30 }));
    expect(at).not.toHaveBeenCalledWith({ left: 619, top: 30 });
    await view!.unmount();
    view = null;
    const ro = await (async () => {
      await open([p('Short line'), image()], true);
      const paperRo = view!.container.querySelector('.paper') as HTMLElement;
      stub(paperRo, 'clientWidth', { get: () => 640 });
      return vi.spyOn(ed().view, 'posAtCoords');
    })();
    await act(async () => void view!.container.querySelector('.paper')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 630, clientY: 30 })));
    expect(ro).not.toHaveBeenCalled();
  });
});
