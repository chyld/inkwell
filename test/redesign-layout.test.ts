// The redesign's layout rules that a DOM simulator cannot apply (REDESIGN-BRIEF 3 and 4): /fonts and /styles on the
// app ground with paper cards; sign-in and dialogs on the palette; at phone width the rail as a bottom bar, its
// panels as sheets, the editor's paper full width with smaller padding, the slim line wrapping; touch targets.
// The measured layout (no sideways scroll, sizes in a real browser) is checked in the headless browser check.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(__dirname, '../src/web/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The text inside one at-rule block, by its exact prelude. */
function atBlock(prelude: string): string {
  const start = css.indexOf(prelude + ' {');
  expect(start, prelude).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error('unclosed ' + prelude);
}
/** Declarations given to exactly this selector in a stylesheet text (later wins). */
function decls(sel: string, text?: string): Record<string, string> {
  text ??= wide;
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').some((x) => x.trim() === sel)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}
const phone = atBlock('@media (max-width: 760px)');
/** The stylesheet without its @media blocks: what applies on a wide screen with a mouse. */
const wide = (() => {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 0;
    let j = css.indexOf('{', at);
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
})();
const coarse = atBlock('@media (pointer: coarse)');

describe('other screens (REDESIGN-BRIEF 3)', () => {
  it('/fonts and /styles sit on the app ground with their cards on paper, rounded like the note cards', () => {
    for (const page of ['.fonts-page', '.styles-page']) expect(decls(page).background, page).toBe('var(--bg-soft)');
    for (const card of ['.font-card', '.style-card']) {
      expect(decls(card).background, card).toBe('var(--bg)');
      expect(decls(card)['border-radius'], card).toBe('12px');
    }
  });

  it('sign-in on the ground with a paper card; dialogs and menus on paper', () => {
    expect(decls('.signin').background).toBe('var(--bg-soft)');
    expect(decls('.signin-card').background).toBe('var(--bg)');
    expect(decls('.modal').background).toBe('var(--bg)');
    expect(decls('.font-popover').background).toBe('var(--bg)');
    expect(decls('.rail-panel').background).toBe('var(--bg)');
    expect(decls('.account-menu').background).toBe('var(--bg)');
  });

  it('a panel sits over the list beside the rail and does not push the layout', () => {
    expect(decls('.rail-panel').position).toBe('absolute');
    expect(decls('.rail-panel').left).toBe('100%');
    expect(decls('.app')['grid-template-columns']).toBe('var(--rail-width) var(--list-width) 1fr');
    expect(decls('.app')['--rail-width']).toBe('54px');
  });
});

describe('phone width (REDESIGN-BRIEF 4)', () => {
  it('the rail is a bar along the bottom with the same buttons; the screens sit above it', () => {
    const bar = decls('.app > .rail', phone);
    expect(bar.position).toBe('fixed');
    expect(bar.bottom).toBe('0');
    expect(bar['flex-direction']).toBe('row');
    expect(decls('.rail-group', phone)['flex-direction']).toBe('row');
    expect(decls('.app > *', phone).height).toBe('calc(100% - var(--bar-height))');
  });

  it('the Folders and Tags panels open as sheets from the bottom; the account menu above the bar', () => {
    const sheet = decls('.rail-panel', phone);
    expect(sheet.position).toBe('fixed');
    expect(sheet.bottom).toBe('var(--bar-height)');
    expect(sheet.left).toBe('0');
    expect(sheet.right).toBe('0');
    expect(sheet['border-radius']).toBe('16px 16px 0 0');
    expect(decls('.account-menu', phone).position).toBe('fixed');
  });

  it('the paper fills the width with smaller padding; the title row wraps its right-hand part to a second line', () => {
    expect(decls('.editor-scroll.paper', phone).padding).toBe('14px 16px 60px');
    expect(decls('.editor-header', phone).padding).toBe('0 10px');
    expect(decls('.editor-row', phone)['flex-wrap']).toBe('wrap');
    expect(decls('.slim-left', phone).flex).toBe('1 1 100%');
  });

  it('touch targets are at least 34 px: toolbar, slim line, list title and rail', () => {
    const t = decls('.toolbar .tb', coarse);
    expect(t['min-width']).toBe('34px');
    expect(t['min-height']).toBe('34px');
    expect(coarse).toMatch(/\.editor-header button,\s*\.list-title button\s*\{/);
    expect(decls('.rail-button', phone).width).toBe('40px');
    expect(decls('.rail-button', phone).height).toBe('40px');
  });
});
