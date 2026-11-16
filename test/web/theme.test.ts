// Colour scheme 'Plum': every colour comes from the :root tokens (light and dark), the tokens
// are the agreed values, and the pairs the UI uses meet WCAG AA contrast in both themes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
