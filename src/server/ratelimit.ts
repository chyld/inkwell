// In-memory counting of failed sign-ins (SPEC 5):
// 5 per (username, client IP) and 20 per client IP, per 15 minutes.
export const WINDOW_MS = 15 * 60 * 1000;
export const PER_PAIR = 5;
export const PER_IP = 20;

export class SignInLimiter {
  private failures = new Map<string, number[]>();

  constructor(private now: () => number) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isBlocked(username: string, ip: string): boolean {
    return this.recent(`p:${username}\u0000${ip}`).length >= PER_PAIR || this.recent(`i:${ip}`).length >= PER_IP;
  }

  recordFailure(username: string, ip: string): void {
    const t = this.now();
    for (const key of [`p:${username}\u0000${ip}`, `i:${ip}`]) {
      const list = this.recent(key);
      list.push(t);
      this.failures.set(key, list);
    }
    if (this.failures.size > 100_000) this.sweep();
  }

  private sweep() {
    for (const key of [...this.failures.keys()]) this.recent(key);
  }
}
