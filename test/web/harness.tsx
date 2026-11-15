// Renders real web components in happy-dom with a scripted fetch.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export type Handler = (method: string, path: string, body: any) => { status: number; json?: unknown } | Promise<{ status: number; json?: unknown }> | 'network-error';

export const requests: { method: string; path: string; body: any }[] = [];

export function mockFetch(handler: Handler) {
  requests.length = 0;
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    requests.push({ method, path, body });
    const r = await handler(method, path, body);
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as any;
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
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
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
