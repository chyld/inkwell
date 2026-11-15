// In-memory counting of failed sign-ins (SPEC 5):
// 5 per (username, client IP) and 20 per client IP, per 15 minutes.
// Attempts still being verified count too, so parallel guesses cannot get
// past the limits while the (slow) password check runs.
export const WINDOW_MS = 15 * 60 * 1000;
export const PER_PAIR = 5;
export const PER_IP = 20;

export interface Attempt {
  /** Call exactly once when the attempt is over. */
  finish(failed: boolean): void;
}

export class SignInLimiter {
  private failures = new Map<string, number[]>();
  private pending = new Map<string, number>();

  constructor(private now: () => number) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  private load(key: string): number {
    return this.recent(key).length + (this.pending.get(key) ?? 0);
  }

  private bump(key: string, by: number) {
    const n = (this.pending.get(key) ?? 0) + by;
    if (n > 0) this.pending.set(key, n);
    else this.pending.delete(key);
  }

  /** Reserve an attempt, or return null if the pair or the address is at its limit. */
  begin(username: string, ip: string): Attempt | null {
    const pair = `p:${username}\u0000${ip}`;
    const addr = `i:${ip}`;
    if (this.load(pair) >= PER_PAIR || this.load(addr) >= PER_IP) return null;
    this.bump(pair, 1);
    this.bump(addr, 1);
    let done = false;
    return {
      finish: (failed: boolean) => {
        if (done) return;
        done = true;
        this.bump(pair, -1);
        this.bump(addr, -1);
        if (failed) {
          const t = this.now();
          for (const key of [pair, addr]) {
            const list = this.recent(key);
            list.push(t);
            this.failures.set(key, list);
          }
          if (this.failures.size > 100_000) this.sweep();
        }
      },
    };
  }

  private sweep() {
    for (const key of [...this.failures.keys()]) this.recent(key);
  }
}
