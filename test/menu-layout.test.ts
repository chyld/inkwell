// Menus that grow (the Styles menu, the font menus): rows keep their natural height, only the list scrolls,
// the footer stays below it, and the menu fits the viewport. What a stylesheet and a pure function can show;
// the measured layout (row heights, overlap, the menu inside the viewport) is checked in a real browser.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_MAX_HEIGHT, MENU_MIN_HEIGHT, fixedPosition, menuPlacement, placementStyle } from '../src/web/components/menuPlacement';

const css = fs.readFileSync(path.join(__dirname, '../src/web/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every declaration given to exactly this selector, in source order (later wins). */
function decls(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').some((x) => x.trim() === sel)) continue;
    for (const d of m[2].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

describe('menu rows never shrink (the crushed Styles menu)', () => {
  it('the menu itself does not scroll; it is a column whose list scrolls and whose footer stays', () => {
    const pop = decls('.font-popover');
    expect(pop.display).toBe('flex');
    expect(pop['flex-direction']).toBe('column');
    expect(pop.overflow).toBe('hidden');
    expect(pop['overflow-y']).toBeUndefined();
  });

  it('only the list may shrink, and it scrolls instead of squeezing its rows (rows are block flow inside it)', () => {
    const list = decls('.menu-scroll');
    expect(list.display).toBe('block');
    expect(list['min-height']).toBe('0');
    expect(list['overflow-y']).toBe('auto');
  });

  it('a row cannot shrink below its content, even if placed in a flex column', () => {
    const row = decls('.font-item');
    expect(row.flex).toBe('none');
    expect(row['white-space']).toBe('nowrap'); // a long name is one line, ending in an ellipsis
    expect(row['text-overflow']).toBe('ellipsis');
    expect(row.height).toBeUndefined();
    expect(row['max-height']).toBeUndefined();
  });

  it('the footer (separator and its entries) cannot shrink', () => {
    const foot = decls('.menu-footer');
    expect(foot.flex).toBe('none');
    expect(foot['border-top']).toMatch(/1px solid/);
  });

  it('no rule anywhere lets a menu row or the footer shrink or fixes their height', () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.(font-item|style-item|font-browse|menu-footer)\b/.test(m[1])) continue;
      expect(m[2], m[1].trim()).not.toMatch(/flex-shrink:\s*[1-9]|(^|[;\s])flex:\s*1|(^|[;\s])height:|max-height:/);
    }
  });
});

describe('the Styles button (DEVIATIONS 43)', () => {
  it('has a fixed width like the font button, so the toolbar does not jump; its name is one line, cut with an ellipsis', () => {
    expect(decls('.styles-button').width).toMatch(/^\d+px$/);
    expect(decls('.font-button').width).toMatch(/^\d+px$/);
    const lab = decls('.font-button-label'); // the label class both buttons use
    expect(lab['white-space']).toBe('nowrap');
    expect(lab['text-overflow']).toBe('ellipsis');
    expect(lab.overflow).toBe('hidden');
    expect(lab['min-width']).toBe('0');
  });
});

describe('menuPlacement', () => {
  const vp = { width: 1280, height: 800 };
  it('opens below with the room left, capped at the maximum', () => {
    expect(menuPlacement({ top: 60, bottom: 84, left: 600 }, 260, vp)).toEqual({ maxHeight: MENU_MAX_HEIGHT, above: false, shift: 0 });
    expect(menuPlacement({ top: 60, bottom: 84, left: 600 }, 260, { width: 1280, height: 500 })).toEqual({ maxHeight: 500 - 84 - 4 - 8, above: false, shift: 0 });
  });
  it('opens above when there is less than the minimum below and more room above', () => {
    const p = menuPlacement({ top: 400, bottom: 424, left: 10 }, 260, { width: 1280, height: 500 });
    expect(p.above).toBe(true);
    expect(p.maxHeight).toBe(400 - 4 - 8);
    // ...but stays below if above is no better.
    expect(menuPlacement({ top: 100, bottom: 400, left: 10 }, 260, { width: 1280, height: 500 }).above).toBe(false);
  });
  it('never taller than the room on the chosen side, so it stays inside the viewport', () => {
    for (let h = 200; h <= 1000; h += 50)
      for (let top = 0; top < h - 24; top += 37) {
        const b = { top, bottom: top + 24, left: 10 };
        const p = menuPlacement(b, 260, { width: 390, height: h });
        if (p.above) expect(b.top - 4 - p.maxHeight).toBeGreaterThanOrEqual(8);
        else expect(b.bottom + 4 + p.maxHeight).toBeLessThanOrEqual(h - 8);
        expect(p.maxHeight).toBeLessThanOrEqual(MENU_MAX_HEIGHT);
        if (Math.max(h - b.bottom, b.top) - 12 >= MENU_MIN_HEIGHT) expect(p.maxHeight).toBeGreaterThanOrEqual(MENU_MIN_HEIGHT);
      }
  });
  it('shifts left to stay inside a narrow viewport, never past its left edge', () => {
    expect(menuPlacement({ top: 0, bottom: 24, left: 200 }, 260, { width: 390, height: 700 }).shift).toBe(-(200 + 260 - 382));
    expect(menuPlacement({ top: 0, bottom: 24, left: 20 }, 500, { width: 390, height: 700 }).shift).toBe(-12);
    expect(placementStyle(menuPlacement({ top: 0, bottom: 24, left: 8 }, 100, { width: 390, height: 700 }))).toEqual({ maxHeight: MENU_MAX_HEIGHT });
  });
});

describe('the phone toolbar (CLEANUP-PLAN pass 2 item 6)', () => {
  /** The declarations for this selector inside the phone media block only. */
  const phone = (sel: string) => {
    const at = css.indexOf('@media (max-width: 760px)');
    const block = css.slice(at, css.indexOf('\n}\n', at));
    const out: Record<string, string> = {};
    for (const m of block.slice(block.indexOf('{') + 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').some((x) => x.trim() === sel)) continue;
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':');
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
    }
    return out;
  };

  it('is one row that scrolls sideways inside itself (the table tools too); its buttons never shrink', () => {
    for (const bar of ['.toolbar-wrap > .toolbar', '.toolbar-wrap > .table-tools']) {
      const d = phone(bar);
      expect(d['flex-wrap'], bar).toBe('nowrap');
      expect(d['overflow-x'], bar).toBe('auto');
      expect(d['overflow-y'], bar).toBe('hidden');
      expect(d['overscroll-behavior-x'], bar).toBe('contain');
      expect(phone(`${bar} > *`).flex, bar).toBe('none');
    }
    expect(decls('.toolbar')['flex-wrap']).toBe('wrap'); // wider screens still wrap by section
  });

  it('shows a hint at the edge with more: two bar-coloured covers scroll with the buttons over two fixed glows', () => {
    const bg = phone('.toolbar-wrap > .toolbar').background.replace(/\s+/g, ' ');
    const layers: string[] = [];
    let depth = 0, cur = '';
    for (const ch of bg) {
      if (ch === ',' && depth === 0) {
        layers.push(cur.trim());
        cur = '';
        continue;
      }
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      cur += ch;
    }
    layers.push(cur.trim());
    expect(layers).toHaveLength(5);
    expect(layers.slice(0, 2).every((l) => l.startsWith('linear-gradient(to ') && l.includes('var(--rail)') && l.endsWith(' local'))).toBe(true);
    expect(layers.slice(2, 4).every((l) => l.includes('var(--bar-hint)') && l.endsWith(' scroll'))).toBe(true);
    expect(layers[4]).toBe('var(--rail)');
  });

  it('menus are fixed at coordinates from their button, so the scrolling bar cannot clip them', () => {
    expect(decls('.font-popover').position).toBe('fixed');
    expect(decls('.color-popover').position).toBe('fixed');
    expect(decls('.font-popover').width).toBe('min-content'); // as wide as when it hung from its button
    const below = menuPlacement({ top: 100, bottom: 134, left: 200 }, 220, { width: 390, height: 780 });
    expect(below.shift).toBe(-(200 + 220 - 382)); // kept inside the screen
    expect(fixedPosition({ top: 100, bottom: 134, left: 200 }, below, 780)).toEqual({ left: 200 + below.shift, top: 138 });
    const above = menuPlacement({ top: 700, bottom: 734, left: 20 }, 220, { width: 390, height: 780 });
    expect(above.above).toBe(true);
    expect(fixedPosition({ top: 700, bottom: 734, left: 20 }, above, 780)).toEqual({ left: 20, bottom: 780 - 700 + 4 });
    expect(placementStyle({ ...below, fixed: { left: 138, top: 138 } })).toEqual({ maxHeight: below.maxHeight, left: 138, top: 138, bottom: 'auto' });
    expect(placementStyle({ ...above, fixed: { left: 20, bottom: 84 } })).toEqual({ maxHeight: above.maxHeight, left: 20, top: 'auto', bottom: 84 });
  });
});
