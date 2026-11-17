// The one stylesheet reader for tests that check what a DOM simulator cannot apply (tokens, contrast, layout rules
// that carry behaviour). src/web/styles.css as text, without comments; the wide-screen rules (no @media blocks);
// one @media block by its prelude; the declarations given to one selector; the light and dark tokens.
import fs from 'node:fs';
import path from 'node:path';

/** The stylesheet as written (comments included). */
export const cssSource = fs.readFileSync(path.join(__dirname, '../src/web/styles.css'), 'utf8');
/** The stylesheet without comments. */
export const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');

/** The text inside one at-rule block, by its exact prelude, e.g. '@media (max-width: 760px)'. */
export function atBlock(prelude: string, text = css): string {
  const start = text.indexOf(prelude + ' {');
  if (start < 0) throw new Error(`no ${prelude} block`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(text.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed ${prelude}`);
}

/** The stylesheet without its @media blocks: what applies on a wide screen with a mouse. */
export const wide = (() => {
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

/** The phone rules and the touch-screen rules. */
export const phone = atBlock('@media (max-width: 760px)');
export const coarse = atBlock('@media (pointer: coarse)');

/** Every declaration given to exactly this selector in a stylesheet text (default: the wide rules), later wins. */
export function decls(sel: string, text = wide): Record<string, string> {
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

// The light tokens are the first `:root { … }`; the dark ones the `:root` inside the dark media query.
export const lightBlock = /^:root \{([\s\S]*?)\n\}/m.exec(cssSource)![1];
export const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/.exec(cssSource)![1];
const tokensOf = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
export const light: Record<string, string> = tokensOf(lightBlock);
export const dark: Record<string, string> = { ...light, ...tokensOf(darkBlock) };

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
