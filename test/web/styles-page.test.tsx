// @vitest-environment happy-dom
// The style form (criterion 12), the /styles page (14), its routing (15), and on the page: a font not in
// the collection (3) and a name with HTML and CSS metacharacters (19).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { fontById } from '../../src/shared/fonts';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { clearAllFonts } from '../../src/web/fonts/runtime';
import { button, click, mockFetch, render, requests, settle, waitFor } from './harness';
import { HASH, installFontEnv, registeredFamilies } from './fonts-env';

type S = { id: string; name: string; font: string | null; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; textColor: string | null; highlight: string | null };
let styles: Record<string, S[]>;
let user: 'u1' | 'u2';
let collection: string[];
let failFaces: Set<string>;
let seq = 0;
const NOTE = '99999999-9999-4999-8999-999999999999';
let noteBody: any;
const plain = (name: string, over: Partial<S> = {}): S => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, name, font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null, ...over });
const sorted = (l: S[]) => [...l].sort((a, b) => (a.name.trim().toLowerCase() < b.name.trim().toLowerCase() ? -1 : a.name.trim().toLowerCase() > b.name.trim().toLowerCase() ? 1 : a.id < b.id ? -1 : 1));

function server(opts: { signedIn?: boolean } = {}) {
  let signedIn = opts.signedIn ?? true;
  mockFetch((method, path, b) => {
    if (method === 'POST' && path === '/api/session') {
      signedIn = true;
      return { status: 200, json: { id: user, username: 'alice' } };
    }
    if (!signedIn) return { status: 401, json: { error: { code: 'unauthorized', message: 'Please sign in.' } } };
    if (path === '/api/session') return { status: 200, json: { id: user, username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: user, username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [{ id: NOTE, title: 'A note', snippet: '', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } }], nextCursor: null } };
    if (path === `/api/notes/${NOTE}` && method === 'GET') return { status: 200, json: { id: NOTE, title: 'A note', body: noteBody, version: 1, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT' && path === `/api/notes/${NOTE}`) {
      noteBody = b.body;
      return { status: 200, json: { version: 2, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/fonts/collection') return { status: 200, json: collection };
    const faces = /^\/api\/fonts\/faces\/([a-z0-9-]+)$/.exec(path);
    if (faces) return failFaces.has(faces[1]) ? { status: 502, json: { error: { code: 'font_unavailable', message: 'x' } } } : { status: 200, json: { faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(7) }] } };
    if (path.startsWith('/api/fonts/preview/')) return { status: 200, json: { file: HASH(9) } };
    const mine = (styles[user] ??= []);
    if (path === '/api/styles' && method === 'GET') return { status: 200, json: sorted(mine) };
    const key = (n: string) => n.trim().toLowerCase();
    if (path === '/api/styles' && method === 'POST') {
      if (!b.name?.trim()) return { status: 400, json: { error: { code: 'invalid_name', message: 'Give the style a name.' } } };
      if (mine.length >= 50) return { status: 409, json: { error: { code: 'styles_full', message: 'You can keep at most 50 styles. Delete one to add another.' } } };
      if (mine.some((s) => key(s.name) === key(b.name))) return { status: 409, json: { error: { code: 'name_taken', message: 'You already have a style with that name.' } } };
      const s = { ...plain(b.name.trim()), ...b, name: b.name.trim() };
      mine.push(s);
      return { status: 201, json: s };
    }
    const m = /^\/api\/styles\/([0-9a-f-]+)$/.exec(path);
    if (m && method === 'PUT') {
      const i = mine.findIndex((s) => s.id === m[1]);
      if (i < 0) return { status: 404, json: { error: { code: 'not_found', message: 'No such style.' } } };
      if (mine.some((s) => s.id !== m[1] && key(s.name) === key(b.name))) return { status: 409, json: { error: { code: 'name_taken', message: 'You already have a style with that name.' } } };
      mine[i] = { ...mine[i], ...b, name: b.name.trim() };
      return { status: 200, json: mine[i] };
    }
    if (m && method === 'DELETE') {
      styles[user] = mine.filter((s) => s.id !== m[1]);
      return { status: 200, json: { ok: true } };
    }
    return { status: 500, json: { error: { code: 'x', message: `unexpected ${method} ${path}` } } };
  });
}

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setPreviewLoader(new PreviewLoader({ fetchPreview: async () => HASH(9), now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }));
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/');
  document.title = 'Notes';
  styles = { u1: [], u2: [] };
  user = 'u1';
  collection = ['lora'];
  failFaces = new Set();
  noteBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function start(path = '/styles') {
  history.replaceState(null, '', path);
  view = await render(<App />);
}
const page = () => view!.container.querySelector('.styles-page');
const cards = () => [...view!.container.querySelectorAll('.style-card')] as HTMLElement[];
const dialog = () => document.querySelector('.style-form') as HTMLElement | null;
async function setValue(el: Element, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const inDialog = (label: string) => dialog()!.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const sizeInput = () => dialog()!.querySelector('input[aria-label="Font size"]') as HTMLInputElement;
async function openPage() {
  server();
  await start('/styles');
  await waitFor(() => !!page() && !!view!.container.querySelector('.styles-count')?.textContent, 3000, 'styles page');
}

describe('the style form (criterion 12)', () => {
  it('every control sets its field; the preview carries the settings; Save sends exactly them', async () => {
    await openPage();
    await click(button(view!.container, /New style/));
    await waitFor(() => !!dialog(), 2000, 'form');
    expect(dialog()!.getAttribute('role')).toBe('dialog');
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    const preview = () => dialog()!.querySelector('.style-preview .style-sample')!.innerHTML;
    // A new style: Inter, 16, nothing on, no colours.
    expect(preview()).toBe('<span data-font-size="16">The quick brown fox jumps over the lazy dog</span>');
    expect(document.activeElement).toBe(dialog()!.querySelector('input:not([aria-label])'));
    await setValue(dialog()!.querySelector('input:not([aria-label])')!, '  Callout  ');
    // Font menu: Inter first, then the collection; choosing Lora.
    await click(inDialog('Font: Inter'));
    await waitFor(() => !!dialog()!.querySelector('[data-font-id="lora"]'), 2000, 'font menu');
    expect([...dialog()!.querySelectorAll('.font-popover button')].map((b) => b.textContent)).toEqual(['Inter', 'Lora', 'Browse fonts…']);
    await click(dialog()!.querySelector('[data-font-id="lora"]'));
    expect(inDialog('Font: Lora')).toBeTruthy();
    // Size: + and −, and typed (takes effect without Enter; a bad one is restored on blur).
    await click(inDialog('Increase font size'));
    await click(inDialog('Increase font size'));
    await click(inDialog('Decrease font size'));
    expect((sizeInput() as HTMLInputElement).value).toBe('17');
    await setValue(sizeInput(), '30');
    expect(preview()).toContain('data-font-size="30"');
    await setValue(sizeInput(), '7');
    expect(preview()).toContain('data-font-size="30"');
    await act(async () => {
      sizeInput().dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      sizeInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect((sizeInput() as HTMLInputElement).value).toBe('30');
    // Toggles.
    for (const l of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
      await click(inDialog(l));
      expect(inDialog(l).getAttribute('aria-pressed'), l).toBe('true');
    }
    await click(inDialog('Italic'));
    // Colours: swatches and None.
    await click(inDialog('Text colour'));
    await click(dialog()!.querySelector('.color-popover [aria-label="Ruby"]'));
    await click(inDialog('Highlight'));
    await click(dialog()!.querySelector('.color-popover [aria-label="Aqua"]'));
    expect(preview()).toBe(
      '<span data-font="lora"><span data-font-size="30"><span data-text-color="ruby"><mark data-highlight="aqua"><strong><u><s>The quick brown fox jumps over the lazy dog</s></u></strong></mark></span></span></span>',
    );
    await click(inDialog('Highlight: Aqua'));
    expect([...dialog()!.querySelectorAll('.color-popover button')].at(-1)!.textContent!.trim()).toBe('None');
    await click(dialog()!.querySelector('.color-popover [aria-label="No highlight"]'));
    expect(preview()).not.toContain('data-highlight');
    expect(dialog()!.querySelector('.style-preview [style]')).toBeNull();
    await click(button(dialog()!, 'Save'));
    await waitFor(() => !dialog(), 2000, 'closed');
    const post = requests.find((r) => r.method === 'POST' && r.path === '/api/styles')!;
    expect(post.body).toEqual({ name: '  Callout  ', font: 'lora', size: 30, bold: true, italic: false, underline: true, strike: true, textColor: 'ruby', highlight: null });
    await waitFor(() => cards().length === 1, 2000, 'card');
  });

  it('name_taken shows under Name and styles_full above the buttons, with the dialog still open', async () => {
    styles.u1 = [plain('Taken')];
    await openPage();
    await click(button(view!.container, /New style/));
    await setValue(dialog()!.querySelector('input:not([aria-label])')!, 'taken');
    await click(button(dialog()!, 'Save'));
    await waitFor(() => !!dialog()!.querySelector('.field-error'), 2000, 'name error');
    const nameErr = dialog()!.querySelector('.field-error')!;
    expect(nameErr.textContent).toBe('You already have a style with that name.');
    expect(nameErr.previousElementSibling!.classList.contains('field')).toBe(true); // right under Name
    expect(dialog()!.querySelector('.form-error')).toBeNull();
    // The 51st: above the buttons.
    for (let i = 0; i < 49; i++) styles.u1.push(plain(`S${i}`));
    await setValue(dialog()!.querySelector('input:not([aria-label])')!, 'Fresh');
    await click(button(dialog()!, 'Save'));
    await waitFor(() => !!dialog()!.querySelector('.form-error'), 2000, 'form error');
    expect(dialog()!.querySelector('.form-error')!.textContent).toBe('You can keep at most 50 styles. Delete one to add another.');
    expect(dialog()!.querySelector('.form-error')!.nextElementSibling!.classList.contains('modal-actions')).toBe(true);
    expect(dialog()!.querySelector('.field-error')).toBeNull();
    // Escape closes it, as the other dialogs do.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dialog()).toBeNull();
  });
});

describe('the /styles page (criterion 14)', () => {
  it('cards with exactly the stated chips; a 96 px sample carries 28; the count; button names', async () => {
    styles.u1 = [
      plain('Everything', { font: 'lora', size: 96, bold: true, italic: true, underline: true, strike: true, textColor: 'ruby', highlight: 'topaz' }),
      plain('Nothing'),
    ];
    await openPage();
    expect(view!.container.querySelector('.styles-count')!.textContent).toBe('2 of 50');
    expect(view!.container.querySelector('.styles-count')!.getAttribute('role')).toBe('status');
    expect(view!.container.querySelector('.styles-grid')!.getAttribute('role')).toBe('list');
    expect(cards().map((c) => c.getAttribute('role'))).toEqual(['listitem', 'listitem']);
    const chips = (c: HTMLElement) => [...c.querySelectorAll('.style-chip')].map((x) => x.textContent);
    expect(chips(cards()[0])).toEqual(['Lora', '96 px', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Ruby', 'Topaz highlight']);
    expect(cards()[0].querySelector('.style-chip .chip-dot')!.getAttribute('data-text-color')).toBe('ruby');
    expect(cards()[0].querySelector('.style-chip .chip-swatch')!.getAttribute('data-highlight')).toBe('topaz');
    expect(chips(cards()[1])).toEqual(['Inter', '16 px']);
    expect(cards()[0].querySelector('.style-card-name [data-font-size]')!.getAttribute('data-font-size')).toBe('28');
    expect(cards()[1].querySelector('.style-card-name [data-font-size]')!.getAttribute('data-font-size')).toBe('16');
    expect(button(view!.container, 'Edit Everything')).toBeTruthy();
    expect(button(view!.container, 'Delete Nothing')).toBeTruthy();
    expect(document.title).toBe('Styles – Notes');
  });

  it('New style at 50: focusable, aria-disabled, does nothing, with the text beside it', async () => {
    styles.u1 = Array.from({ length: 50 }, (_, i) => plain(`Style ${String(i).padStart(2, '0')}`));
    await openPage();
    const b = button(view!.container, /New style/)!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await click(b);
    expect(dialog()).toBeNull();
    expect(view!.container.querySelector('.styles-full')!.textContent).toBe('You can keep at most 50 styles. Delete one to add another.');
    expect(view!.container.querySelector('.styles-count')!.textContent).toBe('50 of 50');
  });

  it('the empty state', async () => {
    await openPage();
    const empty = view!.container.querySelector('.styles-empty')!;
    expect(empty.querySelector('h3')!.textContent).toBe('No styles yet');
    expect([...empty.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['A style is a saved set of text formatting you can apply with one click.', 'You can also select text in a note and choose Save selection as style.']);
    expect(button(empty, /New style/)).toBeTruthy();
    expect(view!.container.querySelector('.styles-count')!.textContent).toBe('0 of 50');
  });

  it('delete asks with the stated title and message; edit changes the card; changes survive a remount; another user sees none', async () => {
    styles.u1 = [plain('Quote', { italic: true })];
    await openPage();
    await click(button(view!.container, 'Delete Quote'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    expect(document.querySelector('.modal h2')!.textContent).toBe('Delete “Quote”?');
    expect(document.querySelector('.modal p')!.textContent).toBe('Text you already styled keeps its formatting.');
    await click([...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Cancel'));
    expect(cards().length).toBe(1);
    await click(button(view!.container, 'Edit Quote'));
    await waitFor(() => !!dialog(), 2000, 'form');
    expect((dialog()!.querySelector('input:not([aria-label])') as HTMLInputElement).value).toBe('Quote');
    expect(inDialog('Italic').getAttribute('aria-pressed')).toBe('true');
    await click(inDialog('Bold'));
    await click(button(dialog()!, 'Save'));
    await waitFor(() => !dialog() && [...cards()[0].querySelectorAll('.style-chip')].some((x) => x.textContent === 'Bold'), 2000, 'edited');
    expect(requests.some((r) => r.method === 'PUT' && r.path.startsWith('/api/styles/'))).toBe(true);
    // Remount.
    await view!.unmount();
    view = await render(<App />);
    await waitFor(() => cards().length === 1, 2000, 'after remount');
    expect([...cards()[0].querySelectorAll('.style-chip')].map((x) => x.textContent)).toEqual(['Inter', '16 px', 'Bold', 'Italic']);
    await click(button(view!.container, 'Delete Quote'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    await click([...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Delete'));
    await waitFor(() => cards().length === 0 && !!view!.container.querySelector('.styles-empty'), 2000, 'deleted');
    // Another user.
    styles.u1 = [plain('Private')];
    await view!.unmount();
    user = 'u2';
    setExpectedUser(null);
    sessionStorage.clear();
    await start('/styles');
    await waitFor(() => !!view!.container.querySelector('.styles-empty'), 2000, 'empty for bob');
  });
});

describe('fonts on the page (criterion 3) and names as plain text (criterion 19)', () => {
  it('a retired font and one outside the collection: listed in the form, saved; the sample falls back when its faces fail', async () => {
    const f = fontById('caveat')! as { retired: boolean };
    f.retired = true;
    failFaces = new Set(['caveat']);
    try {
      styles.u1 = [plain('Handwritten', { font: 'caveat' })];
      await openPage();
      expect([...cards()[0].querySelectorAll('.style-chip')][0].textContent).toBe('Caveat');
      await waitFor(() => requests.some((r) => r.path === '/api/fonts/faces/caveat'), 2000, 'faces asked');
      await settle();
      expect(registeredFamilies()).not.toContain('nf-caveat'); // fallback
      expect(cards()[0].querySelector('[data-font="caveat"]')!.textContent).toBe('Handwritten');
      await click(button(view!.container, 'Edit Handwritten'));
      await click(inDialog('Font: Caveat'));
      await waitFor(() => !!dialog()!.querySelector('[data-font-id="caveat"]'), 2000, 'listed though not in the collection');
      expect([...dialog()!.querySelectorAll('.font-popover button')].map((b) => b.textContent)).toEqual(['Inter', 'Lora', 'Caveat', 'Browse fonts…']);
      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(dialog()).toBeTruthy(); // Escape closed the menu, not the form
      await click(inDialog('Increase font size'));
      await click(button(dialog()!, 'Save'));
      await waitFor(() => !dialog(), 2000, 'saved');
      expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ font: 'caveat', size: 17 });
    } finally {
      f.retired = false;
    }
  });

  it('a style named with HTML and CSS metacharacters shows as plain text on the card and in the delete dialog', async () => {
    const name = '<img src=x onerror="alert(1)">{}</style>';
    styles.u1 = [plain(name)];
    await openPage();
    expect(cards()[0].querySelector('.style-card-name')!.textContent).toBe(name);
    expect(cards()[0].querySelector('img')).toBeNull();
    await click(button(view!.container, `Delete ${name}`));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    expect(document.querySelector('.modal h2')!.textContent).toBe(`Delete “${name}”?`);
    expect(document.querySelector('.modal img')).toBeNull();
    expect([...document.querySelectorAll('style')].every((s) => !s.textContent!.includes('onerror'))).toBe(true);
  });
});

describe('/styles routing (criterion 15)', () => {
  it('the sidebar entry and its current mark; the open note saved and closed; anything else leaves', async () => {
    server();
    await start('/');
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'notes');
    await click(view!.container.querySelector('.note-item'));
    await waitFor(() => !!view!.container.querySelector('.ProseMirror'), 3000, 'editor');
    await act(async () => {
      (view!.container.querySelector('.ProseMirror') as any).editor.commands.insertContent(' edited');
    });
    const entry = [...view!.container.querySelectorAll('.view-button')].find((b) => b.textContent?.includes('Styles'))!;
    await click(entry);
    await waitFor(() => !!page(), 3000, 'page');
    expect(location.pathname).toBe('/styles');
    expect(entry.getAttribute('aria-current')).toBe('page');
    expect(view!.container.querySelector('.ProseMirror')).toBeNull(); // closed
    expect(JSON.stringify(noteBody)).toContain('edited'); // saved first
    expect(document.title).toBe('Styles – Notes');
    await click([...view!.container.querySelectorAll('.view-button')].find((b) => b.textContent?.includes('All notes')));
    await waitFor(() => !page(), 2000, 'left');
    expect(location.pathname).toBe('/');
    expect(document.title).toBe('Notes');
  });

  it('"Manage styles…" in the editor saves the note and goes to /styles (criterion 13)', async () => {
    server();
    await start('/');
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'notes');
    await click(view!.container.querySelector('.note-item'));
    await waitFor(() => !!view!.container.querySelector('.ProseMirror'), 3000, 'editor');
    await act(async () => {
      (view!.container.querySelector('.ProseMirror') as any).editor.commands.insertContent(' managed');
    });
    await click(view!.container.querySelector('button[aria-label="Styles"]'));
    await waitFor(() => !!button(view!.container, 'Manage styles…'), 2000, 'menu');
    await click(button(view!.container, 'Manage styles…'));
    await waitFor(() => !!page(), 3000, 'page');
    expect(location.pathname).toBe('/styles');
    expect(JSON.stringify(noteBody)).toContain('managed');
    expect(view!.container.querySelector('.ProseMirror')).toBeNull();
  });

  it('a direct visit (also with the trailing slash) puts / beneath; reload stays; Back leads to the notes', async () => {
    server();
    for (const p of ['/styles', '/styles/']) {
      const len = history.length;
      await start(p);
      await waitFor(() => !!page(), 2000, 'page');
      expect(history.length).toBe(len + 1);
      await view!.unmount();
      view = await render(<App />); // reload
      await waitFor(() => !!page(), 2000, 'after reload');
      expect(history.length).toBe(len + 1);
      await act(async () => {
        history.replaceState({ notes: 1 }, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate', { state: { notes: 1 } }));
      });
      await waitFor(() => !page(), 2000, 'back to notes');
      expect(view!.container.querySelector('.note-list')).toBeTruthy();
      await view!.unmount();
      view = null;
    }
  });

  it('signed out, the sign-in page shows first, then /styles; the phone Back control leads to the notes', async () => {
    server({ signedIn: false });
    await start('/styles');
    await waitFor(() => /Sign in/.test(view!.container.textContent ?? ''), 2000, 'sign-in');
    const inputs = view!.container.querySelectorAll('input');
    await setValue(inputs[0], 'alice');
    await setValue(inputs[1], 'correct horse battery');
    await click(button(view!.container, 'Sign in'));
    await waitFor(() => !!page(), 3000, 'page after sign-in');
    expect(view!.container.querySelector('.app')!.classList.contains('screen-styles')).toBe(true);
    await click(button(view!.container, 'Back to notes'));
    await waitFor(() => !page(), 2000, 'back');
    expect(location.pathname).toBe('/');
  });
});
