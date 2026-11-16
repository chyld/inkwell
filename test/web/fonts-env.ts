// Stand-ins for the browser's FontFace and document.fonts (FONTS-SPEC 11: web tests assert faces
// registered and rules written, not pixels).
import { setFontEnv, type FontEnv, type FontFaceLike } from '../../src/web/fonts/runtime';

export class FakeFontFace implements FontFaceLike {
  static made: FakeFontFace[] = [];
  /** Families whose constructor throws. */
  static throwFor = new Set<string>();
  /** Make load() of a preview wait until released (by family). */
  static holdLoads = false;
  loaded: Promise<unknown>;
  loadCalls = 0;
  private settle!: { ok: () => void; fail: (e: Error) => void };

  constructor(
    public family: string,
    public source: string,
    public descriptors: Record<string, string>,
  ) {
    if (FakeFontFace.throwFor.has(family)) throw new SyntaxError('bad descriptor');
    this.loaded = new Promise((ok, fail) => (this.settle = { ok: () => ok(this), fail }));
    this.loaded.catch(() => {});
    FakeFontFace.made.push(this);
  }

  load() {
    this.loadCalls++;
    if (!FakeFontFace.holdLoads) this.settle.ok();
    return this.loaded;
  }
  /** The browser finished downloading this face's file. */
  resolve() {
    this.settle.ok();
  }
  /** The browser failed to download or decode this face's file. */
  fail() {
    this.settle.fail(new Error('NetworkError'));
  }
}

export const documentFonts = new Set<FontFaceLike>();

export function installFontEnv() {
  FakeFontFace.made = [];
  FakeFontFace.throwFor = new Set();
  FakeFontFace.holdLoads = false;
  documentFonts.clear();
  const env: FontEnv = {
    FontFace: FakeFontFace as unknown as FontEnv['FontFace'],
    fonts: { add: (f) => documentFonts.add(f), delete: (f) => documentFonts.delete(f) },
  };
  setFontEnv(env);
}

/** Families currently registered with the (stand-in) document font set. */
export const registeredFamilies = () => [...documentFonts].map((f) => (f as FakeFontFace).family);

export const HASH = (n: number) => n.toString(16).padStart(64, '0');
