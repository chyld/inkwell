// @vitest-environment happy-dom
// Styles in the editor (STYLES-SPEC 5, 8): applying with and without a selection (criteria 5-9), Save
// selection as style (11), the Styles menu (13), the shared loader with an open note (16), and in the
// menu a retired font (3) and a name with metacharacters (19).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { FONT_CATALOGUE, fontById } from '../../src/shared/fonts';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { clearAllFonts, FaceLoader, setFaceLoader } from '../../src/web/fonts/runtime';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { refreshStyles, resetStyles } from '../../src/web/stylesStore';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';
import { HASH, installFontEnv } from './fonts-env';

type S = { id: string; name: string; font: string | null; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; textColor: string | null; highlight: string | null };
let seq = 0;
const st = (name: string, over: Partial<S> = {}): S => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, name, font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null, ...over });
const NOTE_ID = '66666666-6666-4666-8666-666666666666';
const t = (text: string, marks: unknown[] = []) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const m = {
  bold: { type: 'bold' },
  italic: { type: 'italic' },
  underline: { type: 'underline' },
  strike: { type: 'strike' },
  code: { type: 'code' },
  link: { type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } },
  font: (font: string) => ({ type: 'fontFamily', attrs: { font } }),
  size: (size: number) => ({ type: 'fontSize', attrs: { size } }),
  color: (color: string) => ({ type: 'textColor', attrs: { color } }),
  hl: (color: string) => ({ type: 'highlight', attrs: { color } }),
};

let styles: S[];
let collection: string[];
let stored: any;
let view: Awaited<ReturnType<typeof render>> | null = null;
const props = { noteId: NOTE_ID, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onTrashed: vi.fn(), onRestored: vi.fn(), onDeleted: vi.fn(), onTagsChanged: vi.fn(), onStorageChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn(), onManageStyles: vi.fn() };

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setFaceLoader(null);
  setPreviewLoader(new PreviewLoader({ fetchPreview: async () => HASH(9), now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }));
  localStorage.clear();
  styles = [];
  collection = ['lora'];
  props.onManageStyles.mockClear();
  resetStyles();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(content: unknown[]) {
  stored = { type: 'doc', content };
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: { id: NOTE_ID, title: 'Styled', body: stored, version: 3, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT' && path === `/api/notes/${NOTE_ID}`) {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/styles' && method === 'GET') return { status: 200, json: styles };
    if (path === '/api/styles' && method === 'POST') {
      const made = { ...st(b.name), ...b };
      styles = [...styles, made];
      return { status: 201, json: made };
    }
    if (path === '/api/fonts/collection') return { status: 200, json: collection };
    if (path.startsWith('/api/fonts/faces/')) return { status: 200, json: { faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(3) }] } };
    if (path.startsWith('/api/fonts/preview/')) return { status: 200, json: { file: HASH(9) } };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(props as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
}
const ed = () => editorOf(view!.container);
const doc = () => ed().getJSON();
const select = (from: number, to: number) => act(async () => void ed().chain().focus().setTextSelection({ from, to }).run());
const stylesButton = () => view!.container.querySelector('.styles-button') as HTMLButtonElement;
async function choose(name: string) {
  await click(stylesButton());
  await waitFor(() => [...view!.container.querySelectorAll('.styles-popover .style-item')].some((b) => b.textContent === name), 2000, 'menu');
  await click([...view!.container.querySelectorAll('.styles-popover .style-item')].find((b) => b.textContent === name));
}
/** Every text piece of the first block's content with its marks, sorted by type. */
const pieces = (block = doc().content[0]) =>
  (block.content ?? []).map((n: any) => ({ text: n.text, marks: (n.marks ?? []).map((x: any) => (x.attrs?.font ? `font:${x.attrs.font}` : x.attrs?.size ? `size:${x.attrs.size}` : x.attrs?.color ? `${x.type}:${x.attrs.color}` : x.type)).sort() }));

describe('applying a style to a selection (criterion 5)', () => {
  it('leaves every piece with exactly the style marks; marks the style lacks go; links are kept', async () => {
    styles = [st('Teal', { font: 'caveat', size: 18, bold: true, textColor: 'teal' })];
    await open([p(t('aa', [m.bold, m.color('ruby'), m.font('lora'), m.size(20)]), t('bb', [m.italic, m.link, m.hl('topaz')]), t('cc', [m.underline, m.strike, m.size(30)]))]);
    await select(1, 7);
    await choose('Teal');
    const want = ['bold', 'font:caveat', 'size:18', 'textColor:teal'];
    expect(pieces()).toEqual([
      { text: 'aa', marks: want },
      { text: 'bb', marks: [...want, 'link'].sort() },
      { text: 'cc', marks: want },
    ]);
  });

  it('applied straight after typing, one Undo restores the formatting and keeps the typing', async () => {
    styles = [st('Loud', { bold: true, size: 24, highlight: 'coral' })];
    await open([p(t('hello', [m.italic]))]);
    await select(6, 6);
    await act(async () => void ed().commands.insertContent(' world'));
    await select(1, 12);
    await choose('Loud');
    expect(pieces()).toEqual([{ text: 'hello world', marks: ['bold', 'highlight:coral', 'size:24'] }]);
    await act(async () => void ed().commands.undo());
    expect(pieces()).toEqual([{ text: 'hello world', marks: ['italic'] }]); // typing kept, formatting back
  });
});

describe('the size rule (criterion 6)', () => {
  it('16 leaves no size mark in a paragraph, a list, a quote and a table cell, and sets one in a heading; a heading keeps its weight', async () => {
    styles = [st('Normal'), st('H1 size', { size: 26 })];
    await open([
      p(t('para', [m.size(30)])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item', [m.size(30)]))] }] },
      { type: 'blockquote', content: [p(t('quote', [m.size(30)]))] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('cell', [m.size(30)]))] }] }] },
      { type: 'heading', attrs: { level: 1 }, content: [t('Title', [m.bold])] },
    ]);
    await act(async () => void ed().commands.selectAll());
    await choose('Normal');
    const json = JSON.stringify(doc());
    expect((json.match(/"fontSize"/g) ?? []).length).toBe(1);
    const heading = () => doc().content.find((n: any) => n.type === 'heading');
    const h = heading();
    expect(h.type).toBe('heading');
    expect(pieces(h)).toEqual([{ text: 'Title', marks: ['size:16'] }]); // not bold as a mark; the heading block keeps its own weight
    await act(async () => void ed().commands.selectAll());
    await choose('H1 size');
    expect(pieces(heading())).toEqual([{ text: 'Title', marks: [] }]); // equals the heading's own size: none
    expect(pieces(doc().content[0])).toEqual([{ text: 'para', marks: ['size:26'] }]);
  });
});

describe('code and tables (criterion 7)', () => {
  it('inline code and a code block in the selection are unchanged', async () => {
    styles = [st('Red', { textColor: 'ruby', bold: true })];
    await open([p(t('a '), t('code()', [m.code]), t(' b')), { type: 'codeBlock', attrs: { language: null }, content: [t('let x = 1;')] }, p(t('end'))]);
    const before = JSON.stringify(doc().content[1]);
    await act(async () => void ed().commands.selectAll());
    await choose('Red');
    expect(pieces()).toEqual([
      { text: 'a ', marks: ['bold', 'textColor:ruby'] },
      { text: 'code()', marks: ['code'] },
      { text: ' b', marks: ['bold', 'textColor:ruby'] },
    ]);
    expect(JSON.stringify(doc().content[1])).toBe(before);
  });

  it('with two diagonal cells selected, the other cells are unchanged', async () => {
    styles = [st('Bold', { bold: true })];
    const cell = (s: string) => ({ type: 'tableCell', content: [p(t(s))] });
    await open([{ type: 'table', content: [0, 1, 2].map((r) => ({ type: 'tableRow', content: [0, 1, 2].map((c) => cell(`r${r}c${c}`)) })) }]);
    await act(async () => {
      const d = ed().state.doc;
      const cellPos: number[] = [];
      d.descendants((n: any, pos: number) => {
        if (n.type.name === 'tableCell') cellPos.push(pos);
      });
      ed().view.dispatch(ed().state.tr.setSelection(CellSelection.create(d, cellPos[0], cellPos[4]))); // (0,0) to (1,1)
    });
    await choose('Bold');
    const cells = doc().content[0].content.flatMap((r: any) => r.content.map((c: any) => ({ text: c.content[0].content[0].text, bold: !!c.content[0].content[0].marks })));
    expect(cells.filter((c: any) => c.bold).map((c: any) => c.text)).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
  });

  it('the button is disabled with the cursor in code and with a selection of code only', async () => {
    await open([p(t('a '), t('code', [m.code])), { type: 'codeBlock', attrs: { language: null }, content: [t('block')] }]);
    await select(5, 5);
    expect(stylesButton().disabled).toBe(true);
    await select(3, 7);
    expect(stylesButton().disabled).toBe(true);
    await select(10, 10);
    expect(stylesButton().disabled).toBe(true);
    await select(1, 2);
    expect(stylesButton().disabled).toBe(false);
  });
});

describe('with no selection (criterion 8)', () => {
  it('changes no existing text; the next typed text has exactly the style marks plus the link it was typed into', async () => {
    styles = [st('Mark', { font: 'lora', italic: true, highlight: 'aqua', size: 20 })];
    await open([p(t('hello', [m.bold, m.link, m.color('ruby')]))]);
    await select(3, 3);
    const before = JSON.stringify(doc());
    await choose('Mark');
    expect(JSON.stringify(doc())).toBe(before);
    await act(async () => void ed().commands.insertContent('X'));
    const x = pieces().find((q: any) => q.text === 'X');
    expect(x.marks).toEqual(['font:lora', 'highlight:aqua', 'italic', 'link', 'size:20']);
  });
});

describe('the 50-font limit (criterion 9)', () => {
  const ids = FONT_CATALOGUE.slice(0, 50).map((f) => f.id);
  const fifty = () => [p(...ids.map((id, i) => t(`w${i} `, [m.font(id)])), t('plain'))];
  it('a 51st distinct font is refused with the notice, with and without a selection', async () => {
    styles = [st('New font', { font: 'caveat' })];
    await open(fifty());
    const before = JSON.stringify(doc());
    const end = ed().state.doc.content.size - 1;
    await select(end - 5, end);
    await choose('New font');
    await waitFor(() => document.body.textContent!.includes('A note can use at most 50 fonts.'), 2000, 'notice');
    expect(JSON.stringify(doc())).toBe(before);
    await select(end, end);
    await choose('New font');
    await act(async () => void ed().commands.insertContent('Y'));
    expect(JSON.stringify(doc())).not.toContain('caveat');
  });

  it('a style that replaces fonts so the result has 50 or fewer is applied', async () => {
    styles = [st('New font', { font: 'caveat' })];
    await open(fifty());
    await select(1, 4); // all of "w0 ": its font is used nowhere else
    await choose('New font');
    expect(JSON.stringify(doc())).toContain('caveat');
    expect(JSON.stringify(doc())).not.toContain(`"${ids[0]}"`);
  });
});

describe('Save selection as style (criterion 11)', () => {
  const form = () => document.querySelector('.style-form') as HTMLElement | null;
  const formState = () => ({
    name: (form()!.querySelector('input:not([aria-label])') as HTMLInputElement).value,
    font: form()!.querySelector('.font-button')!.getAttribute('aria-label'),
    size: (form()!.querySelector('input[aria-label="Font size"]') as HTMLInputElement).value,
    on: ['Bold', 'Italic', 'Underline', 'Strikethrough'].filter((l) => form()!.querySelector(`[aria-label="${l}"]`)!.getAttribute('aria-pressed') === 'true'),
    colour: form()!.querySelector('[aria-label^="Text colour"]')!.getAttribute('aria-label'),
    highlight: form()!.querySelector('[aria-label^="Highlight"]')!.getAttribute('aria-label'),
  });
  async function saveSelection() {
    await click(stylesButton());
    await waitFor(() => !!button(view!.container, 'Save selection as style…'), 2000, 'menu');
    await click(button(view!.container, 'Save selection as style…'));
    await waitFor(() => !!form(), 2000, 'form');
  }
  const content = () => [p(t('plain '), t('fancy', [m.bold, m.underline, m.font('caveat'), m.size(22), m.color('sapphire'), m.hl('aqua')]), t(' tail', [m.italic]))];

  it('from the first selected text, forward and backward, and at a boundary between two formats', async () => {
    await open(content());
    for (const [anchor, head] of [
      [9, 16], // inside "fancy" into " tail"
      [16, 9], // the same, dragged backwards
    ]) {
      await act(async () => void ed().view.dispatch(ed().state.tr.setSelection(TextSelection.create(ed().state.doc, anchor, head))));
      await saveSelection();
      expect(formState()).toEqual({ name: '', font: 'Font: Caveat', size: '22', on: ['Bold', 'Underline'], colour: 'Text colour: Sapphire', highlight: 'Highlight: Aqua' });
      await click(button(form()!, 'Cancel'));
    }
    await select(12, 16); // starts exactly where "fancy" ends: the first text is " tail"
    await saveSelection();
    expect(formState()).toMatchObject({ font: 'Font: Inter', size: '16', on: ['Italic'], colour: 'Text colour', highlight: 'Highlight' });
    await click(button(form()!, 'Cancel'));
  });

  it("from the cursor's formatting with no selection, and from plain text (Inter, the block's size, nothing on)", async () => {
    await open([...content(), { type: 'heading', attrs: { level: 2 }, content: [t('Head')] }]);
    await select(10, 10);
    await saveSelection();
    expect(formState()).toMatchObject({ font: 'Font: Caveat', size: '22', on: ['Bold', 'Underline'] });
    await click(button(form()!, 'Cancel'));
    await select(2, 4);
    await saveSelection();
    expect(formState()).toEqual({ name: '', font: 'Font: Inter', size: '16', on: [], colour: 'Text colour', highlight: 'Highlight' });
    await click(button(form()!, 'Cancel'));
    const end = ed().state.doc.content.size;
    await select(end - 3, end - 3); // in the heading
    await saveSelection();
    expect(formState().size).toBe('21');
    await click(button(form()!, 'Cancel'));
  });

  it('from text whose font is not in the collection: the form lists it and saves it; the note is unchanged', async () => {
    await open(content());
    await select(8, 11);
    const before = JSON.stringify(doc());
    await saveSelection();
    await click(form()!.querySelector('.font-button'));
    await waitFor(() => !!form()!.querySelector('[data-font-id="caveat"]'), 2000, 'listed');
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => {
      const name = form()!.querySelector('input:not([aria-label])') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Fancy');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(form()!, 'Save'));
    await waitFor(() => !form(), 2000, 'saved');
    expect(requests.find((r) => r.method === 'POST' && r.path === '/api/styles')!.body).toEqual({ name: 'Fancy', font: 'caveat', size: 22, bold: true, italic: false, underline: true, strike: false, textColor: 'sapphire', highlight: 'aqua' });
    expect(JSON.stringify(doc())).toBe(before);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });
});

describe('the Styles menu (criterion 13) and names in it (criterion 19)', () => {
  it('first in the toolbar; styles in order with a 96 px sample carrying 20; the two entries; Manage styles', async () => {
    styles = [st('Alpha', { bold: true }), st('Huge', { size: 96 }), st('<b>{x}</b>', { italic: true })];
    await open([p(t('x'))]);
    expect(view!.container.querySelector('.toolbar button')!.getAttribute('aria-label')).toBe('Styles');
    expect(stylesButton().textContent).toBe('Styles');
    await click(stylesButton());
    await waitFor(() => view!.container.querySelectorAll('.styles-popover .style-item').length === 3, 2000, 'menu');
    const items = [...view!.container.querySelectorAll('.styles-popover button')];
    expect(items.map((b) => b.textContent)).toEqual(['Alpha', 'Huge', '<b>{x}</b>', 'Save selection as style…', 'Manage styles…']);
    expect(items[1].querySelector('[data-font-size]')!.getAttribute('data-font-size')).toBe('20');
    expect(items[2].querySelector('b')).toBeNull(); // plain text
    expect(items[3].classList.contains('font-browse')).toBe(true); // after a separator
    expect(document.activeElement).toBe(items[0]);
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(items[4]);
    await click(items[4]);
    expect(props.onManageStyles).toHaveBeenCalled();
  });

  it('with many styles, the styles are in the scrolling list and the two entries below it; arrow keys scroll the focused row into view', async () => {
    styles = Array.from({ length: 50 }, (_, i) => st(`Style ${String(i).padStart(2, '0')}`, { size: [12, 28, 64, 96][i % 4] }));
    await open([p(t('x'))]);
    await click(stylesButton());
    await waitFor(() => view!.container.querySelectorAll('.styles-popover .style-item').length === 50, 2000, 'menu');
    const pop = view!.container.querySelector('.styles-popover')!;
    expect([...pop.children].map((c) => c.className)).toEqual(['menu-scroll', 'menu-footer']);
    expect(pop.querySelectorAll('.menu-scroll > .style-item').length).toBe(50);
    expect([...pop.querySelectorAll('.menu-footer > button')].map((b) => b.textContent)).toEqual(['Save selection as style…', 'Manage styles…']);
    expect((pop as HTMLElement).style.maxHeight).toMatch(/^\d+px$/); // from the room in the viewport
    const seen: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      seen.push(this.textContent ?? '');
    });
    try {
      for (const k of ['ArrowDown', 'ArrowDown', 'End', 'ArrowUp', 'ArrowUp', 'Home']) {
        await act(async () => {
          (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        });
      }
      expect(seen).toEqual(['Style 01', 'Style 02', 'Manage styles…', 'Save selection as style…', 'Style 49', 'Style 00']);
      expect(document.activeElement!.textContent).toBe('Style 00');
    } finally {
      spy.mockRestore();
    }
  });

  it('the font menu with 50 fonts: Inter and the fonts in the scrolling list, Browse fonts… below it; arrow keys scroll', async () => {
    collection = FONT_CATALOGUE.slice(0, 50).map((f) => f.id);
    await open([p(t('x'))]);
    await click(view!.container.querySelector('.toolbar .font-button'));
    await waitFor(() => view!.container.querySelectorAll('.font-popover [data-font-id]').length === 50, 2000, 'font menu');
    const pop = view!.container.querySelector('.font-popover')!;
    expect([...pop.children].map((c) => c.className)).toEqual(['menu-scroll', 'menu-footer']);
    expect(pop.querySelectorAll('.menu-scroll > [data-font-id]').length).toBe(50);
    expect(pop.querySelector('.menu-scroll > .font-default')).not.toBeNull();
    expect([...pop.querySelectorAll('.menu-footer > button')].map((b) => b.textContent)).toEqual(['Browse fonts…']);
    const seen: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      seen.push(this.textContent ?? '');
    });
    try {
      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      });
      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      });
      expect(seen).toEqual(['Browse fonts…', fontById(collection.at(-1)!)!.family]);
    } finally {
      spy.mockRestore();
    }
  });

  it('"No styles yet" when empty', async () => {
    await open([p(t('x'))]);
    await click(stylesButton());
    await waitFor(() => !!view!.container.querySelector('.styles-popover .font-empty'), 2000, 'empty');
    expect(view!.container.querySelector('.styles-popover .font-empty')!.textContent).toBe('No styles yet');
    expect([...view!.container.querySelectorAll('.styles-popover button')].map((b) => b.textContent)).toEqual(['Save selection as style…', 'Manage styles…']);
  });

  it('a style holding a retired font can be applied (criterion 3)', async () => {
    const f = fontById('caveat')! as { retired: boolean };
    f.retired = true;
    try {
      styles = [st('Old', { font: 'caveat' })];
      await open([p(t('hello'))]);
      await select(1, 6);
      await choose('Old');
      expect(pieces()).toEqual([{ text: 'hello', marks: ['font:caveat'] }]);
    } finally {
      f.retired = false;
    }
  });
});

describe('the shared loader with an open note (criterion 16)', () => {
  it('never more than 6 /faces in flight together; a note with 50 fonts still gets its fonts and the menu its own', async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let max = 0;
    const asked: string[] = [];
    setFaceLoader(
      new FaceLoader({
        getFaces: async (id) => {
          asked.push(id);
          active++;
          max = Math.max(max, active);
          await new Promise<void>((r) => releases.push(r));
          active--;
          return { faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(id.length) }] };
        },
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
      }),
    );
    const ids = FONT_CATALOGUE.slice(0, 50).map((f) => f.id);
    styles = [st('A', { font: 'caveat' }), st('B', { font: 'caveat', bold: true }), st('C', { font: 'sunflower' })];
    await open([p(...ids.map((id, i) => t(`w${i} `, [m.font(id)])))]);
    await click(stylesButton());
    await waitFor(() => view!.container.querySelectorAll('.styles-popover .style-item').length === 3, 2000, 'menu');
    while (releases.length) {
      await act(async () => releases.shift()!());
      await settle();
    }
    expect(max).toBe(6);
    expect(asked.filter((a) => a === 'caveat').length).toBe(1); // one request for a font used by two styles
    expect(asked).toContain('sunflower');
    expect(new Set(asked).size).toBe(52);
  });
});

describe('the style name on the Styles button (DEVIATIONS 43)', () => {
  const label = () => stylesButton().querySelector('.font-button-label')!.textContent;
  const named = (n: string) => {
    expect(label()).toBe(n);
    const a = n === 'Styles' ? 'Styles' : `Style: ${n}`;
    expect(stylesButton().getAttribute('aria-label')).toBe(a);
    expect(stylesButton().getAttribute('title')).toBe(a);
  };
  /** Run the steps and check the note was not changed by any of them (no change, no save). */
  async function unchanged(steps: () => Promise<void>) {
    const before = JSON.stringify(doc());
    const puts = requests.filter((r) => r.method === 'PUT').length;
    await steps();
    await settle();
    expect(JSON.stringify(doc())).toBe(before);
    expect(requests.filter((r) => r.method === 'PUT').length).toBe(puts);
  }
  const alert = () => st('Alert', { bold: true, textColor: 'ruby' });
  const loaded = () => waitFor(() => requests.some((r) => r.method === 'GET' && r.path === '/api/styles'), 2000, 'styles loaded').then(settle);

  it('is loaded when the editor mounts: the name shows without opening the menu; plain text matching nothing reads Styles', async () => {
    styles = [alert()];
    await open([p(t('plain '), t('loud', [m.bold, m.color('ruby')]))]);
    await loaded();
    await select(2, 2);
    named('Styles');
    expect(stylesButton().disabled).toBe(false);
    await unchanged(async () => {
      await select(8, 8);
      named('Alert');
    });
  });

  it('with no selection, right after choosing a style, shows its name; typed text keeps it; un-bolding goes back to Styles', async () => {
    styles = [alert()];
    await open([p(t('hello'))]);
    await loaded();
    await select(6, 6);
    named('Styles');
    await unchanged(async () => {
      await choose('Alert');
      named('Alert'); // from the stored marks, before anything is typed
    });
    await act(async () => void ed().commands.insertContent('xy'));
    named('Alert');
    await select(6, 8);
    named('Alert');
    await act(async () => void ed().chain().focus().toggleBold().run());
    named('Styles');
  });

  it('hand-formatted text equal to a style shows it (a link is ignored); a selection reads every piece', async () => {
    styles = [alert(), st('Calm', { italic: true })];
    await open([p(t('aa', [m.bold, m.color('ruby')]), t('bb', [m.bold, m.color('ruby'), m.link]), t('cc', [m.italic]), t('dd'))]);
    await loaded();
    await unchanged(async () => {
      await select(1, 5);
      named('Alert'); // aa and the linked bb
      await select(5, 7);
      named('Calm');
      await select(3, 7);
      named('Mixed'); // two different styles
      await select(5, 9);
      named('Mixed'); // a style and text matching none
      await select(7, 9);
      named('Styles'); // all match none
      await select(9, 1); // backwards
      named('Mixed');
    });
  });

  it('a heading matches by its default size; a paragraph needs the size mark; settings must be exact', async () => {
    styles = [st('Big bold', { size: 26, bold: true })];
    await open([
      { type: 'heading', attrs: { level: 1 }, content: [t('Head', [m.bold])] },
      p(t('para', [m.bold, m.size(26)]), t(' plain26', [m.size(26)]), t(' boldital', [m.bold, m.italic, m.size(26)])),
    ]);
    await loaded();
    const headPos = 1;
    await unchanged(async () => {
      await select(headPos + 1, headPos + 3);
      named('Big bold');
      const pStart = 1 + 4 + 2; // inside the paragraph
      await select(pStart, pStart + 4);
      named('Big bold');
      await select(pStart + 5, pStart + 10);
      named('Styles'); // not bold
      await select(pStart + 13, pStart + 18);
      named('Styles'); // italic too
    });
  });

  it('a table cell selection reads the text of every selected cell', async () => {
    styles = [alert()];
    const cell = (s: string, marks: unknown[]) => ({ type: 'tableCell', content: [p(t(s, marks))] });
    const loud = [m.bold, m.color('ruby')];
    await open([{ type: 'table', content: [0, 1, 2].map((r) => ({ type: 'tableRow', content: [0, 1, 2].map((c) => cell(`r${r}c${c}`, r === 2 && c === 0 ? [] : loud)) })) }, { type: 'paragraph' }]);
    await loaded();
    const cells = () => {
      const out: number[] = [];
      ed().state.doc.descendants((n: any, pos: number) => {
        if (n.type.name === 'tableCell') out.push(pos);
      });
      return out;
    };
    const cellSel = (a: number, b: number) => act(async () => void ed().view.dispatch(ed().state.tr.setSelection(CellSelection.create(ed().state.doc, cells()[a], cells()[b]))));
    await unchanged(async () => {
      await cellSel(0, 4); // (0,0)-(1,1): all loud
      named('Alert');
      await cellSel(3, 7); // (1,0)-(2,1): includes the plain r2c0
      named('Mixed');
    });
  });

  it('in code it reads Styles and is disabled; code in a selection is skipped', async () => {
    styles = [alert(), st('Plain')];
    // Ends with a paragraph: the editor adds one after a final code block or table on its first transaction.
    await open([p(t('loud', [m.bold, m.color('ruby')]), t('code', [m.code])), { type: 'codeBlock', attrs: { language: null }, content: [t('block')] }, { type: 'paragraph' }]);
    await loaded();
    await unchanged(async () => {
      await select(7, 7); // in the inline code
      named('Styles');
      expect(stylesButton().disabled).toBe(true);
      await select(12, 12); // in the code block
      named('Styles');
      expect(stylesButton().disabled).toBe(true);
      await select(1, 9); // loud + code: the code is skipped
      named('Alert');
      await select(1, 15); // and the code block
      named('Alert');
    });
  });

  it('styles with identical settings: the first in list order, marked current in the menu', async () => {
    styles = [st('Zed', { italic: true }), st('First', { bold: true }), st('Second', { bold: true })];
    await open([p(t('bold', [m.bold]))]);
    await loaded();
    await unchanged(async () => {
      await select(1, 5);
      named('First');
      await click(stylesButton());
      await waitFor(() => view!.container.querySelectorAll('.styles-popover .style-item').length === 3, 2000, 'menu');
      const items = [...view!.container.querySelectorAll('.styles-popover .style-item')];
      expect(items.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
      expect(document.activeElement).toBe(items[1]);
      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
    });
  });

  it('opening the menu focuses the current style and scrolls the list to it', async () => {
    styles = Array.from({ length: 50 }, (_, i) => st(`S${i}`, { size: 20 + i }));
    await open([p(t('x', [m.size(60)]))]);
    await loaded();
    await select(1, 2);
    named('S40');
    const seen: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      seen.push(this.textContent ?? '');
    });
    try {
      await click(stylesButton());
      await waitFor(() => view!.container.querySelectorAll('.styles-popover .style-item').length === 50, 2000, 'menu');
      await settle();
      expect(document.activeElement!.textContent).toBe('S40');
      expect(document.activeElement!.getAttribute('aria-pressed')).toBe('true');
      expect(seen).toContain('S40');
    } finally {
      spy.mockRestore();
    }
  });

  it('a style edited later no longer matches text stamped earlier; a rename shows the new name; a delete reads Styles', async () => {
    styles = [alert()];
    await open([p(t('hello world'))]);
    await loaded();
    await select(1, 6);
    await choose('Alert');
    await select(1, 6);
    named('Alert');
    await unchanged(async () => {
      styles = [{ ...styles[0], name: 'Warning' }];
      await act(async () => void (await refreshStyles()));
      named('Warning');
      styles = [{ ...styles[0], textColor: 'sapphire' }];
      await act(async () => void (await refreshStyles()));
      named('Styles');
      styles = [{ ...styles[0], textColor: 'ruby' }];
      await act(async () => void (await refreshStyles()));
      named('Warning');
      styles = [];
      await act(async () => void (await refreshStyles()));
      named('Styles');
    });
  });

  it('Save selection as style refreshes the list: the button shows the new style at once; the note is unchanged', async () => {
    await open([p(t('fancy', [m.underline, m.color('sapphire')]))]);
    await loaded();
    await select(1, 6);
    named('Styles');
    await unchanged(async () => {
      await click(stylesButton());
      await waitFor(() => !!button(view!.container, 'Save selection as style…'), 2000, 'menu');
      await click(button(view!.container, 'Save selection as style…'));
      const form = () => document.querySelector('.style-form') as HTMLElement | null;
      await waitFor(() => !!form(), 2000, 'form');
      await act(async () => {
        const name = form()!.querySelector('input:not([aria-label])') as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Blue line');
        name.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(button(form()!, 'Save'));
      await waitFor(() => !form(), 2000, 'saved');
      await waitFor(() => label() === 'Blue line', 2000, 'name');
      named('Blue line');
    });
  });
});
