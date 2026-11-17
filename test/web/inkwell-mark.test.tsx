// @vitest-environment happy-dom
// The app is called Inkwell: its mark is the favicon, heads the sign-in card and (on a wide screen) the rail.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MARK_BOTTLE, MARK_DROP, MARK_NECK } from '../../src/web/components/InkwellMark';
import { SignIn } from '../../src/web/components/SignIn';
import { contrast, dark, decls, light, phone } from '../css';
import { render } from './harness';

const web = path.join(__dirname, '../../src/web');
const favicon = fs.readFileSync(path.join(web, 'public/favicon.svg'), 'utf8');
const index = fs.readFileSync(path.join(web, 'index.html'), 'utf8');

let view: Awaited<ReturnType<typeof render>> | null = null;
afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe('the Inkwell mark', () => {
  it('the favicon is the same three flat shapes as the inline mark, in Slate and coral, with a light neck on a dark tab strip', () => {
    expect(index).toContain('<title>Inkwell</title>');
    expect(index).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(favicon).toContain(`d="${MARK_NECK}"`);
    expect(favicon).toContain(`d="${MARK_DROP}"`);
    const b = MARK_BOTTLE;
    expect(favicon).toContain(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}" fill="${light['accent']}"/>`);
    expect(favicon).toContain(`.neck{fill:${light['rail']}}`);
    expect(favicon).toMatch(new RegExp(`@media \\(prefers-color-scheme:dark\\)\\{\\.neck\\{fill:${dark['rail-icon']}\\}\\}`));
    expect(favicon).toContain(`fill="${light['accent-text']}"`);
    expect(favicon).not.toMatch(/Gradient|filter|<text/);
  });

  it('heads the sign-in card next to the name', async () => {
    view = await render(<SignIn onSignedIn={() => {}} />);
    const h1 = view.container.querySelector('h1')!;
    expect(h1.textContent).toBe('Inkwell');
    expect(h1.querySelector('svg.inkwell-mark')).toBeTruthy();
  });

  it('every part reads on the paper and on the rail, light and dark; the rail hides it in the phone bar', () => {
    expect(decls('.inkwell-bottle').fill).toBe('var(--accent)');
    expect(decls('.inkwell-drop').fill).toBe('var(--accent-text)');
    expect(decls('.inkwell-neck').fill).toBe('currentColor');
    expect(decls('.rail-logo').color).toBe('var(--rail-icon)');
    for (const t of [light, dark]) {
      expect(contrast(t['accent-text'], t['accent'])).toBeGreaterThanOrEqual(3); // drop on bottle
      expect(contrast(t['text'], t['bg'])).toBeGreaterThanOrEqual(3); // neck on the sign-in card
      expect(contrast(t['rail-icon'], t['rail'])).toBeGreaterThanOrEqual(3); // neck on the rail
      expect(contrast(t['accent'], t['rail'])).toBeGreaterThanOrEqual(3); // bottle on the rail
    }
    expect(contrast(dark['accent'], dark['bg'])).toBeGreaterThanOrEqual(3); // bottle on dark paper
    expect(phone).toMatch(/\.rail-logo \{\s*display: none;/);
  });
});
