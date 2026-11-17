// Renders real web components in happy-dom with a scripted fetch.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { setExpectedUser } from '../../src/web/api';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export type Handler = (method: string, path: string, body: any, headers: Record<string, string>) => { status: number; json?: unknown } | Promise<{ status: number; json?: unknown }> | 'network-error';

export const requests: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];

export function mockFetch(handler: Handler) {
  requests.length = 0;
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    requests.push({ method, path, body, headers });
    const r = await handler(method, path, body, headers);
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as any;
}

type Value<T> = T | (() => T);
const valueOf = <T,>(v: Value<T>): T => (typeof v === 'function' ? (v as () => T)() : v);

export interface SignedIn {
  /** The signed-in user (GET /api/session); default alice, u1. */
  user?: Value<{ id: string; username: string }>;
  /** False: GET /api/session answers 401 (signed out). */
  signedIn?: Value<boolean>;
  /** Fields of GET /api/me over the user's defaults (storage 0 of 1, inbox 'inbox'). */
  me?: Value<Record<string, unknown>>;
  folders?: Value<unknown[]>;
  tags?: Value<unknown[]>;
}

/**
 * The backend of a signed-in app: GET /api/session, /api/me, /api/folders and /api/tags answered from `opts`;
 * every other request goes to the test's own handler (which keeps its own answer for anything unexpected). While
 * signed out, GET /api/session answers 401 and everything else goes to the test's handler.
 */
export function signedInBackend(own: Handler, opts: SignedIn = {}): Handler {
  return (method, path, body, headers) => {
    const signedOut = opts.signedIn !== undefined && !valueOf(opts.signedIn);
    if (signedOut && method === 'GET' && path === '/api/session') return { status: 401, json: { error: { code: 'unauthorized', message: 'Sign in.' } } };
    if (method === 'GET' && !signedOut) {
      const user = valueOf(opts.user ?? { id: 'u1', username: 'alice' });
      if (path === '/api/session') return { status: 200, json: user };
      if (path === '/api/me') return { status: 200, json: { ...user, storageUsed: 0, storageLimit: 1, inboxId: 'inbox', ...valueOf(opts.me ?? {}) } };
      if (path === '/api/folders') return { status: 200, json: { folders: valueOf(opts.folders ?? []) } };
      if (path === '/api/tags') return { status: 200, json: { tags: valueOf(opts.tags ?? []) } };
    }
    return own(method, path, body, headers);
  };
}

/** What every app test resets after itself: the page, the tab's user and its session storage. */
export async function resetPage(view: { unmount: () => Promise<void> } | null) {
  await view?.unmount();
  document.body.innerHTML = '';
  sessionStorage.clear();
  setExpectedUser(null);
}

export async function render(el: ReactElement): Promise<{ root: Root; container: HTMLElement; unmount: () => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(el));
  return {
    root,
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function waitFor(cond: () => boolean, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; requests: ${requests.map((r) => r.method + ' ' + r.path + ' [' + (r.headers['x-notes-user'] ?? '-') + ']').join(', ')}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

export async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export function button(container: ParentNode, text: string | RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text || b.getAttribute('aria-label') === text : text.test(b.textContent ?? ''),
  ) as HTMLButtonElement | undefined;
}

/** The Tiptap editor behind the first .ProseMirror element. */
export function editorOf(container: ParentNode): any {
  const el = container.querySelector('.ProseMirror') as any;
  return el?.editor;
}

export const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

/** A button on the rail, by its accessible name (REDESIGN-BRIEF 2.1: the rail replaced the sidebar). */
export function railButton(container: ParentNode, label: string): HTMLButtonElement {
  return container.querySelector(`#rail .rail-button[aria-label="${label}"]`) as HTMLButtonElement;
}

/** Sign out: it lives in the rail's account menu. */
export async function signOut(container: ParentNode) {
  await click(railButton(container, 'Account'));
  await click(button(document, 'Sign out'));
}
