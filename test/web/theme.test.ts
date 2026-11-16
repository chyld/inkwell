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
  // 'Slate and coral' (DEVIATIONS 49); the name TEAL is kept so the tests below read as before.
  light: {
    bg: '#ffffff', 'bg-soft': '#f3f5f7', 'bg-hover': '#eaeef2', 'bg-active': '#ffece8', border: '#d9dfe6', text: '#1e2733', 'text-soft': '#586474',
    accent: '#ff7a66', 'accent-text': '#1e2733', 'accent-line': '#d76756', link: '#95473c', 'code-bg': '#eef1f4', mark: '#ffe3dc',
    rail: '#3d4a5c', 'rail-icon': '#dbe2ea', 'rail-hover': '#4a5970', 'rail-current': '#ffffff', 'rail-current-icon': '#3d4a5c',
    'bar-on': '#52627a', 'bar-line': '#56647a',
  },
  dark: {
    bg: '#1b222c', 'bg-soft': '#12161c', 'bg-hover': '#242c38', 'bg-active': '#4a2d28', border: '#2e3744', text: '#e4e9ef', 'text-soft': '#9aa6b4',
    accent: '#ff8b78', 'accent-text': '#1e2733', 'accent-line': '#ff8b78', link: '#ffa594', 'code-bg': '#232b36', mark: '#5a3328',
    rail: '#2b3545', 'rail-icon': '#dbe2ea', 'rail-hover': '#36425a', 'rail-current': '#1b222c', 'rail-current-icon': '#c7d3e3',
    'bar-on': '#3b475c', 'bar-line': '#46536a',
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

describe("'Slate and coral' colour scheme", () => {
  it('sets the agreed token values in both themes', () => {
    for (const [k, v] of Object.entries(TEAL.light)) expect(light[k], `light --${k}`).toBe(v);
    for (const [k, v] of Object.entries(TEAL.dark)) expect(dark[k], `dark --${k}`).toBe(v);
  });

  it("keeps the owner's light values for 'Slate and coral'; the soft text reaches 4.5:1 on the ground", () => {
    const given = { 'bg-soft': '#f3f5f7', bg: '#ffffff', text: '#1e2733', rail: '#3d4a5c', 'rail-icon': '#dbe2ea', accent: '#ff7a66', 'accent-text': '#1e2733' };
    for (const [k, v] of Object.entries(given)) expect(light[k], `light --${k}`).toBe(v);
    expect(contrast(light['text-soft'], light['bg-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.accent, light.bg)).toBeLessThan(3); // the plain coral is for fills only…
    expect(contrast(light['accent-line'], light.bg)).toBeGreaterThanOrEqual(3); // …thin lines use the darker one
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
      ['tag-ink', 'tag-bg', 4.5], // tags as soft coral blocks (DEVIATIONS 50)
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
    // Nor the teal of 'Teal rail and paper' (DEVIATIONS 49).
    for (const old of ['#0f5f5a', '#cfe9e5', '#1b7a73', '#2f7d77', '#0c4440', '#17302d', '#ef6f53', '#f1f5f4', '#0f1c1b', '#172725']) expect(css.toLowerCase(), old).not.toContain(old);
    expect(favicon).not.toMatch(/#ef6f53|#17302d/i);
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


/** The stylesheet without comments and @media blocks: the rules on a wide screen with a mouse. */
const wideCss = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@media', i);
    if (at < 0) return out + text.slice(i);
    out += text.slice(i, at);
    let depth = 0;
    let j = text.indexOf('{', at);
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
})();

describe('the editor toolbar: a flat teal bar (mock-up 07, DEVIATIONS 47)', () => {
  /** Every declaration given to exactly this selector, in source order. */
  const decls = (sel: string) => {
    const out: Record<string, string> = {};
    for (const m of wideCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').some((x) => x.trim() === sel)) continue;
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':');
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
    }
    return out;
  };

  it('meets contrast: the rail ink 4.5:1 on the bar, 3:1 (icons) on the given pressed teal; its focus ring', () => {
    const pairs: [string, string, number][] = [
      ['rail-icon', 'rail', 4.5], // icons and labels on the bar
      ['rail-icon', 'bar-on', 3], // hover and pressed: the given light value is 4.03:1, enough for icons
      ['text', 'bg', 4.5], // the size number on the paper-coloured box
    ];
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const [fg, bg, min] of pairs) expect(contrast(t[fg], t[bg]), `${theme}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('the bar is the rail teal; dividers, hover and pressed use the bar tokens; the light menus keep the paper and the coral row', () => {
    expect(decls('.toolbar').background).toBe('var(--rail)');
    expect(decls('.toolbar .tb-sep').background).toBe('var(--bar-line)');
    expect(decls('.toolbar .tb:hover:not(:disabled)').background).toBe('var(--bar-on)');
    expect(decls('.toolbar .tb.active').background).toBe('var(--bar-on)');
    expect(decls('.toolbar .tb').color).toBe('var(--rail-icon)');
    expect(decls('.toolbar .tb')['border-radius']).toBe('4px');
    expect(decls('.toolbar .tb:focus-visible')['outline-color']).toBe('var(--rail-icon)');
    expect(decls('.toolbar').color).toBeUndefined(); // the ink is on the buttons, not inherited by the menus
    expect(decls('.size-group .size-input').background).toBe('var(--bg)');
    expect(decls('.font-popover').background).toBe('var(--bg)');
    expect(decls(".font-item[aria-checked='true']").background).toBe('var(--bg-active)');
  });

  it('every icon, the toolbar included, has the 1.75 stroke (the thinner toolbar stroke was dropped: DEVIATIONS 46)', () => {
    expect(light['icon-stroke']).toBe('1.75');
    expect(light['icon-stroke-toolbar']).toBeUndefined();
    expect(decls('svg.lucide')['stroke-width']).toBe('var(--icon-stroke)');
    const others = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*stroke-width:[^{}]*\}/g)].map((m) => m[1].trim());
    expect(others).toEqual(['svg.lucide']); // no other rule changes the stroke
  });

  it('the bar is flat and full width, its contents left-aligned at the title row padding; the table tools a second flat bar', () => {
    expect(decls('.toolbar-wrap')['align-items']).toBe('stretch');
    expect(decls('.toolbar-wrap > .toolbar')['border-radius']).toBe('0');
    expect(decls('.toolbar-wrap > .toolbar')['justify-content']).toBe('flex-start');
    expect(decls('.toolbar-wrap > .toolbar').padding).toBe('3px 16px');
    expect(decls('.editor-header').padding).toBe('0 16px');
    expect(decls('.toolbar-wrap > .table-tools')['font-size']).toBe('0.75rem');
    expect(decls('.toolbar-wrap > .table-tools')['border-top']).toBe('1px solid var(--bar-line)');
  });

  it('no wasted space: the pane has no padding or gaps; the paper square, full width, 20 px side padding; the title 19 px bold in the row', () => {
    expect(decls('.editor-scroll.paper').background).toBe('var(--bg)');
    expect(decls('.editor-scroll.paper')['border-radius']).toBeUndefined(); // square corners
    expect(decls('.editor-scroll.paper').padding).toBe('16px 20px 60px');
    expect(decls('.editor-scroll.paper')['overflow-y']).toBe('auto'); // the paper scrolls, the row and toolbar stay
    expect(decls('.paper-column')['max-width']).toBeUndefined(); // no centred column
    expect(decls('.editor-pane').padding).toBeUndefined();
    expect(decls('.editor-pane').gap).toBeUndefined();
    expect(decls('.editor-row')['min-height']).toBe('36px');
    expect(decls('.title-input')['font-size']).toBe('19px');
    expect(decls('.title-input')['font-weight']).toBe('700');
    expect(decls('.title-input')['text-overflow']).toBe('ellipsis');
    expect(decls('.editor-pane').background).toBe('var(--bg-soft)');
  });
});
