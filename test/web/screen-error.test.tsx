// @vitest-environment happy-dom
// BUGFIX-LIST item 2 (web side): a lazily loaded screen whose code fails to load shows a message and a Reload that
// writes pending drafts first, instead of blanking the app; App wraps each lazy screen in that boundary.
import fs from 'node:fs';
import path from 'node:path';
import { lazy, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenErrorBoundary } from '../../src/web/components/ScreenError';
import { NoteSaver } from '../../src/web/saver';
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

  it('App wraps the editor, /fonts and /styles in the boundary', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/web/App.tsx'), 'utf8');
    for (const label of ['Editor', 'Fonts', 'Styles']) expect(src, label).toContain(`<ScreenErrorBoundary label="${label}">`);
  });
});
