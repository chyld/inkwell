// Colour scheme 'Plum': every colour comes from the :root tokens (light and dark), the tokens
// are the agreed values, and the pairs the UI uses meet WCAG AA contrast in both themes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../../src/shared/schema';

const css = readFileSync(new URL('../../src/web/styles.css', import.meta.url), 'utf8');
const favicon = readFileSync(new URL('../../src/web/public/favicon.svg', import.meta.url), 'utf8');

// The light tokens are the first `:root { … }`; the dark ones the `:root` inside the dark media query.
const lightBlock = /^:root \{([\s\S]*?)\n\}/m.exec(css)![1];
const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/.exec(css)![1];
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

const PLUM = {
  light: { bg: '#ffffff', 'bg-soft': '#f9f6fa', 'bg-sidebar': '#f4f0f6', 'bg-hover': '#ebe4ee', 'bg-active': '#ecdcf3', border: '#e3dbe7', text: '#231a27', 'text-soft': '#6a5c70', accent: '#8a3aa8', 'accent-text': '#ffffff', 'code-bg': '#f1ebf3' },
  dark: { bg: '#1a151c', 'bg-soft': '#211a24', 'bg-sidebar': '#1e1820', 'bg-hover': '#302634', 'bg-active': '#46275a', border: '#382d3c', text: '#ece5ee', 'text-soft': '#a898ad', accent: '#cf8cea', 'accent-text': '#260f30', 'code-bg': '#2a2130' },
};

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('Plum colour scheme', () => {
  it('sets the agreed token values in both themes', () => {
    for (const [k, v] of Object.entries(PLUM.light)) expect(light[k], `light --${k}`).toBe(v);
    for (const [k, v] of Object.entries(PLUM.dark)) expect(dark[k], `dark --${k}`).toBe(v);
  });

  it('meets WCAG AA for text, soft text, accent text, links and selected states', () => {
    const pairs: [string, string, number][] = [
      ['text', 'bg', 4.5], ['text', 'bg-soft', 4.5], ['text', 'bg-sidebar', 4.5], ['text', 'bg-hover', 4.5], ['text', 'bg-active', 4.5], ['text', 'code-bg', 4.5],
      ['text-soft', 'bg', 4.5], ['text-soft', 'bg-soft', 4.5], ['text-soft', 'bg-sidebar', 4.5], ['text-soft', 'bg-hover', 4.5], ['text-soft', 'bg-active', 4.5],
      ['accent-text', 'accent', 4.5], ['accent', 'bg', 4.5], ['accent', 'bg-soft', 4.5], ['accent', 'bg-sidebar', 4.5], ['accent', 'bg-active', 3],
      ['danger', 'bg', 4.5], ['danger', 'bg-soft', 4.5], ['danger', 'bg-sidebar', 4.5], ['warn-text', 'warn-bg', 4.5], ['text', 'mark', 4.5], ['bg', 'text', 4.5],
    ];
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const [fg, bg, min] of pairs) expect(contrast(t[fg], t[bg]), `${theme}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('has no colour outside the :root token blocks', () => {
    const rest = css.replace(lightBlock, '').replace(darkBlock, '');
    expect(rest.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
    // Form controls and selected text follow the scheme too, rather than the browser's default blue.
    expect(css).toMatch(/accent-color: var\(--accent\)/);
    expect(css).toMatch(/::selection \{\s*background: var\(--selection\);\s*color: var\(--text\);/);
  });

  it('the favicon uses the plum accent', () => {
    expect(favicon).toContain(PLUM.light.accent);
    expect(favicon).not.toMatch(/#3b6fd8/i);
  });
});

describe("text colours and highlights, palette 'Jewel'", () => {
  it('every name has a light and a dark token and a stylesheet rule that uses it', () => {
    for (const n of TEXT_COLORS) {
      expect(lightBlock, `light --tc-${n}`).toMatch(new RegExp(`--tc-${n}: #[0-9a-f]{6};`));
      expect(darkBlock, `dark --tc-${n}`).toMatch(new RegExp(`--tc-${n}: #[0-9a-f]{6};`));
      expect(css).toContain(`[data-text-color='${n}'] {\n  color: var(--tc-${n});`);
    }
    for (const n of HIGHLIGHT_COLORS) {
      expect(lightBlock, `light --hl-${n}`).toMatch(new RegExp(`--hl-${n}: #[0-9a-f]{6};`));
      expect(darkBlock, `dark --hl-${n}`).toMatch(new RegExp(`--hl-${n}: #[0-9a-f]{6};`));
      expect(css).toContain(`[data-highlight='${n}'] {\n  background: var(--hl-${n});`);
    }
  });

  it('meets WCAG AA: each text colour on --bg, --bg-soft and every highlight; --text and links on every highlight', () => {
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const c of TEXT_COLORS) {
        for (const bg of ['bg', 'bg-soft', ...HIGHLIGHT_COLORS.map((h) => `hl-${h}`)]) {
          expect(contrast(t[`tc-${c}`], t[bg]), `${theme}: ${c} on --${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const h of HIGHLIGHT_COLORS) {
        expect(contrast(t.text, t[`hl-${h}`]), `${theme}: --text on ${h}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.accent, t[`hl-${h}`]), `${theme}: link on ${h}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});


describe("the editor toolbar: 'Quiet line' on a 'Sage' bar (DEVIATIONS 45)", () => {
  const SAGE = {
    light: { 'toolbar-bg': '#e3f0e0', 'toolbar-strong': '#c8dfc3', 'toolbar-icon': '#405e40' },
    dark: { 'toolbar-bg': '#252f23', 'toolbar-strong': '#354531', 'toolbar-icon': '#bad3b4' },
  };
  /** Every declaration given to exactly this selector, in source order. */
  const decls = (sel: string) => {
    const out: Record<string, string> = {};
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').some((x) => x.trim() === sel)) continue;
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':');
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
    }
    return out;
  };

  it('sets the agreed token values in both themes', () => {
    for (const [k, v] of Object.entries(SAGE.light)) expect(light[k], `light --${k}`).toBe(v);
    for (const [k, v] of Object.entries(SAGE.dark)) expect(dark[k], `dark --${k}`).toBe(v);
  });

  it('meets contrast: icons 4.5:1 on the bar and on the pressed background, labels and pressed icons 4.5:1, the focus ring 3:1', () => {
    const pairs: [string, string, number][] = [
      ['toolbar-icon', 'toolbar-bg', 4.5], // icons on the bar
      ['toolbar-icon', 'toolbar-strong', 4.5], // icons on hover
      ['text', 'toolbar-strong', 4.5], // a pressed icon is in the text colour
      ['text', 'toolbar-bg', 4.5], // picker labels (Styles, the font name)
      ['text', 'bg', 4.5], // the size number on the page background
      ['accent', 'toolbar-bg', 3], // the focus ring on sage
      ['accent', 'toolbar-strong', 3],
    ];
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const [fg, bg, min] of pairs) expect(contrast(t[fg], t[bg]), `${theme}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('the bar, its dividers, hover and pressed states use the sage tokens; icons sage, labels the text colour', () => {
    expect(decls('.toolbar').background).toBe('var(--toolbar-bg)');
    expect(decls('.toolbar')['border-bottom']).toBe('1px solid var(--toolbar-strong)');
    expect(decls('.toolbar .tb-sep').background).toBe('var(--toolbar-strong)');
    expect(decls('.toolbar .tb:hover:not(:disabled)').background).toBe('var(--toolbar-strong)');
    expect(decls('.toolbar .tb.active').background).toBe('var(--toolbar-strong)');
    expect(decls('.toolbar .tb').color).toBe('var(--text)');
    expect(decls('.toolbar .tb > svg.lucide').color).toBe('var(--toolbar-icon)');
    expect(decls('.toolbar .tb.active > svg.lucide').color).toBe('var(--text)');
    expect(decls('.size-group .size-input').background).toBe('var(--bg)');
    // Menus opened from the toolbar stay on the page background with the Plum current row.
    expect(decls('.font-popover').background).toBe('var(--bg)');
    expect(decls(".font-item[aria-checked='true']").background).toBe('var(--bg-active)');
  });

  it('toolbar icons have a 1.5 stroke; every other icon keeps 1.75', () => {
    expect(light['icon-stroke']).toBe('1.75');
    expect(light['icon-stroke-toolbar']).toBe('1.5');
    expect(decls('svg.lucide')['stroke-width']).toBe('var(--icon-stroke)');
    expect(decls('.toolbar svg.lucide')['stroke-width']).toBe('var(--icon-stroke-toolbar)');
    // No other rule changes the stroke.
    const others = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*stroke-width:[^{}]*\}/g)].map((m) => m[1].trim());
    expect(others).toEqual(['svg.lucide', '.toolbar svg.lucide']);
  });
});
