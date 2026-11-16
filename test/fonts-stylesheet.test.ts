// FONTS-SPEC 5.1 and acceptance criterion 10 (the grammar): recorded real answers are accepted;
// anything outside the grammar is rejected; URLs are built from the catalogue as Google expects.
import { describe, expect, it } from 'vitest';
import { fontById } from '../src/shared/fonts.js';
import { FontFetchError, isAllowedFileUrl, parseStylesheet } from '../src/server/fonts/stylesheet.js';
import { checkFaces, checkPreview, facesUrl, previewUrl, wantedFaces } from '../src/server/fonts/upstream.js';
import { recorded } from './fonts-upstream.js';

const F = (id: string) => fontById(id)!;
const block = (decls: string, comment = '/* latin */') => `${comment}\n@font-face {\n${decls}\n}\n`;
const GOOD = [
  "  font-family: 'Titan One';",
  '  font-style: normal;',
  '  font-weight: 400;',
  '  src: url(https://fonts.gstatic.com/s/titanone/v17/x.woff2) format(\'woff2\');',
  '  unicode-range: U+0000-00FF, U+0131;',
];
const titan = (lines: string[], comment?: string) => block(lines.join('\n'), comment);

describe('upstream URLs are built from the catalogue entry, exactly as recorded from Google', () => {
  it('preview and note-face URLs', () => {
    expect(previewUrl(F('titan-one'))).toBe(recorded.url('preview-titan-one'));
    expect(previewUrl(F('titan-one'))).toBe('https://fonts.googleapis.com/css2?family=Titan+One:wght@400&text=Titan+One');
    for (const id of ['almendra', 'lora', 'abhaya-libre', 'sunflower', 'unifrakturcook', 'titan-one']) expect(facesUrl(F(id)), id).toBe(recorded.url(`faces-${id}`));
    expect(facesUrl(F('almendra'))).toBe('https://fonts.googleapis.com/css2?family=Almendra:ital,wght@0,400;0,700;1,400;1,700');
  });

  it('the 700-only family repeats no tuple and an upright-only family does not name ital', () => {
    expect(wantedFaces(F('unifrakturcook'))).toEqual([{ italic: false, weight: 700 }]);
    expect(facesUrl(F('unifrakturcook'))).toMatch(/:wght@700$/);
    expect(facesUrl(F('abhaya-libre'))).toMatch(/:wght@400;700$/);
    expect(facesUrl(F('abhaya-libre'))).not.toContain('ital');
    expect(facesUrl(F('sunflower'))).toMatch(/:wght@300;700$/); // regular is 300
  });

  it('the checked facts hold in the recordings', () => {
    expect(recorded.status('fact-missing-single-face')).toBe(400);
    expect(recorded.css('fact-missing-single-face')).toMatch(/^<!DOCTYPE html>/i);
    expect(recorded.status('fact-duplicated-tuple')).toBe(400);
    expect(recorded.status('fact-missing-weight-in-multi')).toBe(200);
    expect(recorded.css('fact-missing-weight-in-multi')).not.toContain('font-weight: 700');
    expect(recorded.css('fact-truetype-for-old-agent')).toContain("format('truetype')");
    // Every block carries font-family.
    for (const n of ['faces-almendra', 'faces-lora', 'faces-sunflower']) {
      const css = recorded.css(n);
      expect(css.match(/@font-face/g)!.length, n).toBe(css.match(/font-family:/g)!.length);
    }
  });
});

describe('recorded real answers are accepted', () => {
  it('note faces: only latin and latin-ext blocks are kept, with their weight, style and range', () => {
    const lora = checkFaces(F('lora'), recorded.css('faces-lora'));
    expect(new Set(lora.map((b) => b.slice))).toEqual(new Set(['latin', 'latin-ext']));
    expect(lora.map((b) => `${b.style} ${b.weight}`).sort()).toEqual(['italic 400', 'italic 400', 'italic 700', 'italic 700', 'normal 400', 'normal 400', 'normal 700', 'normal 700']);
    expect(lora.every((b) => b.unicodeRange && b.url.startsWith('https://fonts.gstatic.com/'))).toBe(true);
    for (const id of ['almendra', 'abhaya-libre', 'sunflower', 'unifrakturcook', 'titan-one']) {
      const kept = checkFaces(F(id), recorded.css(`faces-${id}`));
      expect(kept.length, id).toBeGreaterThan(0);
      expect(kept.every((b) => b.slice === 'latin' || b.slice === 'latin-ext'), id).toBe(true);
    }
    // Sunflower's 176 blocks (Korean slices) all pass the grammar before the non-Latin ones are dropped.
    expect(parseStylesheet(recorded.css('faces-sunflower'), true).length).toBe(176);
  });

  it('a text= preview has one block, unicode-range optional', () => {
    const b = checkPreview(F('titan-one'), recorded.css('preview-titan-one'));
    expect(b.url).toMatch(/^https:\/\/fonts\.gstatic\.com\/l\/font\?kit=/);
    expect(checkPreview(F('titan-one'), titan(GOOD.filter((l) => !l.includes('unicode-range')), '')).weight).toBe('400');
  });

  it('a variable weight range is read as two integers', () => {
    const [b] = parseStylesheet(titan(GOOD.map((l) => (l.includes('font-weight') ? '  font-weight: 100 900;' : l))), true);
    expect(b).toMatchObject({ weight: '100 900', weightMin: 100, weightMax: 900 });
  });
});

describe('rejected', () => {
  const bad = (css: string, check: (css: string) => unknown = (c) => parseStylesheet(c, true)) => expect(() => check(css), css).toThrow(FontFetchError);
  const swap = (from: string, to: string) => titan(GOOD.map((l) => (l.includes(from) ? to : l)));

  it('an unknown rule or descriptor', () => {
    bad(`@import url(https://evil.example/x.css);\n${titan(GOOD)}`);
    bad(`.x { color: red }\n${titan(GOOD)}`);
    bad(`@media screen { ${titan(GOOD)} }`);
    bad(titan([...GOOD, '  font-feature-settings: "liga";']));
    bad(titan([...GOOD, '  size-adjust: 90%;']));
    expect(() => parseStylesheet(titan([...GOOD, '  font-display: swap;', '  font-stretch: 100%;']), true)).not.toThrow(); // accepted, ignored
  });

  it('a font-family that is not the one requested', () => {
    bad(swap('font-family', "  font-family: 'Comic Sans';"), (c) => checkFaces(F('titan-one'), c));
    bad(swap('font-family', "  font-family: 'Comic Sans';").replace('/* latin */', ''), (c) => checkPreview(F('titan-one'), c));
  });

  it('a file URL anywhere but https://fonts.gstatic.com', () => {
    for (const u of [
      'https://fonts.gstatic.com.evil.example/x.woff2',
      'https://fonts.gstatic.com@evil.example/x.woff2',
      'http://fonts.gstatic.com/x.woff2',
      'https://fonts.gstatic.com:8443/x.woff2',
      'https://user:pass@fonts.gstatic.com/x.woff2',
      'https://evil.example/x.woff2',
      '//fonts.gstatic.com/x.woff2',
      'data:font/woff2;base64,d09GMg==',
    ]) {
      expect(isAllowedFileUrl(u), u).toBe(false);
      bad(swap('src:', `  src: url(${u}) format('woff2');`));
    }
    expect(isAllowedFileUrl('https://fonts.gstatic.com/s/x/v1/a.woff2')).toBe(true);
  });

  it('a missing or repeated descriptor, two sources, or a non-WOFF2 format', () => {
    for (const d of ['font-family', 'font-style', 'font-weight', 'src', 'unicode-range']) bad(titan(GOOD.filter((l) => !l.includes(d + ':'))));
    bad(titan([...GOOD, '  font-weight: 700;']));
    bad(titan([...GOOD, '  src: url(https://fonts.gstatic.com/y.woff2) format(\'woff2\');']));
    bad(swap('src:', "  src: url(https://fonts.gstatic.com/a.woff2) format('woff2'), url(https://fonts.gstatic.com/b.woff2) format('woff2');"));
    bad(swap('src:', "  src: url(https://fonts.gstatic.com/a.ttf) format('truetype');"));
    bad(recorded.css('fact-truetype-for-old-agent'), (c) => parseStylesheet(c, false));
  });

  it('a bad weight, style or unicode-range', () => {
    for (const w of ['0', '1001', 'bold', '700 400', '400.5', '', '400 500 600']) bad(swap('font-weight', `  font-weight: ${w};`));
    bad(swap('font-style', '  font-style: oblique;'));
    for (const r of ['U+ZZ', 'bananas', 'U+0000-00FF,', 'U+0000-00FF U+0131', 'U+1234567', 'u+0041']) bad(swap('unicode-range', `  unicode-range: ${r};`));
  });

  it('a face that was not requested, no latin block, no regular face, or a preview with two blocks', () => {
    bad(swap('font-weight', '  font-weight: 700;'), (c) => checkFaces(F('titan-one'), c)); // Titan One has only 400
    bad(titan(GOOD.map((l) => (l.includes('font-style') ? '  font-style: italic;' : l))), (c) => checkFaces(F('titan-one'), c));
    bad(titan(GOOD, '/* latin-ext */'), (c) => checkFaces(F('titan-one'), c));
    bad(titan(GOOD, '/* cyrillic */'), (c) => checkFaces(F('titan-one'), c));
    const abhaya = (w: string, slice: string) =>
      block([`  font-family: 'Abhaya Libre';`, '  font-style: normal;', `  font-weight: ${w};`, "  src: url(https://fonts.gstatic.com/a.woff2) format('woff2');", '  unicode-range: U+0000-00FF;'].join('\n'), `/* ${slice} */`);
    bad(abhaya('700', 'latin'), (c) => checkFaces(F('abhaya-libre'), c)); // no upright regular
    expect(() => checkFaces(F('abhaya-libre'), abhaya('400', 'latin') + abhaya('700', 'latin'))).not.toThrow();
    bad(recorded.css('preview-titan-one') + recorded.css('preview-titan-one'), (c) => checkPreview(F('titan-one'), c));
    bad('', (c) => checkPreview(F('titan-one'), c));
  });

  it('broken syntax', () => {
    for (const css of ['/* unterminated', '@font-face {', '@font-face { font-family: "A" { }', "@font-face { src: url(https://fonts.gstatic.com/a.woff2 format('woff2'); }", '<!DOCTYPE html><html>']) bad(css);
  });
});

describe('colour-capable families (found in the hand checks, 2026-11-15)', () => {
  it("Google adds a `body { --google-font-color-…: none; }` rule for them, which 5.1's grammar refuses", () => {
    for (const n of ['fact-color-font-preview-nabla', 'fact-color-font-faces-nabla']) {
      expect(recorded.status(n)).toBe(200);
      expect(recorded.css(n)).toMatch(/\nbody \{\s*--google-font-color-nabla:/);
    }
    expect(() => checkPreview(F('nabla'), recorded.css('fact-color-font-preview-nabla'))).toThrow(/a rule other than @font-face/);
    expect(() => checkFaces(F('nabla'), recorded.css('fact-color-font-faces-nabla'))).toThrow(/a rule other than @font-face/);
  });
});
