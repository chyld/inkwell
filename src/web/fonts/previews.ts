// Progressive preview loading (FONTS-SPEC 7): one loader, one queue and one limit for the /fonts
// grid, the collection chips and the editor's font menu. Previews are registered under private
// names (preview-<id>), never the family name, so a preview can never draw note text.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FONT_HASH_RE, FONT_ID_RE, fallbackFamily, fontById } from '../../shared/fonts';
import { api, ApiError } from '../api';
import { fileUrl, fontEnv, onFontsCleared, type FontFaceLike } from './runtime';

export const PREVIEW_CONCURRENCY = 6;
export const MAX_REGISTERED_PREVIEWS = 400;

export interface PreviewDeps {
  /** GET /api/fonts/preview/:id → the file hash. A 429 is an ApiError with extra.retryAfter (seconds). */
  fetchPreview(id: string): Promise<string>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

const realDeps: PreviewDeps = {
  fetchPreview: async (id) => (await api<{ file: string }>('GET', `/fonts/preview/${id}`)).file,
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

export class PreviewLoader {
  private loaded = new Map<string, { face: FontFaceLike; lastRendered: number }>();
  private loading = new Set<string>();
  /** Failed while rendered: a candidate again only after it has left the rendered rows. */
  private failed = new Set<string>();
  /** What each source (grid, chips, menu) renders now, top to bottom. */
  private sources = new Map<string, string[]>();
  private pausedUntil = 0;
  private tick = 0;
  private listeners = new Set<() => void>();
  /** For tests: the most previews seen loading at once. */
  maxLoading = 0;

  constructor(private deps: PreviewDeps = realDeps) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private notify() {
    for (const l of [...this.listeners]) l();
  }

  isLoaded(id: string) {
    return this.loaded.has(id);
  }
  get registeredCount() {
    return this.loaded.size;
  }

  /** The rendered ids of one source, top to bottom. Ids no longer rendered leave the queue. */
  setRendered(source: string, ids: string[]) {
    this.tick++;
    const valid = ids.filter((id) => FONT_ID_RE.test(id) && fontById(id));
    if (valid.length) this.sources.set(source, valid);
    else this.sources.delete(source);
    const rendered = this.renderedSet();
    for (const id of valid) {
      const l = this.loaded.get(id);
      if (l) l.lastRendered = this.tick;
    }
    for (const id of [...this.failed]) if (!rendered.has(id)) this.failed.delete(id);
    this.pump();
  }

  private renderedSet() {
    const s = new Set<string>();
    for (const ids of this.sources.values()) for (const id of ids) s.add(id);
    return s;
  }

  /** Candidates: rendered ids without a loaded preview, top to bottom (sources in the order they registered). */
  candidates(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const ids of this.sources.values()) {
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!this.loaded.has(id) && !this.loading.has(id) && !this.failed.has(id)) out.push(id);
      }
    }
    return out;
  }

  private pump() {
    if (this.deps.now() < this.pausedUntil) return;
    for (const id of this.candidates()) {
      if (this.loading.size >= PREVIEW_CONCURRENCY) break;
      void this.load(id);
    }
  }

  private async load(id: string) {
    this.loading.add(id);
    this.maxLoading = Math.max(this.maxLoading, this.loading.size);
    let face: FontFaceLike | null = null;
    const e = fontEnv();
    try {
      const hash = await this.deps.fetchPreview(id);
      if (!FONT_HASH_RE.test(hash) || !e) throw new Error('unusable');
      face = new e.FontFace(`preview-${id}`, fileUrl(hash), { display: 'swap' });
      e.fonts.add(face);
      await face.load();
      this.loaded.set(id, { face, lastRendered: this.tick });
      this.releaseBeyondLimit();
    } catch (err) {
      if (face && e) e.fonts.delete(face);
      if (err instanceof ApiError && err.status === 429) {
        // Pause all loading until the time given; the card stays a candidate.
        const s = Number(err.extra.retryAfter);
        const ms = (Number.isFinite(s) && s > 0 ? s : 1) * 1000;
        this.pausedUntil = Math.max(this.pausedUntil, this.deps.now() + ms);
        this.deps.setTimeout(() => this.pump(), ms);
      } else this.failed.add(id);
    } finally {
      this.loading.delete(id);
      this.notify();
      this.pump();
    }
  }

  /** Beyond 400 registered previews, the least recently rendered are released (and load again when rendered next). */
  private releaseBeyondLimit() {
    if (this.loaded.size <= MAX_REGISTERED_PREVIEWS) return;
    const e = fontEnv();
    const order = [...this.loaded.entries()].sort((a, b) => a[1].lastRendered - b[1].lastRendered);
    for (const [id, l] of order.slice(0, this.loaded.size - MAX_REGISTERED_PREVIEWS)) {
      this.loaded.delete(id);
      e?.fonts.delete(l.face);
    }
  }

  /** Sign-out: every preview face is removed. */
  reset() {
    const e = fontEnv();
    for (const l of this.loaded.values()) e?.fonts.delete(l.face);
    this.loaded.clear();
    this.loading.clear();
    this.failed.clear();
    this.sources.clear();
    this.pausedUntil = 0;
    this.notify();
  }
}

let shared = new PreviewLoader();
onFontsCleared(() => shared.reset());

export function previewLoader() {
  return shared;
}
/** For tests: a loader with stand-in dependencies. */
export function setPreviewLoader(l: PreviewLoader) {
  shared = l;
}

/** The CSS font-family for a name: its preview face when loaded, otherwise the fallback (never blank). */
export function previewFamily(id: string, loaded: boolean): string {
  const f = fontById(id);
  const fallback = f ? fallbackFamily(f.category) : 'sans-serif';
  return loaded && FONT_ID_RE.test(id) ? `"preview-${id}", ${fallback}` : fallback;
}

const noSubscription = () => () => {};

/**
 * Register what a component renders with the shared loader. It re-renders only when one of its own ids loads or
 * is released (not on every completion), and not at all while inactive (a closed menu).
 */
export function usePreviews(source: string, ids: string[], active = true) {
  const loader = previewLoader();
  const key = ids.join(',');
  const loadedKey = useSyncExternalStore(active ? loader.subscribe : noSubscription, () => (active ? ids.filter((id) => loader.isLoaded(id)).join(',') : ''));
  useEffect(() => {
    if (!active) return;
    loader.setRendered(source, ids);
    return () => loader.setRendered(source, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, source, key, active]);
  return useMemo(() => (id: string) => ({ fontFamily: previewFamily(id, loader.isLoaded(id)) }), [loader, loadedKey]);
}
