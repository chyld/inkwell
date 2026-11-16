// Image sizes: the stored width/height (schema) and the resize maths of the editor's image view.
import { describe, expect, it } from 'vitest';
import { NoteValidationError, parseImageDimension, validateBody } from '../src/shared/schema';
import { IMAGE_MIN_WIDTH, clampWidth, dragSize, keySize, sizeForWidth, sizeText } from '../src/web/imageResize';

const SRC = '/api/images/11111111-1111-4111-8111-111111111111';
const docWith = (attrs: Record<string, unknown>) => ({ type: 'doc', content: [{ type: 'image', attrs: { src: SRC, ...attrs } }] });

describe('the schema: width and height on an image', () => {
  it('accepts whole-pixel sizes, no size, and each alone; the stored JSON round-trips unchanged', () => {
    for (const attrs of [{ width: 320, height: 180 }, {}, { width: null, height: null }, { width: 40 }, { height: 100000 }, { width: 100000, height: 1 }]) {
      const v = validateBody(docWith(attrs));
      expect((v.json as any).content[0].attrs).toEqual({ src: SRC, alt: null, title: null, width: null, height: null, ...attrs }); // defaults filled in
      expect(validateBody(v.json).json).toEqual(v.json);
      expect(v.imageIds).toEqual(['11111111-1111-4111-8111-111111111111']); // the clean-up logic sees the same image
    }
  });

  it('still accepts every size valid before resizing existed (positive numbers up to 100000, fractions too)', () => {
    for (const attrs of [{ width: 12.5, height: 0.5 }, { width: 1 }, { width: 99999.99 }]) expect(() => validateBody(docWith(attrs))).not.toThrow();
  });

  it('rejects zero, negative, too large, non-numbers and unknown attributes (unchanged)', () => {
    for (const attrs of [{ width: 0 }, { width: -5 }, { height: 100001 }, { width: '320' }, { width: true }, { width: [320] }, { style: 'width:10px' }])
      expect(() => validateBody(docWith(attrs)), JSON.stringify(attrs)).toThrow(NoteValidationError);
  });

  it('a pasted width/height attribute becomes a number the validator accepts, or none', () => {
    expect(parseImageDimension('320')).toBe(320);
    expect(parseImageDimension(' 40 ')).toBe(40);
    expect(parseImageDimension('100000')).toBe(100000);
    for (const v of [null, '', '0', '100001', '12.5', '50%', '-3', '320px', 'auto', '1e3']) expect(parseImageDimension(v), String(v)).toBeNull();
  });
});

describe('the resize maths', () => {
  const ratio = 0.5625; // 16:9
  it('keeps the ratio in whole pixels', () => {
    expect(sizeForWidth(320, ratio, 1000)).toEqual({ width: 320, height: 180 });
    expect(sizeForWidth(333.4, ratio, 1000)).toEqual({ width: 333, height: 187 });
    expect(sizeForWidth(100, 2, 1000)).toEqual({ width: 100, height: 200 });
  });

  it('clamps between 40 px and the column, the column winning if narrower than 40', () => {
    expect(IMAGE_MIN_WIDTH).toBe(40);
    expect(clampWidth(10, 600)).toBe(40);
    expect(clampWidth(-500, 600)).toBe(40);
    expect(clampWidth(900, 600)).toBe(600);
    expect(clampWidth(600.4, 600.9)).toBe(600);
    expect(clampWidth(100, 30)).toBe(30);
    expect(sizeForWidth(5000, ratio, 640)).toEqual({ width: 640, height: 360 });
    expect(sizeForWidth(1, ratio, 640)).toEqual({ width: 40, height: 23 });
  });

  it('a corner grows the image when dragged away from the opposite corner, by whichever axis moved more', () => {
    const start = (corner: any) => ({ width: 400, ratio: 0.5, corner, maxWidth: 800 });
    expect(dragSize(start('bottom-right'), 100, 0)).toEqual({ width: 500, height: 250 });
    expect(dragSize(start('bottom-right'), 0, 50)).toEqual({ width: 500, height: 250 }); // 50 px down = 100 px wider at 1:2
    expect(dragSize(start('bottom-right'), -100, 10)).toEqual({ width: 300, height: 150 });
    expect(dragSize(start('top-left'), -100, 0)).toEqual({ width: 500, height: 250 });
    expect(dragSize(start('top-left'), 0, -50)).toEqual({ width: 500, height: 250 });
    expect(dragSize(start('bottom-left'), 60, 0)).toEqual({ width: 340, height: 170 });
    expect(dragSize(start('top-right'), 0, 40)).toEqual({ width: 320, height: 160 });
    expect(dragSize(start('bottom-right'), 5000, 0)).toEqual({ width: 800, height: 400 });
    expect(dragSize(start('bottom-right'), -5000, 0)).toEqual({ width: 40, height: 20 });
    expect(dragSize(start('bottom-right'), 0, 0)).toEqual({ width: 400, height: 200 });
  });

  it('keys: arrows 10 px, Shift 1 px, Page Up/Down 50 px, Home/End the limits, R resets; other keys do nothing', () => {
    const k = (key: string, shift = false) => keySize(key, shift, 400, 0.5, 600);
    expect(k('ArrowRight')).toEqual({ kind: 'size', size: { width: 410, height: 205 } });
    expect(k('ArrowUp')).toEqual({ kind: 'size', size: { width: 410, height: 205 } });
    expect(k('ArrowLeft')).toEqual({ kind: 'size', size: { width: 390, height: 195 } });
    expect(k('ArrowDown', true)).toEqual({ kind: 'size', size: { width: 399, height: 200 } });
    expect(k('ArrowRight', true)).toEqual({ kind: 'size', size: { width: 401, height: 201 } });
    expect(k('PageUp')).toEqual({ kind: 'size', size: { width: 450, height: 225 } });
    expect(k('PageDown')).toEqual({ kind: 'size', size: { width: 350, height: 175 } });
    expect(k('Home')).toEqual({ kind: 'size', size: { width: 40, height: 20 } });
    expect(k('End')).toEqual({ kind: 'size', size: { width: 600, height: 300 } });
    expect(k('r')).toEqual({ kind: 'reset' });
    expect(k('R', true)).toEqual({ kind: 'reset' });
    expect(keySize('ArrowRight', false, 598, 0.5, 600)).toEqual({ kind: 'size', size: { width: 600, height: 300 } });
    expect(keySize('ArrowLeft', false, 45, 0.5, 600)).toEqual({ kind: 'size', size: { width: 40, height: 20 } });
    for (const key of ['a', 'Enter', ' ', 'Tab', 'Delete']) expect(k(key)).toBeNull();
  });

  it('the readout', () => {
    expect(sizeText({ width: 320, height: 180 })).toBe('320 × 180');
  });
});
