// @vitest-environment happy-dom
// Fonts in notes (FONTS-SPEC 8): paste (criterion 8), applying and Default font (5), a font not in
// the collection (6), registering on open, draft restore, conflict, paste and undo, and failures (16),
// "Mixed" and no selection (23), the menu's previews (22), the 51st font (8). Stand-ins for FontFace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { noteExtensions } from '../../src/shared/schema';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { limitPastedFonts } from '../../src/web/paste';
import { localDrafts } from '../../src/web/drafts';
import { clearAllFonts, fontRulesText, FontSession } from '../../src/web/fonts/runtime';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';
import { FakeFontFace, HASH, installFontEnv, registeredFamilies } from './fonts-env';

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setPreviewLoader(new PreviewLoader());
  localStorage.clear();
});

// ---- paste (criterion 8) ------------------------------------------------------------

describe('paste', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions, content: '<p></p>' });
  });
  afterEach(() => editor.destroy());
  const marksOf = (html: string) => {
    editor.commands.setContent('<p></p>');
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    const out: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText) out.push(...n.marks.map((m) => (m.attrs.font ? `font:${m.attrs.font}` : m.attrs.color ? `${m.type.name}:${m.attrs.color}` : m.type.name)));
    });
    return { marks: out.sort(), html: editor.getHTML() };
  };

  it('font-family styles, <font face> and a data-font that is not a snapshot id give no mark', () => {
    for (const html of [
      '<p><span style="font-family: Titan One">a</span></p>',
      '<p><span style="font-family: \'Lora\', serif">a</span></p>',
      '<p><font face="Lora">a</font></p>',
      '<p><span data-font="Titan One">a</span></p>',
      '<p><span data-font="no-such-font">a</span></p>',
      '<p><span data-font="../x">a</span></p>',
      '<p><span data-font="">a</span></p>',
    ]) expect(marksOf(html).marks, html).toEqual([]);
  });

  it('a valid one is kept (retired included), with no style; on an element that also carries a colour both marks are kept', () => {
    const ok = marksOf('<p><span data-font="titan-one" style="font-family: Comic Sans">a</span></p>');
    expect(ok.marks).toEqual(['font:titan-one']);
    expect(ok.html).toBe('<p><span data-font="titan-one">a</span></p>');
    const f = FONT_CATALOGUE.find((x) => x.id === 'lora')! as { retired: boolean };
    f.retired = true;
    try {
      expect(marksOf('<p><span data-font="lora">a</span></p>').marks).toEqual(['font:lora']);
    } finally {
      f.retired = false;
    }
    expect(marksOf('<p><span data-font="titan-one" data-text-color="ruby">a</span></p>').marks).toEqual(['font:titan-one', 'textColor:ruby']);
    expect(marksOf('<p><mark data-highlight="topaz" data-font="lora">a</mark></p>').marks).toEqual(['font:lora', 'highlight:topaz']); // several of our attributes on one element: all kept
    expect(marksOf('<p><code><span data-font="titan-one">a</span></code></p>').marks).toEqual(['code']);
    expect(marksOf('<pre><code><span data-font="titan-one">a</span></code></pre>').marks).toEqual([]);
  });

  it('a paste that would bring the note past 50 fonts keeps the fonts already used and drops the extra marks', () => {
    const ids = FONT_CATALOGUE.slice(0, 53).map((f) => f.id);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: ids.slice(0, 49).map((id, i) => ({ type: 'text', text: `w${i} `, marks: [{ type: 'fontFamily', attrs: { font: id } }] })) }] });
    editor.setOptions({ editorProps: { transformPasted: (slice) => limitPastedFonts(slice, editor as never) } });
    editor.commands.focus('end');
    // Already used (ids[0]) is kept; of the new ones only the first (ids[49]) fits; ids[50..52] lose their mark.
    editor.view.pasteHTML(`<p>${[ids[0], ids[49], ids[50], ids[51], ids[52]].map((id) => `<span data-font="${id}">p-${id} </span>`).join('')}</p>`);
    const used = new Set<string>();
    editor.state.doc.descendants((n) => n.marks.forEach((m) => m.type.name === 'fontFamily' && used.add(m.attrs.font)));
    expect(used.size).toBe(50);
    expect(used.has(ids[49])).toBe(true);
    expect([ids[50], ids[51], ids[52]].some((id) => used.has(id))).toBe(false);
    expect(editor.getText()).toContain(`p-${ids[52]}`); // the text stays, only the mark goes
  });
});

// ---- the editor component ------------------------------------------------------------

const me = { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' };
const NOTE_ID = '88888888-8888-4888-8888-888888888888';
const text = (s: string, marks: unknown[] = []) => ({ type: 'text', text: s, ...(marks.length ? { marks } : {}) });
const fontMark = (id: string) => ({ type: 'fontFamily', attrs: { font: id } });
const docOf = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const serverNote = (body: unknown, version = 3) => ({ id: NOTE_ID, title: 'Fonts', body, version, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } });
const facesFor = (id: string) => ({
  faces: [
    { weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(id.length) },
    { weight: '700', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(id.length + 100) },
  ],
});

let view: Awaited<ReturnType<typeof render>> | null = null;
let stored: any;
let collection: string[];
let failFaces: Set<string>;
let serverBody: () => unknown;
const props = { noteId: NOTE_ID, me, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onRemoved: vi.fn(), onTagsChanged: vi.fn(), onStorageChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn() };

afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(body: unknown, opts: { version?: number } = {}) {
  stored = body;
  serverBody = () => stored;
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: serverNote(serverBody(), opts.version ?? 3) };
    if (method === 'PUT') {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/fonts/collection') return failCollection ? { status: 500, json: { error: { code: 'internal', message: 'Something went wrong on the server.' } } } : { status: 200, json: collection };
    const faces = /^\/api\/fonts\/faces\/([a-z0-9-]+)$/.exec(path);
    if (faces) return failFaces.has(faces[1]) ? { status: 502, json: { error: { code: 'font_unavailable', message: 'x' } } } : { status: 200, json: facesFor(faces[1]) };
    const preview = /^\/api\/fonts\/preview\/([a-z0-9-]+)$/.exec(path);
    if (preview) return { status: 200, json: { file: HASH(preview[1].length + 500) } };
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
const facesRequests = (id?: string) => requests.filter((r) => r.path.startsWith('/api/fonts/faces/') && (!id || r.path.endsWith(`/${id}`))).length;
const fontButton = () => view!.container.querySelector('.toolbar .font-button') as HTMLButtonElement;
const select = async (from: number, to: number) =>
  act(async () => {
    editorOf(view!.container).chain().focus().setTextSelection({ from, to }).run();
  });
const menuItems = () => [...view!.container.querySelectorAll('.font-popover button')] as HTMLButtonElement[];

let failCollection = false;
beforeEach(() => {
  collection = ['titan-one', 'lora'];
  failFaces = new Set();
  failCollection = false;
});

describe('a collection that cannot be loaded (BUGFIX-LIST item 15)', () => {
  it('the menu keeps the list it had and says so; it never claims "No fonts yet"', async () => {
    await open(docOf(text('hello')));
    await click(fontButton());
    await waitFor(() => menuItems().some((b) => b.textContent === 'Titan One'), 3000, 'the collection');
    await click(fontButton()); // close
    failCollection = true;
    await click(fontButton());
    await settle();
    expect(menuItems().map((b) => b.textContent)).toContain('Titan One'); // before: emptied
    expect(view!.container.querySelector('.font-empty')).toBeNull(); // before: "No fonts yet"
    expect(document.body.textContent).toContain('Your fonts could not be loaded');
  });

  it('a first opening that fails does not say "No fonts yet"', async () => {
    failCollection = true;
    await open(docOf(text('hello')));
    await click(fontButton());
    await settle();
    expect(view!.container.querySelector('.font-empty')).toBeNull(); // before: "No fonts yet" for a user who has fonts
    expect(menuItems().some((b) => /Browse fonts/.test(b.textContent ?? ''))).toBe(true);
    expect(document.body.textContent).toContain('Your fonts could not be loaded');
  });
});

describe('applying a font (criteria 5 and 3)', () => {
  it('to selected text: saved as data-font, survives a reload, the face is registered with the stated arguments and the rule written', async () => {
    await open(docOf(text('hello world')));
    await select(1, 6);
    expect(fontButton().textContent).toBe('Inter'); // the default font, by name
    expect(fontButton().getAttribute('aria-label')).toBe('Font: Inter');
    await click(fontButton());
    await waitFor(() => menuItems().length === 4, 2000, 'menu with the collection');
    expect(menuItems().map((b) => b.textContent)).toEqual(['Inter', 'Titan One', 'Lora', 'Browse fonts…']);
    expect(menuItems()[0].getAttribute('aria-label')).toBe('Inter (default)');
    expect(menuItems()[0].getAttribute('aria-pressed')).toBe('true');
    expect(menuItems()[0].querySelector('.font-default-name')?.textContent).toBe('Inter'); // drawn in the default font
    await click(button(view!.container, 'Titan One'));
    expect(view!.container.querySelector('.ProseMirror span[data-font="titan-one"]')?.textContent).toBe('hello');
    expect(view!.container.querySelector('.ProseMirror span[data-font]')?.getAttribute('style')).toBeNull();
    await waitFor(() => JSON.stringify(stored).includes('fontFamily'), 4000, 'saved');
    expect(stored.content[0].content[0].marks).toEqual([fontMark('titan-one')]);
    // The face: registered under nf-<id>, with the stated arguments, added without load().
    await waitFor(() => registeredFamilies().includes('nf-titan-one'), 2000, 'face registered');
    const faces = FakeFontFace.made.filter((f) => f.family === 'nf-titan-one');
    expect(faces.map((f) => [f.source, f.descriptors])).toEqual(
      facesFor('titan-one').faces.map((x) => [`url(/api/fonts/file/${x.file})`, { weight: x.weight, style: x.style, unicodeRange: x.unicodeRange, display: 'swap' }]),
    );
    expect(faces.every((f) => f.loadCalls === 0)).toBe(true);
    expect(fontRulesText()).toContain('[data-font="titan-one"] { font-family: "nf-titan-one", "Inter", sans-serif; }'); // display: Inter, then sans-serif
    // Reload.
    await view!.unmount();
    view = null;
    await open(stored);
    expect(view!.container.querySelector('.ProseMirror span[data-font="titan-one"]')?.textContent).toBe('hello');
  });

  it('the default entry ("Inter") removes only the font, keeping bold, colour and highlight, and is offered with an empty collection', async () => {
    collection = [];
    await open(docOf(text('rich', [{ type: 'bold' }, { type: 'textColor', attrs: { color: 'ruby' } }, { type: 'highlight', attrs: { color: 'topaz' } }, fontMark('lora')]), text(' tail')));
    await select(1, 5);
    expect(fontButton().textContent).toBe('Lora'); // named, though not in the collection
    await click(fontButton());
    await waitFor(() => !!view!.container.querySelector('.font-empty'), 2000, 'empty collection');
    expect(view!.container.querySelector('.font-empty')?.textContent).toBe('No fonts yet');
    expect(menuItems().map((b) => b.textContent)).toEqual(['Inter', 'Browse fonts…']);
    expect(view!.container.querySelector('.font-popover .menu-scroll')!.firstElementChild!.textContent).toBe('Inter'); // first, above "No fonts yet"
    await click(button(view!.container, 'Inter (default)'));
    const marks = editorOf(view!.container).getJSON().content[0].content[0].marks.map((m: { type: string }) => m.type);
    expect(marks.sort()).toEqual(['bold', 'highlight', 'textColor']);
  });

  it('"Browse fonts…" asks to go to /fonts', async () => {
    await open(docOf(text('x')));
    await click(fontButton());
    await waitFor(() => menuItems().length > 0, 2000, 'menu');
    await click(button(view!.container, 'Browse fonts…'));
    expect(props.onBrowseFonts).toHaveBeenCalled();
  });

  it('the menu draws each name through the preview loader (preview-<id>), and keyboard works like the colour menus', async () => {
    await open(docOf(text('hello')));
    await click(fontButton());
    await waitFor(() => registeredFamilies().includes('preview-lora') && registeredFamilies().includes('preview-titan-one'), 2000, 'previews');
    expect(requests.filter((r) => r.path.startsWith('/api/fonts/preview/')).map((r) => r.path).sort()).toEqual(['/api/fonts/preview/lora', '/api/fonts/preview/titan-one']);
    expect(FakeFontFace.made.filter((f) => f.family.startsWith('preview-')).every((f) => f.loadCalls === 1)).toBe(true);
    expect(registeredFamilies().some((f) => f === 'Titan One' || f === 'Lora')).toBe(false); // never the real family name
    await waitFor(() => menuItems()[1].querySelector('span')?.getAttribute('style')?.includes('preview-titan-one') === true, 2000, 'name drawn in its preview');
    // Keyboard: focus starts on "Inter" (no font at the cursor), arrows move, Escape returns to the button.
    expect(document.activeElement?.textContent).toBe('Inter');
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Titan One');
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Lora');
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(view!.container.querySelector('.font-popover')).toBeNull();
    expect(document.activeElement).toBe(fontButton());
    expect(fontButton().getAttribute('aria-haspopup')).toBe('true');
  });

  it('is disabled inside code', async () => {
    await open({ type: 'doc', content: [{ type: 'codeBlock', content: [text('let x')] }, { type: 'paragraph', content: [text('a '), text('b', [{ type: 'code' }])] }] });
    await select(2, 2);
    expect(fontButton().disabled).toBe(true);
    await select(10, 11);
    expect(fontButton().disabled).toBe(true);
  });
});

describe('the 51st font from the menu is refused (criterion 8)', () => {
  it('with the stated notice, and nothing changes', async () => {
    const ids = FONT_CATALOGUE.slice(0, 50).map((f) => f.id);
    collection = ['caveat'];
    await open(docOf(...ids.map((id, i) => text(`w${i} `, [fontMark(id)])), text('plain')));
    const end = editorOf(view!.container).state.doc.content.size - 1;
    await select(end - 5, end);
    await click(fontButton());
    await waitFor(() => !!button(view!.container, 'Caveat'), 2000, 'menu');
    await click(button(view!.container, 'Caveat'));
    await waitFor(() => document.body.textContent!.includes('A note can use at most 50 fonts.'), 2000, 'notice');
    expect(JSON.stringify(editorOf(view!.container).getJSON())).not.toContain('caveat');
  });
});

describe('a note whose font is not in the collection (criterion 6)', () => {
  it('opens, registers the font and saves', async () => {
    collection = [];
    await open(docOf(text('old font', [fontMark('almendra')])));
    await waitFor(() => registeredFamilies().includes('nf-almendra'), 2000, 'registered');
    await act(async () => {
      editorOf(view!.container).commands.insertContent(' more');
    });
    await waitFor(() => JSON.stringify(stored).includes('more'), 4000, 'saved');
    expect(JSON.stringify(stored)).toContain('"font":"almendra"');
  });
});

describe('registering the fonts a document brings (criterion 16)', () => {
  it('on opening, draft restore, a conflict choice, paste and undo', async () => {
    // Opening.
    localDrafts.set('u1', NOTE_ID, { title: 'Fonts', body: docOf(text('draft', [fontMark('caveat')])), version: 3, savedAt: Date.now(), owner: 'other-tab' });
    await open(docOf(text('open', [fontMark('lora')])));
    await waitFor(() => facesRequests('lora') === 1, 2000, 'faces on open');
    // Draft restore.
    await waitFor(() => !!button(view!.container, 'Restore'), 2000, 'draft offer');
    await click(button(view!.container, 'Restore'));
    await waitFor(() => facesRequests('caveat') === 1 && registeredFamilies().includes('nf-caveat'), 2000, 'faces on draft restore');
    // Paste.
    await act(async () => {
      editorOf(view!.container).commands.focus('end');
      editorOf(view!.container).view.pasteHTML('<p><span data-font="buda">pasted</span></p>');
    });
    await waitFor(() => facesRequests('buda') === 1, 2000, 'faces on paste');
    // Undo and redo recompute the set (the session is told after every change that alters the document, within
    // FONT_SCAN_MS: the scan is debounced rather than run per keystroke, CLEANUP-PLAN pass 1 item 3).
    const spy = vi.spyOn(FontSession.prototype, 'want');
    await act(async () => {
      editorOf(view!.container).commands.undo();
    });
    await waitFor(() => spy.mock.calls.some((c) => !new Set(c[0] as Iterable<string>).has('buda')), 2000, 'told after undo');
    await act(async () => {
      editorOf(view!.container).commands.redo();
    });
    await waitFor(() => spy.mock.calls.some((c) => new Set(c[0] as Iterable<string>).has('buda')), 2000, 'told after redo');
    spy.mockRestore();
    expect(facesRequests('buda')).toBe(1); // not asked again
  });

  it('after "Load theirs" in a conflict, the fonts of the server version', async () => {
    await open(docOf(text('mine')));
    // Another device saved a version with a font; our next save conflicts.
    mockFetch((method, path, b) => {
      if (method === 'PUT') return { status: 409, json: { error: { code: 'version_conflict', message: 'changed', version: 9 } } };
      if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: serverNote(docOf(text('theirs', [fontMark('sunflower')])), 9) };
      const faces = /^\/api\/fonts\/faces\/([a-z0-9-]+)$/.exec(path);
      if (faces) return { status: 200, json: facesFor(faces[1]) };
      return { status: 404, json: { error: { code: 'x', message: 'x' } } };
    });
    await act(async () => {
      editorOf(view!.container).commands.insertContent(' edit');
    });
    await waitFor(() => !!button(view!.container, 'Load theirs'), 4000, 'conflict');
    await click(button(view!.container, 'Load theirs'));
    await waitFor(() => facesRequests('sunflower') === 1, 3000, 'faces of their version');
    expect(fontRulesText()).toContain('[data-font="sunflower"]');
  });

  it('a font that failed (from /faces, or its file later) is not asked for again while the note stays open, and is asked for again when it is reopened', async () => {
    failFaces = new Set(['lora']);
    await open(docOf(text('a', [fontMark('lora')]), text(' b', [fontMark('almendra')])));
    await waitFor(() => facesRequests('lora') === 1 && registeredFamilies().includes('nf-almendra'), 2000, 'first attempts');
    expect(registeredFamilies()).not.toContain('nf-lora'); // fallback, no message
    expect(document.body.textContent).not.toMatch(/could not|failed/i);
    // Almendra's file fails to download: its faces are removed.
    await act(async () => {
      FakeFontFace.made.find((f) => f.family === 'nf-almendra')!.fail();
    });
    await settle();
    expect(registeredFamilies()).not.toContain('nf-almendra');
    // Edits, paste of the same fonts, undo: no new requests while open.
    await act(async () => {
      const ed = editorOf(view!.container);
      ed.commands.insertContent(' c');
      ed.view.pasteHTML('<p><span data-font="lora">l</span><span data-font="almendra">m</span></p>');
      ed.commands.undo();
    });
    await settle();
    expect(facesRequests('lora')).toBe(1);
    expect(facesRequests('almendra')).toBe(1);
    // Reopened: asked again, both.
    failFaces = new Set();
    await view!.unmount();
    view = null;
    await open(stored);
    await waitFor(() => facesRequests('lora') === 1 && facesRequests('almendra') === 1, 2000, 'asked again after reopening');
    await waitFor(() => registeredFamilies().includes('nf-lora') && registeredFamilies().includes('nf-almendra'), 2000, 'registered now');
  });

  it('a constructor that throws or a hash that is not 64 lower-case hex is a failure', async () => {
    FakeFontFace.throwFor.add('nf-lora');
    await open(docOf(text('a', [fontMark('lora')])));
    await waitFor(() => facesRequests('lora') === 1, 2000, 'asked');
    await settle();
    expect(registeredFamilies()).toEqual([]);
  });

  it('at most 6 /faces requests at a time', async () => {
    const ids = FONT_CATALOGUE.slice(0, 12).map((f) => f.id);
    let active = 0;
    let max = 0;
    const releases: (() => void)[] = [];
    await open(docOf(text('x')));
    mockFetch(async (_m, path) => {
      if (!path.startsWith('/api/fonts/faces/')) return { status: 404, json: {} };
      active++;
      max = Math.max(max, active);
      await new Promise<void>((r) => releases.push(r));
      active--;
      return { status: 200, json: facesFor(path.split('/').pop()!) };
    });
    await act(async () => {
      editorOf(view!.container).commands.insertContent({ type: 'paragraph', content: ids.map((id) => text(`${id} `, [fontMark(id)])) });
    });
    await waitFor(() => active === 6, 2000, 'six in flight once the debounced font scan has run');
    expect(active).toBe(6);
    while (releases.length) {
      await act(async () => releases.shift()!());
      await settle();
    }
    expect(max).toBe(6);
    expect(facesRequests()).toBe(12);
  });
});

describe('"Mixed" and no selection (criterion 23)', () => {
  it('a selection with more than one font, or text with and without one, reads "Mixed" and nothing is current', async () => {
    await open(docOf(text('aaa', [fontMark('titan-one')]), text('bbb', [fontMark('lora')]), text('ccc')));
    await select(2, 3);
    expect(fontButton().textContent).toBe('Titan One');
    await select(2, 6);
    expect(fontButton().textContent).toBe('Mixed');
    expect(fontButton().getAttribute('aria-label')).toBe('Font: Mixed');
    await click(fontButton());
    await waitFor(() => menuItems().length === 4, 2000, 'menu');
    expect(menuItems().filter((b) => b.getAttribute('aria-pressed') === 'true')).toEqual([]);
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await select(5, 9); // lora + plain
    expect(fontButton().textContent).toBe('Mixed');
    await select(8, 9);
    expect(fontButton().textContent).toBe('Inter');
  });

  it('with no selection, choosing a font and "Default font" behave as the text colour menu does', async () => {
    await open(docOf(text('word', [fontMark('lora')]), text(' plain')));
    // A font with no selection: the next typing uses it (as text colour sets the colour for what is typed).
    await select(8, 8);
    await click(fontButton());
    await waitFor(() => !!button(view!.container, 'Titan One'), 2000, 'menu');
    await click(button(view!.container, 'Titan One'));
    await act(async () => {
      editorOf(view!.container).commands.insertContent('X');
    });
    expect(view!.container.querySelector('.ProseMirror span[data-font="titan-one"]')?.textContent).toBe('X');
    // "Default font" with the cursor inside a word: removed from the whole word (as "Remove text colour").
    await select(3, 3);
    expect(fontButton().textContent).toBe('Lora');
    await click(fontButton());
    await waitFor(() => !!button(view!.container, 'Inter (default)'), 2000, 'menu');
    await click(button(view!.container, 'Inter (default)'));
    expect(view!.container.querySelector('.ProseMirror span[data-font="lora"]')).toBeNull();
  });
});
