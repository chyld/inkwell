// @vitest-environment happy-dom
// The app-wide note-face loader shared by open notes and style samples (STYLES-SPEC 10, criterion 16),
// and the sample renderer's markup.
import { beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE, NOTE_FONTS_MAX } from '../../src/shared/fonts';
import { ApiError } from '../../src/web/api';
import { clearAllFonts, FaceLoader, fontRulesText, FontSession, setFaceLoader } from '../../src/web/fonts/runtime';
import { SampleFontsProvider, StyleSample, type StyleSettings } from '../../src/web/components/StyleSample';
import { render, settle } from './harness';
import { HASH, installFontEnv, registeredFamilies } from './fonts-env';

let pending: Map<string, { ok: () => void; fail: (e: unknown) => void }>;
let calls: string[];
let now: number;
let timers: { at: number; fn: () => void }[];
function makeLoader() {
  pending = new Map();
  calls = [];
  now = 1_000_000;
  timers = [];
  const l = new FaceLoader({
    getFaces: (id) => {
      calls.push(id);
      return new Promise((ok, fail) =>
        pending.set(id, { ok: () => ok({ faces: [{ weight: '400', style: 'normal', unicodeRange: 'U+0000-00FF', file: HASH(id.length) }] }), fail }),
      );
    },
    now: () => now,
    setTimeout: (fn, ms) => timers.push({ at: now + ms, fn }),
  });
  setFaceLoader(l);
  return l;
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const ids = (n: number, from = 0) => FONT_CATALOGUE.slice(from, from + n).map((f) => f.id);
async function finishAll() {
  while (pending.size) {
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      p.ok();
    }
    await flush();
  }
}

beforeEach(() => {
  installFontEnv();
  clearAllFonts();
});

describe('the shared loader', () => {
  it('never more than 6 /faces in flight in total, across an open note and samples', async () => {
    const l = makeLoader();
    const note = new FontSession({ loader: l, max: NOTE_FONTS_MAX });
    const page = new FontSession({ loader: l });
    const menu = new FontSession({ loader: l });
    note.want(ids(8));
    page.want(ids(8, 100));
    menu.want(ids(8, 200));
    expect(pending.size).toBe(6);
    await finishAll();
    expect(l.maxActive).toBe(6);
    expect(calls.length).toBe(24);
    expect(registeredFamilies().length).toBe(24);
  });

  it('one request for a font used by several styles, and by the note too (joined)', async () => {
    const l = makeLoader();
    const page = new FontSession({ loader: l });
    const form = new FontSession({ loader: l });
    const note = new FontSession({ loader: l, max: NOTE_FONTS_MAX });
    page.want(['lora', 'lora', 'caveat']);
    form.want(['lora']);
    note.want(['lora']);
    await finishAll();
    expect(calls.sort()).toEqual(['caveat', 'lora']);
    // Registered for the session: a later opening does not ask again.
    new FontSession({ loader: l }).want(['lora']);
    await flush();
    expect(calls.length).toBe(2);
  });

  it('a note with 50 fonts still gets its fonts and the styles theirs; samples do not count toward the 50', async () => {
    const l = makeLoader();
    const note = new FontSession({ loader: l, max: NOTE_FONTS_MAX });
    note.want(ids(51)); // the note's own limit: 50 ids
    const page = new FontSession({ loader: l });
    page.want(ids(3, 500));
    await finishAll();
    expect(calls.length).toBe(53);
    expect(calls).not.toContain(ids(51)[50]);
    for (const id of ids(3, 500)) expect(registeredFamilies()).toContain(`nf-${id}`);
  });

  it('a failed font shows the fallback and is asked for again at the next opening, not before', async () => {
    const l = makeLoader();
    const page = new FontSession({ loader: l });
    page.want(['lora']);
    pending.get('lora')!.fail(new ApiError(502, 'font_unavailable', 'x'));
    pending.delete('lora');
    await flush();
    expect(registeredFamilies()).toEqual([]);
    expect(fontRulesText()).toContain('[data-font="lora"] { font-family: "nf-lora", serif; }');
    page.want(['lora']);
    await flush();
    expect(calls).toEqual(['lora']);
    page.close();
    new FontSession({ loader: l }).want(['lora']); // the next opening
    expect(calls).toEqual(['lora', 'lora']);
    // The form asks again when its font changes to it.
    const form = new FontSession({ loader: l });
    form.want(['caveat']);
    pending.get('caveat')!.fail(new Error('network'));
    pending.delete('caveat');
    await flush();
    form.retry('caveat');
    expect(calls.filter((c) => c === 'caveat').length).toBe(2);
  });

  it('a 429 pauses the loader until the time given', async () => {
    const l = makeLoader();
    const page = new FontSession({ loader: l });
    page.want(ids(8));
    const first = ids(1)[0];
    pending.get(first)!.fail(new ApiError(429, 'font_rate_limited', 'x', { retryAfter: 5 }));
    pending.delete(first);
    await flush();
    expect(calls.length).toBe(6); // nothing new starts while paused
    now += 5000;
    for (const t of timers.filter((x) => x.at <= now)) t.fn();
    expect(calls.length).toBe(7);
    expect(calls[6]).toBe(first); // asked again after the pause
  });

  it("a closed note's queued requests are dropped; one in flight finishes (as before the loader was shared)", async () => {
    const l = makeLoader();
    const note = new FontSession({ loader: l, max: NOTE_FONTS_MAX });
    note.want(ids(10));
    expect(pending.size).toBe(6);
    note.close();
    await finishAll();
    expect(calls.length).toBe(6);
  });
});

describe('the sample renderer', () => {
  const full: StyleSettings = { font: 'lora', size: 96, bold: true, italic: true, underline: true, strike: true, textColor: 'ruby', highlight: 'topaz' };
  const plain: StyleSettings = { font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null };

  it('nests the elements the editor produces, caps the size, and uses no inline style', async () => {
    makeLoader();
    const v = await render(
      <SampleFontsProvider>
        <StyleSample style={full} text="Callout" cap={20} />
        <StyleSample style={plain} text="Plain" />
      </SampleFontsProvider>,
    );
    const [a, b] = [...v.container.querySelectorAll('.style-sample')];
    expect(a.innerHTML).toBe(
      '<span data-font="lora"><span data-font-size="20"><span data-text-color="ruby"><mark data-highlight="topaz"><strong><em><u><s>Callout</s></u></em></strong></mark></span></span></span>',
    );
    expect(b.innerHTML).toBe('<span data-font-size="16">Plain</span>');
    expect(v.container.querySelector('[style]')).toBeNull();
    // The font goes through the shared loader; the [data-font] rule is written.
    expect(calls).toEqual(['lora']);
    expect(fontRulesText()).toContain('[data-font="lora"]');
    await v.unmount();
  });

  it('shows the text in the fallback until the font is ready, and if it fails', async () => {
    makeLoader();
    const v = await render(
      <SampleFontsProvider>
        <StyleSample style={{ ...plain, font: 'caveat' }} text="Hand" />
      </SampleFontsProvider>,
    );
    expect(v.container.textContent).toBe('Hand');
    pending.get('caveat')!.fail(new Error('down'));
    await settle();
    expect(v.container.textContent).toBe('Hand');
    expect(registeredFamilies()).toEqual([]);
    await v.unmount();
  });
});
