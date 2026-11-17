// @vitest-environment happy-dom
// CLEANUP-PLAN pass 1 item 3: typing does not re-render the editor screen, serialise the document, scan it for
// fonts or write the draft on every keystroke; a tab hidden or closed mid-typing still leaves its latest draft.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, Profiler } from 'react';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { FontSession, clearAllFonts, setFaceLoader } from '../../src/web/fonts/runtime';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { resetStyles } from '../../src/web/stylesStore';
import { localDrafts } from '../../src/web/drafts';
import { editorOf, mockFetch, render, requests, waitFor } from './harness';
import { HASH, installFontEnv } from './fonts-env';

const NOTE_ID = '99999999-1111-4111-8111-999999999999';
const props = { noteId: NOTE_ID, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onRemoved: vi.fn(), onTagsChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn(), onManageStyles: vi.fn() };
const KEYS = 20;

let view: Awaited<ReturnType<typeof render>> | null = null;
let commits = 0;
beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setFaceLoader(null);
  setPreviewLoader(new PreviewLoader({ fetchPreview: async () => HASH(9), now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }));
  localStorage.clear();
  resetStyles();
  commits = 0;
  let version = 1;
  mockFetch((method, path) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`)
      return { status: 200, json: { id: NOTE_ID, title: 'Typing', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'start' }] }] }, version: 1, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT') return { status: 200, json: { version: ++version, updatedAt: '2026-01-02T00:00:00Z' } };
    if (path === '/api/styles') return { status: 200, json: [] };
    if (path === '/api/fonts/collection') return { status: 200, json: [] };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open() {
  view = await render(
    <DialogProvider>
      <Profiler id="pane" onRender={() => void commits++}>
        <NoteEditorPane {...(props as any)} />
      </Profiler>
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
  await act(async () => void editorOf(view!.container).commands.focus('end'));
}
const draftKey = () => Object.keys(localStorage).find((k) => k.includes(NOTE_ID));
const draftText = () => {
  const k = draftKey();
  return k ? JSON.stringify(JSON.parse(localStorage.getItem(k)!).body) : null;
};

/** Type KEYS characters, one transaction each, as keystrokes are; return what they cost. */
async function type() {
  const ed = editorOf(view!.container);
  const getJSON = vi.spyOn(ed, 'getJSON');
  const setDraft = vi.spyOn(localDrafts, 'set');
  const scans = vi.spyOn(FontSession.prototype, 'want');
  commits = 0;
  for (let i = 0; i < KEYS; i++) await act(async () => void ed.commands.insertContent(String.fromCharCode(97 + i)));
  const out = { commits, getJSON: getJSON.mock.calls.length, draftWrites: setDraft.mock.calls.length, fontScans: scans.mock.calls.length };
  if (process.env.TYPING_REPORT === '1') console.log(`TYPING ${KEYS} keystrokes:`, JSON.stringify(out));
  return out;
}

describe('typing (before: per keystroke, a pane render, a full serialisation, a draft write and a font scan)', () => {
  it('20 keystrokes: no re-render per keystroke; serialised once and the draft written once until the save', async () => {
    await open();
    const m = await type();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0); // still within the 1 s debounce
    expect(m.commits).toBeLessThanOrEqual(3); // the first keystroke changes Undo and the save status; then nothing
    expect(m.getJSON).toBeLessThanOrEqual(1); // the first change's draft
    expect(m.draftWrites).toBeLessThanOrEqual(1);
    expect(m.fontScans).toBe(0); // debounced
    await waitFor(() => requests.some((r) => r.method === 'PUT'), 3000, 'the save');
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(JSON.stringify(put.body.body)).toContain('startabcdefghijklmnopqrst'); // everything typed is sent
  });

  it('a tab closed mid-typing (pagehide) leaves a draft with everything typed', async () => {
    await open();
    await type();
    expect(draftText()).not.toBeNull(); // a draft exists from the first keystroke…
    expect(draftText()).not.toContain('abcdefghijklmnopqrst'); // …holding the first change only, so far
    window.dispatchEvent(new Event('pagehide'));
    expect(draftText()).toContain('startabcdefghijklmnopqrst');
  });

  it('a tab hidden mid-typing (visibilitychange) leaves a draft with everything typed', async () => {
    await open();
    await type();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as any).visibilityState;
    }
    expect(draftText()).toContain('startabcdefghijklmnopqrst');
  });

  it('the toolbar still follows a formatting change made while typing', async () => {
    await open();
    const bold = () => view!.container.querySelector('.toolbar button[aria-label="Bold"]')!.getAttribute('aria-pressed');
    expect(bold()).toBe('false');
    await act(async () => void editorOf(view!.container).commands.toggleBold());
    expect(bold()).toBe('true');
    await act(async () => void editorOf(view!.container).commands.insertContent('x'));
    expect(bold()).toBe('true');
  });
});
