// The one limit and the one pause for font requests (CLEANUP-PLAN pass 3 item 5). /preview requests (the preview
// loader) and /faces requests (the face loader) count against the same server rate bucket, so they share at most
// FONT_REQUEST_LIMIT in flight and a 429 pauses both. Each loader keeps its own order: previews top to bottom of
// what is on screen, faces first come, first served.
import { onFontsCleared } from './clearing';

export const FONT_REQUEST_LIMIT = 6;

export interface GateDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

export class FontRequestGate {
  private active = 0;
  private pausedUntil = 0;
  private wakers = new Set<() => void>();

  constructor(private deps: GateDeps) {}

  /** A loader's pump, called whenever a request finishes or a pause ends. */
  onWake(pump: () => void) {
    this.wakers.add(pump);
  }

  /** Whether one more request may start now. */
  canStart(): boolean {
    return this.deps.now() >= this.pausedUntil && this.active < FONT_REQUEST_LIMIT;
  }

  start() {
    this.active++;
  }

  finish() {
    this.active--;
    this.wake();
  }

  /** A 429: every font request waits for the time given (seconds; 1 when it is missing or unusable). */
  pause(retryAfter: unknown) {
    const s = Number(retryAfter);
    const ms = (Number.isFinite(s) && s > 0 ? s : 1) * 1000;
    this.pausedUntil = Math.max(this.pausedUntil, this.deps.now() + ms);
    this.deps.setTimeout(() => this.wake(), ms);
  }

  /** Sign-out: no pause carries over. Requests in flight still finish (and free their slot). */
  reset() {
    this.pausedUntil = 0;
  }

  private wake() {
    for (const w of [...this.wakers]) w();
  }
}

let shared: FontRequestGate | null = null;
/** The app's gate, shared by the preview and face loaders. */
export function fontRequests(): FontRequestGate {
  if (!shared) shared = new FontRequestGate({ now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) });
  return shared;
}
onFontsCleared(() => shared?.reset());
