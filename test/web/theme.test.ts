// Colour scheme 'Teal rail and paper' (REDESIGN-BRIEF 1, DEVIATIONS 46): every colour comes from the :root
// tokens (light and dark), the tokens are the agreed values, and the pairs the UI uses meet WCAG AA in both themes.
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

// Light values from the brief, with the nudges recorded in DEVIATIONS 46 (soft text darkened 5%; the coral
// split into a fill, a thin-line and a link shade); the dark values are the ones chosen for it.
const TEAL = {
  light: {
    bg: '#ffffff', 'bg-soft': '#f1f5f4', 'bg-hover': '#eaf0ef', 'bg-active': '#fdece6', border: '#d5e0de', text: '#17302d', 'text-soft': '#5a706d',
    accent: '#ef6f53', 'accent-text': '#17302d', 'accent-line': '#dc664c', link: '#974634', 'code-bg': '#edf3f2', mark: '#ffe1d6',
    rail: '#0f5f5a', 'rail-icon': '#cfe9e5', 'rail-hover': '#1b6d67', 'rail-current': '#ffffff', 'rail-current-icon': '#0f5f5a',
    pill: '#17302d', 'pill-ink': '#e7f1ef', 'pill-line': '#3a5551', 'pill-on': '#2f4c48',
  },
  dark: {
    bg: '#172725', 'bg-soft': '#0f1c1b', 'bg-hover': '#20322f', 'bg-active': '#47302a', border: '#2c403d', text: '#e3efec', 'text-soft': '#9ab3ae',
    accent: '#f4806a', 'accent-text': '#17302d', 'accent-line': '#f4806a', link: '#ff9d85', 'code-bg': '#1f302d', mark: '#5a3328',
    rail: '#0c4440', 'rail-icon': '#cfe9e5', 'rail-hover': '#155a55', 'rail-current': '#172725', 'rail-current-icon': '#8fd6cb',
    pill: '#233835', 'pill-ink': '#e7f1ef', 'pill-line': '#3e5753', 'pill-on': '#35504b',
  },
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

describe("'Teal rail and paper' colour scheme", () => {
  it('sets the agreed token values in both themes', () => {
    for (const [k, v] of Object.entries(TEAL.light)) expect(light[k], `light --${k}`).toBe(v);
    for (const [k, v] of Object.entries(TEAL.dark)) expect(dark[k], `dark --${k}`).toBe(v);
  });

  it('keeps the light values of the brief, except the soft text nudged darker to pass', () => {
    const brief = { 'bg-soft': '#f1f5f4', bg: '#ffffff', text: '#17302d', border: '#d5e0de', rail: '#0f5f5a', 'rail-icon': '#cfe9e5', accent: '#ef6f53', pill: '#17302d', 'pill-ink': '#e7f1ef', 'pill-line': '#3a5551', 'pill-on': '#2f4c48' };
    for (const [k, v] of Object.entries(brief)) expect(light[k], `light --${k}`).toBe(v);
    expect(contrast('#5f7673', light['bg-soft'])).toBeLessThan(4.5); // the brief's soft text fails on the ground…
    expect(contrast(light['text-soft'], light['bg-soft'])).toBeGreaterThanOrEqual(4.5); // …the nudged one passes
  });

  it('meets WCAG AA for text, soft text, accent text, links and selected states', () => {
    const pairs: [string, string, number][] = [
      ['text', 'bg', 4.5], ['text', 'bg-soft', 4.5], ['text', 'bg-hover', 4.5], ['text', 'bg-active', 4.5], ['text', 'code-bg', 4.5],
      ['text-soft', 'bg', 4.5], ['text-soft', 'bg-soft', 4.5], ['text-soft', 'bg-hover', 4.5], ['text-soft', 'bg-active', 4.5],
      ['accent-text', 'accent', 4.5], // ink on a coral fill
      ['link', 'bg', 4.5], ['link', 'bg-soft', 4.5], ['link', 'bg-active', 4.5], // link text
      ['accent-line', 'bg', 3], ['accent-line', 'bg-soft', 3], ['accent-line', 'bg-hover', 3], // focus ring, selected outline
      ['danger', 'bg', 4.5], ['danger', 'bg-soft', 4.5], ['warn-text', 'warn-bg', 4.5], ['text', 'mark', 4.5], ['bg', 'text', 4.5],
      ['rail-icon', 'rail', 4.5], ['rail-icon', 'rail-hover', 4.5], ['rail-current-icon', 'rail-current', 4.5], // the rail; its focus ring is --rail-icon
      ['accent-text', 'accent', 4.5], // the badge and the New button: ink on a coral fill
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

  it('the favicon uses the coral accent; nothing purple or sage remains', () => {
    expect(favicon).toContain(TEAL.light.accent);
    expect(favicon).not.toMatch(/#3b6fd8|#8a3aa8/i);
    // The Plum and Sage values are gone from the stylesheet.
    for (const old of ['#8a3aa8', '#cf8cea', '#f9f6fa', '#ecdcf3', '#46275a', '#e3f0e0', '#c8dfc3', '#405e40', '#252f23', '#bad3b4', '#231a27']) expect(css.toLowerCase(), old).not.toContain(old);
    expect(css).not.toMatch(/--(bg-sidebar|toolbar-bg|toolbar-strong|toolbar-icon)\b/);
  });

  it('accent roles: links in the link shade, focus rings and selected outlines in the line shade, the rail ring in the rail ink', () => {
    expect(css).toMatch(/\.prose a \{\s*color: var\(--link\);/);
    expect(css).toMatch(/\.link-button \{\s*color: var\(--link\);/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--accent-line\);/);
    expect(css).toMatch(/\.rail-button:focus-visible \{\s*outline-color: var\(--rail-icon\);/);
    expect(css).toMatch(/accent-color: var\(--accent\)/);
    expect(css).not.toMatch(/background: linear-gradient|radial-gradient/); // flat colour only
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
        expect(contrast(t.link, t[`hl-${h}`]), `${theme}: link on ${h}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});


describe('the editor toolbar: the dark pill (REDESIGN-BRIEF 1, 2.3)', () => {
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

  it('meets contrast: icons and labels 4.5:1 on the pill and on the pressed colour; its focus ring 3:1', () => {
    const pairs: [string, string, number][] = [
      ['pill-ink', 'pill', 4.5], // icons and labels on the pill
      ['pill-ink', 'pill-on', 4.5], // hover and pressed
      ['text', 'bg', 4.5], // the size number on the paper-coloured box
    ];
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const [fg, bg, min] of pairs) expect(contrast(t[fg], t[bg]), `${theme}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('the pill, its dividers, hover and pressed states use the pill tokens; the light menus keep the paper and the coral row', () => {
    expect(decls('.toolbar').background).toBe('var(--pill)');
    expect(decls('.toolbar .tb-sep').background).toBe('var(--pill-line)');
    expect(decls('.toolbar .tb:hover:not(:disabled)').background).toBe('var(--pill-on)');
    expect(decls('.toolbar .tb.active').background).toBe('var(--pill-on)');
    expect(decls('.toolbar .tb').color).toBe('var(--pill-ink)');
    expect(decls('.toolbar .tb:focus-visible')['outline-color']).toBe('var(--pill-ink)');
    expect(decls('.toolbar').color).toBeUndefined(); // the ink is on the buttons, not inherited by the menus
    expect(decls('.size-group .size-input').background).toBe('var(--bg)');
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
