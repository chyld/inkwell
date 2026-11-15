export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function relativeTime(isoString: string | null): string {
  if (!isoString) return '';
  const t = new Date(isoString).getTime();
  const diff = Date.now() - t;
  const min = 60_000;
  if (diff < min) return 'just now';
  if (diff < 60 * min) return `${Math.floor(diff / min)} min ago`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} h ago`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Split text into pieces, marking those that match a search word (prefix match, case and accents ignored). */
export function highlightPieces(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query
    .split(/\s+/)
    .map((w) => fold(w.replace(/^["']+|["']+$/g, '')))
    .filter((w) => w.length > 0);
  if (!words.length || !text) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const re = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu;
  for (const m of text.matchAll(re)) {
    const piece = m[0];
    const f = fold(piece);
    const hit = /[\p{L}\p{N}]/u.test(piece) && words.some((w) => f.startsWith(fold(w.replace(/[^\p{L}\p{N}]/gu, '')) || '\u0000'));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += piece;
    else out.push({ text: piece, hit });
  }
  return out;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
