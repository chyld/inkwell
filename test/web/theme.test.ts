// Colour scheme 'Slate and coral' (DEVIATIONS 49): every colour comes from the :root tokens (light and dark), the
// tokens are the agreed values, and the pairs the UI uses meet WCAG AA in both themes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../../src/shared/schema';
import { contrast, cssSource as css, darkBlock, decls, light, dark, lightBlock } from '../css';

const favicon = readFileSync(new URL('../../src/web/public/favicon.svg', import.meta.url), 'utf8');

// The light values as given (DEVIATIONS 49), with the nudges recorded there; the dark values chosen for them.
const SCHEME = {
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

describe("'Slate and coral' colour scheme", () => {
  it('sets the agreed token values in both themes', () => {
    for (const [k, v] of Object.entries(SCHEME.light)) expect(light[k], `light --${k}`).toBe(v);
    for (const [k, v] of Object.entries(SCHEME.dark)) expect(dark[k], `dark --${k}`).toBe(v);
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

  it('the favicon uses the coral accent', () => {
    expect(favicon).toContain(SCHEME.light.accent);
  });

  it('accent roles: links in the link shade, focus rings and selected outlines in the line shade, the rail and toolbar rings in the rail ink', () => {
    expect(css).toMatch(/\.prose a \{\s*color: var\(--link\);/);
    expect(css).toMatch(/\.link-button \{[^}]*\scolor: var\(--link\);/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--accent-line\);/);
    expect(css).toMatch(/\.rail-button:focus-visible \{\s*outline-color: var\(--rail-icon\);/);
    expect(decls('.toolbar .tb:focus-visible')['outline-color']).toBe('var(--rail-icon)');
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

describe('the editor toolbar (DEVIATIONS 47)', () => {
  it('meets contrast: the rail ink 4.5:1 on the bar and on hover and pressed (labels show pressed: an open picker); its focus ring', () => {
    const pairs: [string, string, number][] = [
      ['rail-icon', 'rail', 4.5], // icons and labels on the bar
      ['rail-icon', 'bar-on', 4.5], // hover and pressed, labels included (CLEANUP-PLAN pass 2 item 5c; 4.75 light, 7.17 dark)
      ['text', 'bg', 4.5], // the size number on the paper-coloured box
    ];
    for (const [theme, t] of Object.entries({ light, dark })) {
      for (const [fg, bg, min] of pairs) expect(contrast(t[fg], t[bg]), `${theme}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('every icon, the toolbar included, has the 1.75 stroke (the thinner toolbar stroke was dropped: DEVIATIONS 46)', () => {
    expect(light['icon-stroke']).toBe('1.75');
    expect(light['icon-stroke-toolbar']).toBeUndefined();
    expect(decls('svg.lucide')['stroke-width']).toBe('var(--icon-stroke)');
    const others = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*stroke-width:[^{}]*\}/g)].map((m) => m[1].trim());
    expect(others).toEqual(['svg.lucide']); // no other rule changes the stroke
  });
});
