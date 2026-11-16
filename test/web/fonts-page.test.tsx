// @vitest-environment happy-dom
// The /fonts page (FONTS-SPEC 7): search, category and "N of T" (criterion 1), rendered rows and loading
// for a stated viewport (2), the collection (3), routing (21), sign-out removing faces and rules (22).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { FONT_CATALOGUE, fontById } from '../../src/shared/fonts';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { AVAILABLE, matchFonts } from '../../src/web/components/FontsPage';
import { ROW_HEIGHT } from '../../src/web/fonts/grid';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { clearAllFonts, fontRulesText } from '../../src/web/fonts/runtime';
import { button, click, mockFetch, render, requests, settle, waitFor, railButton, signOut } from './harness';
import { HASH, installFontEnv, registeredFamilies } from './fonts-env';

let view: Awaited<ReturnType<typeof render>> | null = null;
let collections: Record<string, string[]>;
let user: 'u1' | 'u2';
let previewCalls: string[];
let previewRelease: Map<string, () => void>;

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  previewCalls = [];
  previewRelease = new Map();
  setPreviewLoader(
    new PreviewLoader({
      fetchPreview: (id) => {
        previewCalls.push(id);
        return new Promise((ok) => previewRelease.set(id, () => ok(HASH(id.length))));
      },
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    }),
  );
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/');
  document.title = 'Notes';
  collections = { u1: [], u2: [] };
  user = 'u1';
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

function server(opts: { signedIn?: boolean; full?: boolean } = {}) {
  let signedIn = opts.signedIn ?? true;
  const NOTE = '99999999-9999-4999-8999-999999999999';
  mockFetch((method, path, b) => {
    if (method === 'POST' && path === '/api/session') {
      signedIn = true;
      return { status: 200, json: { id: user, username: 'alice' } };
    }
    if (!signedIn) return { status: 401, json: { error: { code: 'unauthorized', message: 'Please sign in.' } } };
    if (method === 'DELETE' && path === '/api/session') {
      signedIn = false;
      return { status: 200, json: { ok: true } };
    }
    if (path === '/api/session') return { status: 200, json: { id: user, username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: user, username: user === 'u1' ? 'alice' : 'bob', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [{ id: NOTE, title: 'A note', snippet: '', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } }], nextCursor: null } };
    if (path === `/api/notes/${NOTE}` && method === 'GET')
      return { status: 200, json: { id: NOTE, title: 'A note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'in lora', marks: [{ type: 'fontFamily', attrs: { font: 'lora' } }] }] }] }, version: 1, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT' && path.startsWith('/api/notes/')) return { status: 200, json: { version: 2, updatedAt: '2026-01-02T00:00:00Z' } };
    if (path === '/api/fonts/collection') return { status: 200, json: collections[user] };
    const m = /^\/api\/fonts\/collection\/([a-z0-9-]+)$/.exec(path);
    if (m && method === 'PUT') {
      if (opts.full || collections[user].length >= 50) return { status: 409, json: { error: { code: 'collection_full', message: 'You can keep at most 50 fonts. Remove one to add another.' } } };
      collections[user] = [...collections[user].filter((x) => x !== m[1]), m[1]];
      return { status: 201, json: { id: m[1] } };
    }
    if (m && method === 'DELETE') {
      collections[user] = collections[user].filter((x) => x !== m[1]);
      return { status: 200, json: { ok: true } };
    }
    const faces = /^\/api\/fonts\/faces\/([a-z0-9-]+)$/.exec(path);
    if (faces) return { status: 200, json: { faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(7) }] } };
    return { status: 500, json: { error: { code: 'x', message: `unexpected ${method} ${path}` } } };
  });
}

async function start(path = '/') {
  history.replaceState(null, '', path);
  view = await render(<App />);
}
const page = () => view!.container.querySelector('.fonts-page');
const cards = () => [...view!.container.querySelectorAll('.font-card')] as HTMLElement[];
const count = () => view!.container.querySelector('.fonts-count')?.textContent;
/** A stated viewport for the page's scrolling area and grid (the DOM simulator has no layout). */
async function viewport(width: number, height: number, scrollTop: number) {
  const scroller = view!.container.querySelector('.fonts-scroll') as HTMLElement;
  const grid = view!.container.querySelector('.fonts-grid') as HTMLElement;
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(grid, 'offsetTop', { configurable: true, value: 0 });
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'));
  });
}
async function type(el: Element, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function openFonts() {
  server();
  await start('/fonts');
  await waitFor(() => !!page(), 3000, 'fonts page');
  await viewport(1000, 460, 0);
}

describe('search, category and "N of T" (criterion 1)', () => {
  it('narrow the matching families; T is the non-retired count', async () => {
    expect(matchFonts('', '').length).toBe(AVAILABLE.length);
    expect(matchFonts('LORA', '').every((f) => f.family.toLowerCase().includes('lora'))).toBe(true);
    expect(matchFonts('', 'monospace').every((f) => f.category === 'monospace')).toBe(true);
    await openFonts();
    const T = FONT_CATALOGUE.filter((f) => !f.retired).length;
    expect(count()).toBe(`${T} of ${T}`);
    expect(view!.container.querySelector('.fonts-count')?.getAttribute('aria-live')).toBe('polite');
    expect(view!.container.querySelector('.fonts-count')?.getAttribute('role')).toBe('status');
    await type(view!.container.querySelector('input[aria-label="Search fonts"]')!, 'tItAn');
    const titan = FONT_CATALOGUE.filter((f) => !f.retired && f.family.toLowerCase().includes('titan'));
    expect(count()).toBe(`${titan.length} of ${T}`);
    expect(cards().map((c) => c.textContent?.replace(/(Add|Remove)$/, ''))).toEqual(titan.map((f) => f.family).sort((a, b) => a.localeCompare(b)));
    await type(view!.container.querySelector('select[aria-label="Category"]')!, 'serif');
    const serifTitan = titan.filter((f) => f.category === 'serif');
    expect(count()).toBe(`${serifTitan.length} of ${T}`);
    await type(view!.container.querySelector('input[aria-label="Search fonts"]')!, '');
    expect(count()).toBe(`${FONT_CATALOGUE.filter((f) => !f.retired && f.category === 'serif').length} of ${T}`);
    expect([...view!.container.querySelectorAll('select option')].map((o) => o.textContent)).toEqual(['All', 'Serif', 'Sans serif', 'Display', 'Handwriting', 'Monospace']);
  });

  it('a retired family does not appear in the grid and is not counted', async () => {
    const T = FONT_CATALOGUE.filter((f) => !f.retired).length;
    const f = fontById('titan-one')! as { retired: boolean };
    f.retired = true;
    try {
      expect(matchFonts('titan one', '').map((x) => x.id)).not.toContain('titan-one');
      await openFonts();
      expect(count()).toBe(`${T - 1} of ${T - 1}`);
      await type(view!.container.querySelector('input[aria-label="Search fonts"]')!, 'Titan One');
      expect(cards().some((c) => c.getAttribute('data-font-id') === 'titan-one')).toBe(false);
    } finally {
      f.retired = false;
    }
  });
});

describe('rendered rows and progressive loading for a stated viewport (criterion 2)', () => {
  it('only rows within one viewport of it are rendered, with full list semantics; a rendered card shows its name at once', async () => {
    await openFonts();
    // 1,000 px wide: 4 columns; 460 px high from the top: rows 0..9 (to 920 px).
    const rows = Math.ceil(920 / ROW_HEIGHT);
    expect(cards().length).toBe(rows * 4);
    const grid = view!.container.querySelector('.fonts-grid')!;
    expect(grid.getAttribute('role')).toBe('list');
    expect(cards()[0].getAttribute('role')).toBe('listitem');
    expect(cards()[0].getAttribute('aria-setsize')).toBe(String(AVAILABLE.length));
    expect(cards()[5].getAttribute('aria-posinset')).toBe('6');
    // At once, in the fallback font, never blank.
    expect(cards()[0].querySelector('.font-card-name')!.textContent).toBe(AVAILABLE[0].family);
    expect((cards()[0].querySelector('.font-card-name') as HTMLElement).style.fontFamily).not.toContain('preview-');
    // Only rendered cards load, at most 6 at a time, top to bottom.
    expect(previewCalls).toEqual(AVAILABLE.slice(0, 6).map((f) => f.id));
    // Scrolled to the middle: rows around it, not the top.
    await viewport(1000, 460, 200 * ROW_HEIGHT);
    const posins = cards().map((c) => Number(c.getAttribute('aria-posinset')));
    expect(Math.min(...posins)).toBe(Math.floor((200 * ROW_HEIGHT - 460) / ROW_HEIGHT) * 4 + 1);
    expect(Math.max(...posins)).toBe(Math.ceil((200 * ROW_HEIGHT + 920) / ROW_HEIGHT) * 4);
  });

  it('when a preview is ready the name switches to it; jumping to the end loads no skipped card; a dropped card loads when rendered again', async () => {
    await openFonts();
    const first6 = AVAILABLE.slice(0, 6).map((f) => f.id);
    await act(async () => previewRelease.get(first6[0])!());
    await settle();
    expect((cards()[0].querySelector('.font-card-name') as HTMLElement).style.fontFamily).toContain(`preview-${first6[0]}`);
    // Jump to the end.
    const rowsTotal = Math.ceil(AVAILABLE.length / 4);
    const atJump = previewCalls.length; // six in flight (one started when the first finished)
    await viewport(1000, 460, (rowsTotal - 5) * ROW_HEIGHT);
    for (const id of first6.slice(1)) await act(async () => previewRelease.get(id)!());
    await settle();
    const endIds = new Set(cards().map((c) => c.getAttribute('data-font-id')!));
    const afterJump = previewCalls.slice(atJump);
    expect(afterJump.length).toBeGreaterThan(0);
    expect(afterJump.every((id) => endIds.has(id))).toBe(true); // nothing on the way
    // Back to the top: the cards skipped earlier load now.
    for (const id of afterJump) await act(async () => previewRelease.get(id)?.());
    const skipped = AVAILABLE.slice(8, 40).map((f) => f.id).filter((id) => !previewCalls.includes(id));
    expect(skipped.length).toBeGreaterThan(0);
    await viewport(1000, 460, 0);
    // End cards that were already loading are allowed to finish; then the top's skipped cards start.
    const released = new Set(afterJump);
    for (const [id, release] of [...previewRelease]) if (!released.has(id) && !first6.includes(id)) await act(async () => release());
    await settle();
    expect(previewCalls).toContain(skipped[0]);
  });

  it('a card with keyboard focus stays rendered, and Tab moves through rendered cards', async () => {
    await openFonts();
    const btn = cards()[2].querySelector('button')!;
    await act(async () => btn.focus());
    await viewport(1000, 460, 100 * ROW_HEIGHT);
    expect(cards().some((c) => c.getAttribute('data-font-id') === AVAILABLE[2].id)).toBe(true);
    expect(cards().every((c) => c.querySelector('button')!.tabIndex !== -1)).toBe(true);
  });

  it('one column at 390 px', async () => {
    await openFonts();
    await viewport(366, 700, 0);
    const row = view!.container.querySelector('.fonts-row') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
  });
});

describe('the collection (criterion 3)', () => {
  it('adding puts the font in the collection row (its own font, a Remove button, "N of 50"); it survives a reload; another user does not see it', async () => {
    await openFonts();
    await type(view!.container.querySelector('input[aria-label="Search fonts"]')!, 'Titan One');
    await click(button(view!.container, 'Add Titan One'));
    await waitFor(() => !!view!.container.querySelector('.font-chip'), 2000, 'chip');
    expect(view!.container.querySelector('.font-chip-name')!.textContent).toBe('Titan One');
    expect(button(view!.container, 'Remove Titan One')).toBeTruthy(); // the chip's and the card's
    expect(view!.container.querySelector('.font-card.selected')).toBeTruthy();
    expect(view!.container.querySelector('.fonts-collection-count')!.textContent).toBe('1 of 50');
    // The chip loads through the same queue: once a slot is free.
    for (const [id, release] of [...previewRelease]) if (id !== 'titan-one') await act(async () => release());
    await waitFor(() => previewCalls.includes('titan-one'), 2000, 'chip preview requested');
    expect(requests.some((r) => r.method === 'PUT' && r.path === '/api/fonts/collection/titan-one')).toBe(true);
    // Reload.
    await view!.unmount();
    await start('/fonts');
    await waitFor(() => !!view!.container.querySelector('.font-chip'), 2000, 'chip after reload');
    // Another user.
    await view!.unmount();
    user = 'u2';
    setExpectedUser(null);
    sessionStorage.clear();
    await start('/fonts');
    await waitFor(() => !!page(), 2000, 'page');
    await settle();
    expect(view!.container.querySelector('.font-chip')).toBeNull();
    expect(view!.container.querySelector('.fonts-collection-count')!.textContent).toBe('0 of 50');
  });

  it('removing from a chip; an add error appears as the app notice', async () => {
    collections.u1 = ['lora'];
    server({ full: true });
    await start('/fonts');
    await waitFor(() => !!view!.container.querySelector('.font-chip'), 2000, 'chip');
    await click([...view!.container.querySelectorAll('.font-chip button')][0]);
    await waitFor(() => !view!.container.querySelector('.font-chip'), 2000, 'removed');
    await viewport(1000, 460, 0);
    await click(cards()[0].querySelector('button'));
    await waitFor(() => document.body.textContent!.includes('You can keep at most 50 fonts. Remove one to add another.'), 2000, 'notice');
  });
});

describe('routing (criterion 21)', () => {
  it('the sidebar entry opens the page (marked current, title "Fonts – Notes"); choosing anything else leaves it', async () => {
    server();
    await start('/');
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'notes');
    const fontsEntry = railButton(view!.container, 'Fonts');
    await click(fontsEntry);
    await waitFor(() => !!page(), 2000, 'page');
    expect(location.pathname).toBe('/fonts');
    expect(document.title).toBe('Fonts – Notes');
    expect(fontsEntry.getAttribute('aria-current')).toBe('page');
    expect(view!.container.querySelector('.note-list')).toBeNull();
    const all = railButton(view!.container, 'All notes');
    expect(all.getAttribute('aria-current')).toBeNull();
    await click(all);
    await waitFor(() => !page(), 2000, 'left');
    expect(location.pathname).toBe('/');
    expect(document.title).toBe('Notes');
    expect(view!.container.querySelector('.note-list')).toBeTruthy();
  });

  it('a direct visit puts / beneath it; reload keeps it; Back leads to the notes', async () => {
    server();
    const len = history.length;
    await start('/fonts');
    await waitFor(() => !!page(), 2000, 'page');
    expect(history.length).toBe(len + 1);
    expect(view!.container.querySelector('.app')!.classList.contains('screen-fonts')).toBe(true);
    await view!.unmount();
    view = await render(<App />); // a reload keeps the address and the history state
    await waitFor(() => !!page(), 2000, 'page after reload');
    expect(history.length).toBe(len + 1);
    await act(async () => {
      history.replaceState({ notes: 1 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { notes: 1 } }));
    });
    await waitFor(() => !page(), 2000, 'back to notes');
    expect(view!.container.querySelector('.note-list')).toBeTruthy();
  });

  it('signed out, the sign-in page shows and /fonts opens after sign-in', async () => {
    server({ signedIn: false });
    await start('/fonts');
    await waitFor(() => /Sign in/.test(view!.container.textContent ?? ''), 2000, 'sign-in');
    const inputs = view!.container.querySelectorAll('input');
    await type(inputs[0], 'alice');
    await type(inputs[1], 'correct horse battery');
    await click(button(view!.container, 'Sign in'));
    await waitFor(() => !!page(), 3000, 'page after sign-in');
    expect(location.pathname).toBe('/fonts');
  });

  it('on a phone the page has a Back control; "Browse fonts…" saves the note first and opens the page', async () => {
    server();
    await start('/fonts');
    await waitFor(() => !!page(), 2000, 'page');
    await click(button(view!.container, 'Back to notes'));
    await waitFor(() => !page(), 2000, 'back');
    expect(location.pathname).toBe('/');
    expect(view!.container.querySelector('.app')!.classList.contains('screen-list')).toBe(true);
    // From the editor's font menu.
    await click(view!.container.querySelector('.note-item'));
    await waitFor(() => !!view!.container.querySelector('.ProseMirror'), 3000, 'editor');
    await act(async () => {
      (view!.container.querySelector('.ProseMirror') as any).editor.commands.insertContent(' edited');
    });
    await click(view!.container.querySelector('.toolbar .font-button'));
    await waitFor(() => !!button(view!.container, 'Browse fonts…'), 2000, 'menu');
    await click(button(view!.container, 'Browse fonts…'));
    await waitFor(() => !!page(), 4000, 'page from the menu');
    expect(location.pathname).toBe('/fonts');
    const put = requests.findIndex((r) => r.method === 'PUT' && r.path.startsWith('/api/notes/'));
    expect(put).toBeGreaterThanOrEqual(0); // the note was saved first
    expect(JSON.stringify(requests[put].body)).toContain('edited');
  });
});

describe('sign-out (criterion 22)', () => {
  it('removes every registered face and rule, previews included', async () => {
    server();
    collections.u1 = ['titan-one'];
    await start('/');
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'notes');
    await click(view!.container.querySelector('.note-item'));
    await waitFor(() => registeredFamilies().includes('nf-lora'), 3000, 'note font');
    await click(view!.container.querySelector('.toolbar .font-button'));
    await waitFor(() => previewCalls.includes('titan-one'), 2000, 'menu preview requested');
    await act(async () => previewRelease.get('titan-one')!());
    await waitFor(() => registeredFamilies().includes('preview-titan-one'), 2000, 'preview registered');
    expect(fontRulesText()).toContain('[data-font="lora"]');
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await signOut(view!.container);
    await waitFor(() => /Sign in/.test(view!.container.textContent ?? ''), 3000, 'signed out');
    expect(registeredFamilies()).toEqual([]);
    expect(fontRulesText()).toBe('');
  });
});
