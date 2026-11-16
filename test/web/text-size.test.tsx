// @vitest-environment happy-dom
// Text size (the fontSize mark and the − [n] + control) and underline in the editor: paste rules,
// the control's behaviour, a round trip through save and reload, and the toolbar's order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { noteExtensions } from '../../src/shared/schema';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { clearAllFonts } from '../../src/web/fonts/runtime';
import { click, editorOf, mockFetch, render, waitFor } from './harness';
import { installFontEnv } from './fonts-env';

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  localStorage.clear();
});

describe('paste', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions, content: '<p></p>' });
  });
  afterEach(() => editor.destroy());
  const paste = (html: string) => {
    editor.commands.setContent('<p></p>');
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    const marks: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText) for (const m of n.marks) marks.push(m.attrs.size ? `size:${m.attrs.size}` : m.attrs.font ? `font:${m.attrs.font}` : m.attrs.color ? `${m.type.name}:${m.attrs.color}` : m.type.name);
    });
    return { marks: marks.sort(), html: editor.getHTML() };
  };

  it('font-size styles, <font size> and anything but a whole number from 8 to 96 give no size', () => {
    for (const html of [
      '<p><span style="font-size: 30px">a</span></p>',
      '<p><span style="font-size: 2em">a</span></p>',
      '<p><font size="7">a</font></p>',
      '<p><span data-font-size="7">a</span></p>',
      '<p><span data-font-size="97">a</span></p>',
      '<p><span data-font-size="16.5">a</span></p>',
      '<p><span data-font-size="18px">a</span></p>',
      '<p><span data-font-size=" 18">a</span></p>',
      '<p><span data-font-size="">a</span></p>',
    ]) expect(paste(html).marks, html).toEqual([]);
  });

  it('our own attribute is kept without any style; one element with several of our attributes keeps every mark', () => {
    const ok = paste('<p><span data-font-size="18" style="font-size: 40px">a</span></p>');
    expect(ok.marks).toEqual(['size:18']);
    expect(ok.html).toBe('<p><span data-font-size="18">a</span></p>');
    expect(paste('<p><span data-font-size="20" data-font="lora" data-text-color="ruby">a</span></p>').marks).toEqual(['font:lora', 'size:20', 'textColor:ruby']);
    expect(paste('<p><mark data-highlight="aqua" data-font-size="12" data-text-color="teal">a</mark></p>').marks).toEqual(['highlight:aqua', 'size:12', 'textColor:teal']);
    expect(paste('<p><strong><em><s><a href="https://example.com"><span data-font-size="30">a</span></a></s></em></strong></p>').marks).toEqual(['bold', 'italic', 'link', 'size:30', 'strike']);
    expect(paste('<p><code><span data-font-size="30">a</span></code></p>').marks).toEqual(['code']);
    expect(paste('<pre><code><span data-font-size="30">a</span></code></pre>').marks).toEqual([]);
  });

  it('underline: <u> and text-decoration as far as the stock rule goes; stored without any style', () => {
    expect(paste('<p><u>a</u></p>').marks).toEqual(['underline']);
    const styled = paste('<p><span style="text-decoration: underline">a</span></p>');
    expect(styled.marks).toEqual(['underline']);
    expect(styled.html).toBe('<p><u>a</u></p>');
    expect(paste('<p><code><u>a</u></code></p>').marks).toEqual(['code']);
  });
});

// ---- the editor ---------------------------------------------------------------

const NOTE_ID = '77777777-7777-4777-8777-777777777777';
const t = (s: string, marks: unknown[] = []) => ({ type: 'text', text: s, ...(marks.length ? { marks } : {}) });
const sz = (n: number) => ({ type: 'fontSize', attrs: { size: n } });
let view: Awaited<ReturnType<typeof render>> | null = null;
let stored: any;
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(content: unknown[]) {
  stored = { type: 'doc', content };
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: { id: NOTE_ID, title: 'Sizes', body: stored, version: 3, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT') {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/fonts/collection') return { status: 200, json: [] };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
  const props = { noteId: NOTE_ID, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onTrashed: vi.fn(), onRestored: vi.fn(), onDeleted: vi.fn(), onTagsChanged: vi.fn(), onStorageChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn() };
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(props as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
}
const ed = () => editorOf(view!.container);
const select = (from: number, to: number) => act(async () => void ed().chain().focus().setTextSelection({ from, to }).run());
const btn = (label: string) => view!.container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const input = () => view!.container.querySelector('input[aria-label="Font size"]') as HTMLInputElement;
const sizes = () => [...view!.container.querySelectorAll('.ProseMirror [data-font-size]')].map((e) => `${e.textContent}:${e.getAttribute('data-font-size')}`);
async function typeSize(v: string, key = 'Enter') {
  await act(async () => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), v);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('the size control', () => {
  it('is − [n] + with labels and tooltips, right after the font menu', async () => {
    await open([{ type: 'paragraph', content: [t('hello world')] }]);
    for (const l of ['Decrease font size', 'Increase font size']) {
      expect(btn(l).getAttribute('title')).toBe(l);
      expect(btn(l).querySelector('svg.lucide')).toBeTruthy();
    }
    expect(input().getAttribute('title')).toBe('Font size');
    // The whole toolbar (DEVIATIONS 45): Styles | font | − n + | colours | marks | block dropdowns | Undo, Redo.
    const order = [...view!.container.querySelector('.toolbar')!.querySelectorAll('button, input, .tb-sep')].map((e) => (e.classList.contains('tb-sep') ? '|' : e.getAttribute('aria-label')));
    expect(order).toEqual(['Styles', '|', 'Font: Inter', '|', 'Decrease font size', 'Font size', 'Increase font size', '|', 'Text colour', 'Highlight', '|', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code', 'Link', '|', 'Headings', 'Lists', 'Blocks', 'Insert', '|', 'Undo', 'Redo']);
  });

  it('shows the effective size: the block default (16 in a paragraph, 26/21/18 in headings) or the mark', async () => {
    await open([
      { type: 'heading', attrs: { level: 1 }, content: [t('Title')] },
      { type: 'heading', attrs: { level: 3 }, content: [t('Sub')] },
      { type: 'paragraph', content: [t('plain '), t('big', [sz(40)])] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('item')] }] }] },
    ]);
    await select(2, 2);
    expect(input().value).toBe('26');
    await select(9, 9);
    expect(input().value).toBe('18');
    await select(13, 13);
    expect(input().value).toBe('16');
    await select(20, 20); // inside "big"
    expect(input().value).toBe('40');
    await select(27, 27); // inside the list item
    expect(input().value).toBe('16');
  });

  it('each press changes the selected text by 1 px; reaching the default removes the mark', async () => {
    await open([{ type: 'paragraph', content: [t('hello world')] }]);
    await select(1, 6);
    await click(btn('Increase font size'));
    await click(btn('Increase font size'));
    expect(sizes()).toEqual(['hello:18']);
    expect(input().value).toBe('18');
    await click(btn('Decrease font size'));
    await click(btn('Decrease font size'));
    expect(sizes()).toEqual([]); // 16 is the paragraph's default: no mark is kept
    expect(JSON.stringify(ed().getJSON())).not.toContain('fontSize');
    await click(btn('Decrease font size'));
    expect(sizes()).toEqual(['hello:15']);
    expect(view!.container.querySelector('.ProseMirror [data-font-size]')!.getAttribute('style')).toBeNull();
  });

  it('a selection with several sizes shows the size at its start; + and − shift every part from its own size, clamped', async () => {
    await open([{ type: 'paragraph', content: [t('aa', [sz(20)]), t('bb'), t('cc', [sz(9)])] }]);
    await select(1, 7);
    expect(input().value).toBe('20');
    await click(btn('Increase font size'));
    expect(sizes()).toEqual(['aa:21', 'bb:17', 'cc:10']);
    for (let i = 0; i < 3; i++) await click(btn('Decrease font size'));
    expect(sizes()).toEqual(['aa:18', 'bb:14', 'cc:8']); // bb went 17, 16 (unmarked), 15, 14; cc stopped at 8
  });

  it('clamps to 8 and 96 and disables the buttons at the ends', async () => {
    await open([{ type: 'paragraph', content: [t('max', [sz(96)]), t(' '), t('min', [sz(8)])] }]);
    await select(1, 4);
    expect(btn('Increase font size').disabled).toBe(true);
    expect(btn('Decrease font size').disabled).toBe(false);
    await select(5, 8);
    expect(btn('Decrease font size').disabled).toBe(true);
    await select(1, 8); // both: each button can still change one part
    expect(btn('Increase font size').disabled).toBe(false);
    expect(btn('Decrease font size').disabled).toBe(false);
    await click(btn('Decrease font size'));
    expect(sizes()).toEqual(['max:95', ' :15', 'min:8']); // the unmarked space between them went from 16 to 15
  });

  it('in a heading the default is the heading size', async () => {
    await open([{ type: 'heading', attrs: { level: 2 }, content: [t('Heading')] }]);
    await select(1, 8);
    await click(btn('Increase font size'));
    expect(sizes()).toEqual(['Heading:22']);
    await click(btn('Decrease font size'));
    expect(sizes()).toEqual([]);
  });

  it('with no selection it sets the size of what is typed next, as the colour and font menus do', async () => {
    await open([{ type: 'paragraph', content: [t('hello')] }]);
    await select(6, 6);
    await click(btn('Increase font size'));
    expect(input().value).toBe('17');
    await act(async () => void ed().commands.insertContent('X'));
    expect(sizes()).toEqual(['X:17']);
    expect(view!.container.querySelector('.ProseMirror')!.textContent).toBe('helloX');
  });

  it('the number is an input: a whole number from 8 to 96 and Enter sets it; anything else is ignored and the old value restored', async () => {
    await open([{ type: 'paragraph', content: [t('hello world')] }]);
    await select(1, 6);
    await typeSize('40');
    expect(sizes()).toEqual(['hello:40']);
    expect(input().value).toBe('40');
    for (const bad of ['abc', '7', '97', '12.5', '', '-9']) {
      await select(1, 6);
      await typeSize(bad);
      expect(sizes(), bad).toEqual(['hello:40']);
      expect(input().value, bad).toBe('40');
    }
    await select(1, 6);
    await typeSize('30', 'Escape');
    expect(sizes()).toEqual(['hello:40']);
    expect(input().value).toBe('40');
    await select(1, 6);
    await typeSize('16'); // the default: the mark goes
    expect(sizes()).toEqual([]);
  });

  it('is unavailable inside code', async () => {
    await open([{ type: 'codeBlock', content: [t('let x')] }, { type: 'paragraph', content: [t('a '), t('b', [{ type: 'code' }])] }]);
    await select(2, 2);
    expect(btn('Increase font size').disabled).toBe(true);
    expect(input().disabled).toBe(true);
    await select(10, 11);
    expect(btn('Decrease font size').disabled).toBe(true);
  });

  it('round-trips through save and reload', async () => {
    await open([{ type: 'paragraph', content: [t('save me')] }]);
    await select(1, 5);
    await typeSize('24');
    await waitFor(() => JSON.stringify(stored).includes('fontSize'), 4000, 'saved');
    expect(stored.content[0].content[0]).toEqual(t('save', [sz(24)]));
    await view!.unmount();
    view = null;
    await open(stored.content);
    expect(sizes()).toEqual(['save:24']);
  });
});

describe('underline', () => {
  it('a button right after Italic with aria-pressed, and Ctrl/Cmd+U', async () => {
    await open([{ type: 'paragraph', content: [t('hello world')] }]);
    expect(btn('Underline').getAttribute('title')).toBe('Underline');
    await select(1, 6);
    await click(btn('Underline'));
    expect(view!.container.querySelector('.ProseMirror u')?.textContent).toBe('hello');
    expect(btn('Underline').getAttribute('aria-pressed')).toBe('true');
    await select(7, 12);
    await act(async () => {
      view!.container.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect([...view!.container.querySelectorAll('.ProseMirror u')].map((u) => u.textContent)).toEqual(['hello', 'world']);
    await waitFor(() => JSON.stringify(stored).includes('underline'), 4000, 'saved');
  });
});
