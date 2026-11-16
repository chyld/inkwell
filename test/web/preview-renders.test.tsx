// @vitest-environment happy-dom
// CLEANUP-PLAN pass 1 item 5: a completed preview re-renders only the components that show that font; an inactive
// one (a closed menu) does not re-render at all; two menus on screen together keep their own lists.
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { PreviewLoader, setPreviewLoader, usePreviews } from '../../src/web/fonts/previews';
import { clearAllFonts } from '../../src/web/fonts/runtime';
import { render } from './harness';
import { HASH, installFontEnv } from './fonts-env';

const [a, b, c] = FONT_CATALOGUE.slice(0, 3).map((f) => f.id);
let pending: Map<string, (hash: string) => void>;
let loader: PreviewLoader;
const renders: Record<string, number> = {};

function Probe({ name, ids, active = true }: { name: string; ids: string[]; active?: boolean }) {
  usePreviews(name, ids, active);
  renders[name] = (renders[name] ?? 0) + 1;
  return null;
}
const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  pending = new Map();
  loader = new PreviewLoader({ fetchPreview: (id) => new Promise((ok) => pending.set(id, ok)), now: () => 0, setTimeout: () => 0 });
  setPreviewLoader(loader);
  for (const k of Object.keys(renders)) delete renders[k];
});

describe('preview completions', () => {
  it('re-render only the components showing that font; an inactive one never', async () => {
    const view = await render(
      <>
        <Probe name="grid" ids={[a, b]} />
        <Probe name="chips" ids={[c]} />
        <Probe name="closed-menu" ids={[a, b, c]} active={false} />
      </>,
    );
    await settle();
    expect(loader.started.sort()).toEqual([a, b, c].sort()); // the closed menu asked for nothing of its own
    const before = { ...renders };
    await act(async () => pending.get(c)!(HASH(3)));
    await settle();
    expect(renders.chips - before.chips).toBe(1); // it shows c
    expect(renders.grid - before.grid).toBe(0); // before: every completion re-rendered every subscriber
    expect(renders['closed-menu'] - before['closed-menu']).toBe(0); // before: even a closed menu re-rendered
    await act(async () => pending.get(a)!(HASH(1)));
    await settle();
    expect(renders.grid - before.grid).toBe(1);
    expect(renders.chips - before.chips).toBe(1);
    expect(renders['closed-menu'] - before['closed-menu']).toBe(0);
    await view.unmount();
  });
});
