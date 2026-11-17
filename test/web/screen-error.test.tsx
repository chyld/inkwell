// @vitest-environment happy-dom
// BUGFIX-LIST item 2 (web side): a lazily loaded screen whose code fails to load shows a message and a Reload that
// writes pending drafts first, instead of blanking the app; App wraps each lazy screen in that boundary.
import fs from 'node:fs';
import path from 'node:path';
import { lazy, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenErrorBoundary } from '../../src/web/components/ScreenError';
import { NoteSaver } from '../../src/web/saver';
import { phone } from '../css';
import { button, click, render, waitFor } from './harness';

let view: Awaited<ReturnType<typeof render>> | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await view?.unmount();
  view = null;
});

describe('a lazy screen that cannot be loaded', () => {
  it('shows a message and a Reload that writes pending drafts, then reloads the same address', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports the caught error
    const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/NoteEditor-old.js')));
    view = await render(
      <div>
        <p>The rest of the app</p>
        <ScreenErrorBoundary label="Editor">
          <Suspense fallback={<p>loading</p>}>
            <Broken />
          </Suspense>
        </ScreenErrorBoundary>
      </div>,
    );
    await waitFor(() => !!view!.container.querySelector('[role="alert"]'), 2000, 'the message');
    expect(view.container.textContent).toContain('The rest of the app'); // not blanked
    expect(view.container.textContent).toContain('could not be loaded');
    const drafts = vi.spyOn(NoteSaver, 'writeAllDrafts');
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    await click(button(view.container, 'Reload'));
    expect(drafts).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // BUGFIX-LIST-2 item 1: at phone width only the screen's own element is shown (`.app > :not(.rail)` is hidden);
  // the error section must be one of the elements a phone rule shows in that screen state.
  it('is shown at phone width on the editor, /fonts and /styles screens', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    view = await render(
      <ScreenErrorBoundary label="Fonts">
        <Suspense fallback={<p>loading</p>}>
          <Broken />
        </Suspense>
      </ScreenErrorBoundary>,
    );
    await waitFor(() => !!view!.container.querySelector('[role="alert"]'), 2000, 'the message');
    const classes = view.container.querySelector('section')!.classList;
    // Each phone rule `.app.screen-<s> > .a.b { display: … }` that is not `none`, as [screen, its classes].
    const shown: [string, string[]][] = [];
    for (const m of phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const display = /(?:^|;)\s*display:\s*([^;]+)/.exec(m[2])?.[1].trim();
      if (!display || display === 'none') continue;
      for (const sel of m[1].split(',')) {
        const s = /^\.app\.screen-(\w+) > ((?:\.[\w-]+)+)$/.exec(sel.trim());
        if (s) shown.push([s[1], s[2].split('.').filter(Boolean)]);
      }
    }
    for (const screen of ['editor', 'fonts', 'styles']) {
      const rule = shown.find(([s, cls]) => s === screen && cls.every((c) => classes.contains(c)));
      expect(rule, `a phone rule showing the error section on the ${screen} screen`).toBeTruthy();
    }
  });

  it('App wraps the editor, /fonts and /styles in the boundary', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/web/App.tsx'), 'utf8');
    for (const label of ['Fonts', 'Styles']) expect(src, label).toContain(`<ScreenErrorBoundary label="${label}">`);
    // One boundary per note (BUGFIX-LIST-2 item 10): a failed note does not stay on screen over the next one.
    expect(src).toContain('<ScreenErrorBoundary key={selected} label="Editor">');
  });
});
