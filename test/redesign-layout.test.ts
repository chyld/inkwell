// The redesign's layout rules that a DOM simulator cannot apply (REDESIGN-BRIEF 3 and 4): panels over the list; at
// phone width the rail as a bottom bar, its panels as sheets, the title row wrapping; touch targets.
// The measured layout (no sideways scroll, sizes in a real browser) is checked in the headless browser check.
import { describe, expect, it } from 'vitest';
import { coarse, decls, phone } from './css';

describe('other screens (REDESIGN-BRIEF 3)', () => {
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

  it('the title row wraps its right-hand part to a second line', () => {
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
