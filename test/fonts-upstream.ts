// Recorded Google Fonts answers (test/fixtures/fonts/upstream, captured from the live service on
// 2026-11-15) behind a replaceable fetcher, and manual timers that move the test clock.
import fs from 'node:fs';
import path from 'node:path';
import { wantedFaces, type Fetcher, type UpstreamResponse } from '../src/server/fonts/upstream.js';
import { FONT_CATALOGUE, type FontEntry } from '../src/shared/fonts.js';
import type { Timers } from '../src/server/fonts/service.js';

const DIR = path.join(import.meta.dirname, 'fixtures/fonts/upstream');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  stylesheets: { name: string; url: string; userAgent: string; status: number }[];
  files: Record<string, { status: number; file: string; size: number }>;
};

export const recorded = {
  /** The recorded stylesheet for a name, e.g. "faces-lora". */
  css(name: string): string {
    return fs.readFileSync(path.join(DIR, `${name}.txt`), 'utf8');
  },
  url(name: string): string {
    return manifest.stylesheets.find((s) => s.name === name)!.url;
  },
  status(name: string): number {
    return manifest.stylesheets.find((s) => s.name === name)!.status;
  },
  /** Recorded font file URLs and their bytes. */
  files: new Map(Object.entries(manifest.files).map(([url, f]) => [url, fs.readFileSync(path.join(DIR, 'files', f.file))])),
};

const body = (buf: Buffer): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    yield buf;
  },
});

export type Answer = UpstreamResponse | 'hang' | 'network-error';
export type Route = (url: string) => Answer | Promise<Answer> | undefined;

/** A stand-in for Google: recorded answers by URL, overridable per test; every call is recorded. */
export class FakeUpstream {
  calls: { url: string; userAgent: string | undefined; headers: Record<string, string> }[] = [];
  running = 0;
  maxRunning = 0;
  route: Route | null = null;

  readonly fetcher: Fetcher = async (url, init) => {
    this.calls.push({ url, userAgent: init.headers['user-agent'], headers: init.headers });
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      const a = (await this.route?.(url)) ?? this.replay(url);
      if (a === 'network-error') throw new TypeError('fetch failed');
      if (a === 'hang') {
        await new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      }
      return a as UpstreamResponse;
    } finally {
      this.running--;
    }
  };

  replay(url: string): UpstreamResponse {
    const s = recordedStylesheet(url);
    if (s !== undefined) return { status: 200, body: body(Buffer.from(s)) };
    const f = recorded.files.get(url);
    if (f) return { status: 200, body: body(f) };
    return { status: 404, body: body(Buffer.from('not found')) };
  }

  static ok(text: string | Buffer): UpstreamResponse {
    return { status: 200, body: body(typeof text === 'string' ? Buffer.from(text) : text) };
  }

  static status(status: number): UpstreamResponse {
    return { status, body: body(Buffer.from('<!DOCTYPE html>error')) };
  }

  stylesheetCalls() {
    return this.calls.filter((c) => c.url.startsWith('https://fonts.googleapis.com/css2')).length;
  }
  fileCalls() {
    return this.calls.filter((c) => c.url.startsWith('https://fonts.gstatic.com/')).length;
  }
}

function recordedStylesheet(url: string): string | undefined {
  const s = manifest.stylesheets.find((x) => x.url === url && x.userAgent === 'modern' && x.status === 200 && !x.name.startsWith('fact-'));
  return s ? recorded.css(s.name) : undefined;
}

/** Timers driven by the test: advance() moves the shared clock and fires what is due. */
export class ManualTimers implements Timers {
  private seq = 0;
  private pending: { id: number; due: number; fn: () => void }[] = [];
  constructor(private clock: { t: number }) {}

  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.pending.push({ id, due: this.clock.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.pending = this.pending.filter((p) => p.id !== h);
  }
  /** Move time forward in 100 ms steps, firing due timers and letting promises settle in between. */
  async advance(ms: number) {
    const end = this.clock.t + ms;
    while (this.clock.t < end) {
      this.clock.t = Math.min(end, this.clock.t + 100);
      for (const p of [...this.pending].sort((a, b) => a.due - b.due)) {
        if (p.due <= this.clock.t && this.pending.includes(p)) {
          this.pending = this.pending.filter((x) => x !== p);
          p.fn();
        }
      }
      await flush();
    }
  }
}

/** Advance test time until `p` settles (at most `maxMs`), returning when it did. */
export async function advanceUntil<T>(timers: ManualTimers, clock: { t: number }, p: Promise<T>, maxMs: number): Promise<{ value: T; at: number }> {
  let done: { value: T; at: number } | null = null;
  void p.then((value) => (done = { value, at: clock.t }));
  const end = clock.t + maxMs;
  while (!done && clock.t < end) await timers.advance(100);
  await flush();
  if (!done) throw new Error(`did not settle within ${maxMs} ms of test time`);
  return done;
}

/** Wait (in real time, a few seconds at most) until `cond` holds. */
export async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

/** Let pending promise callbacks run. */
export async function flush(times = 20) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

/** A valid-looking WOFF2 file of a given size (signature, then filler). */
export function woff2(size: number, fill = 0): Buffer {
  const b = Buffer.alloc(size, fill);
  b.write('wOF2', 0, 'latin1');
  return b;
}


/**
 * A synthetic Google for any catalogue family: a valid stylesheet with a latin and a latin-ext block
 * per requested face, and WOFF2 files whose size and sharing tests choose. Font ids are recovered
 * from the family name in the URL.
 */
export class SyntheticGoogle {
  /** Bytes of each family's files (default 1000). */
  size = new Map<string, number>();
  /** Families whose files are the same bytes as another family's (a shared file). */
  sameFileAs = new Map<string, string>();
  /** Extra latin blocks per face, to make an operation with many files. */
  extraFiles = new Map<string, number>();

  familyOf(url: string): FontEntry | undefined {
    const m = /[?&]family=([^:&]+)/.exec(url);
    if (!m) return undefined;
    const family = decodeURIComponent(m[1].replace(/\+/g, ' '));
    return fontByFamily.get(family);
  }

  stylesheet(f: FontEntry, preview: boolean): string {
    const src = (n: string) => `https://fonts.gstatic.com/s/${this.fileKey(f)}/${n}.woff2`;
    const blockOf = (style: string, weight: number, slice: string, file: string, range = true) =>
      `/* ${slice} */\n@font-face {\n  font-family: '${f.family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  src: url(${src(file)}) format('woff2');\n${range ? '  unicode-range: U+0000-00FF;\n' : ''}}\n`;
    if (preview) return blockOf('normal', f.regular, '', 'preview', false).replace('/*  */\n', '');
    const out: string[] = [];
    for (const face of wantedFaces(f)) {
      const style = face.italic ? 'italic' : 'normal';
      const key = `${style}-${face.weight}`;
      out.push(blockOf(style, face.weight, 'cyrillic', `${key}-cyrillic`)); // never downloaded
      out.push(blockOf(style, face.weight, 'latin', `${key}-latin`));
      out.push(blockOf(style, face.weight, 'latin-ext', `${key}-latin-ext`));
      for (let i = 0; i < (this.extraFiles.get(f.id) ?? 0); i++) out.push(blockOf(style, face.weight, 'latin', `${key}-extra${i}`));
    }
    return out.join('');
  }

  private fileKey(f: FontEntry) {
    return this.sameFileAs.get(f.id) ?? f.id;
  }

  /** Answer a URL, or undefined if it is not one of ours. */
  answer(url: string): UpstreamResponse | undefined {
    if (url.startsWith('https://fonts.googleapis.com/css2?')) {
      const f = this.familyOf(url);
      if (!f) return FakeUpstream.status(400);
      return FakeUpstream.ok(this.stylesheet(f, url.includes('&text=')));
    }
    const m = /^https:\/\/fonts\.gstatic\.com\/s\/([a-z0-9-]+)\/([a-z0-9-]+)\.woff2$/.exec(url);
    if (m) {
      const id = m[1];
      // Each file distinct by its name (and family), unless families share a key.
      const seed = [...`${id}/${m[2]}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const buf = woff2(this.size.get(id) ?? 1000, seed % 251);
      buf.write(`${id}/${m[2]}`.padEnd(40).slice(0, 40), 4, 'latin1');
      return FakeUpstream.ok(buf);
    }
    return undefined;
  }
}

const fontByFamily = new Map<string, FontEntry>(FONT_CATALOGUE.map((f) => [f.family, f]));
