// The /fonts page (FONTS-SPEC 7): browse the catalogue snapshot, keep a private collection of at
// most 50. The grid is virtualised by rows and previews load progressively through the shared loader.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus, X } from 'lucide-react';
import { COLLECTION_MAX, FONT_CATALOGUE, fontById, type FontCategory } from '../../shared/fonts';
import { api, ApiError } from '../api';
import { usePreviews } from '../fonts/previews';
import { ROW_HEIGHT, rowsToRender } from '../fonts/grid';
import { FONTS_TITLE, APP_TITLE } from '../route';
import { useDialogs } from './Dialogs';

const CATEGORIES: { value: '' | FontCategory; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'serif', label: 'Serif' },
  { value: 'sans-serif', label: 'Sans serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Handwriting' },
  { value: 'monospace', label: 'Monospace' },
];

/** Every family in alphabetical order (retired ones are filtered out when matching). */
export const AVAILABLE = [...FONT_CATALOGUE].sort((a, b) => a.family.localeCompare(b.family, 'en', { sensitivity: 'base' }) || (a.family < b.family ? -1 : 1));

/** Families shown on the page: never retired ones; the search matches anywhere in the name, ignoring case. */
export function matchFonts(search: string, category: '' | FontCategory) {
  const q = search.trim().toLowerCase();
  return AVAILABLE.filter((f) => !f.retired && (!category || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
}

/** T in "N of T": the number of non-retired families. */
export const availableCount = () => AVAILABLE.filter((f) => !f.retired).length;

export function FontsPage({ onBack }: { onBack: () => void }) {
  const dialogs = useDialogs();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'' | FontCategory>('');
  const [collection, setCollection] = useState<string[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ scrollTop: 0, height: 0, width: 0 });
  const [focused, setFocused] = useState<number | null>(null);
  const total = useMemo(availableCount, []); // the whole catalogue: counted once per opening, not per render
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = FONTS_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api<string[]>('GET', '/fonts/collection').then(
      (ids) => alive && setCollection(Array.isArray(ids) ? ids : []),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const matching = useMemo(() => matchFonts(search, category), [search, category]);

  // The viewport of the scrolling area and the grid's width, measured on scroll and resize.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    const grid = gridRef.current;
    if (!el || !grid) return;
    const scrollTop = Math.max(0, el.scrollTop - grid.offsetTop);
    setView((v) => (v.scrollTop === scrollTop && v.height === el.clientHeight && v.width === grid.clientWidth ? v : { scrollTop, height: el.clientHeight, width: grid.clientWidth }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    el?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro && el) ro.observe(el);
    return () => {
      el?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [measure]);
  // A new search or category starts at the top (and empties the loading queue).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && gridRef.current && el.scrollTop > gridRef.current.offsetTop) el.scrollTop = gridRef.current.offsetTop;
    setFocused(null);
    measure();
  }, [search, category, measure]);

  const range = rowsToRender(view.scrollTop, view.height, view.width, matching.length);
  const rows: number[] = [];
  for (let r = range.first; r <= range.last; r++) rows.push(r);
  // A card with keyboard focus stays rendered.
  if (focused !== null && focused < matching.length) {
    const fr = Math.floor(focused / range.columns);
    if (!rows.includes(fr)) rows.push(fr);
  }
  rows.sort((a, b) => a - b);
  const renderedIds = rows.flatMap((r) => matching.slice(r * range.columns, (r + 1) * range.columns).map((f) => f.id));

  const chipIds = collection.filter((id) => fontById(id));
  const chipStyle = usePreviews('chips', chipIds);
  const cardStyle = usePreviews('grid', renderedIds);

  async function toggle(id: string) {
    const inCollection = collection.includes(id);
    setBusy((b) => new Set(b).add(id));
    try {
      if (inCollection) {
        await api('DELETE', `/fonts/collection/${id}`);
        setCollection((c) => c.filter((x) => x !== id));
      } else {
        await api('PUT', `/fonts/collection/${id}`);
        setCollection((c) => (c.includes(id) ? c : [...c, id]));
      }
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <section className="fonts-page" aria-label="Fonts">
      <div className="fonts-scroll" ref={scrollRef}>
        <header className="fonts-header">
          <button className="icon-button mobile-only" onClick={onBack} aria-label="Back to notes" title="Back to notes">
            <ChevronLeft />
          </button>
          <h2>Fonts</h2>
        </header>
        <div className="fonts-controls">
          <input type="search" placeholder="Search fonts" aria-label="Search fonts" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as '' | FontCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="fonts-count" role="status" aria-live="polite">
            {matching.length} of {total}
          </p>
        </div>
        <div className="fonts-collection" aria-label="Your fonts">
          <span className="fonts-collection-count">
            {chipIds.length} of {COLLECTION_MAX}
          </span>
          {chipIds.length === 0 && <span className="fonts-collection-empty">No fonts yet. Add some from the list below.</span>}
          {chipIds.map((id) => {
            const f = fontById(id)!;
            return (
              <span key={id} className="font-chip" data-font-id={id}>
                <span className="font-chip-name" style={chipStyle(id)}>
                  {f.family}
                </span>
                <button className="chip-x" aria-label={`Remove ${f.family}`} title={`Remove ${f.family}`} disabled={busy.has(id)} onClick={() => void toggle(id)}>
                  <X />
                </button>
              </span>
            );
          })}
        </div>
        <div className="fonts-grid" ref={gridRef} role="list" aria-label="Google Fonts" style={{ height: range.rowCount * ROW_HEIGHT }}>
          {rows.map((r) => (
            <div key={r} className="fonts-row" style={{ top: r * ROW_HEIGHT, gridTemplateColumns: `repeat(${range.columns}, minmax(0, 1fr))` }}>
              {matching.slice(r * range.columns, (r + 1) * range.columns).map((f, i) => {
                const index = r * range.columns + i;
                const selected = collection.includes(f.id);
                return (
                  <div
                    key={f.id}
                    className={'font-card' + (selected ? ' selected' : '')}
                    role="listitem"
                    aria-setsize={matching.length}
                    aria-posinset={index + 1}
                    data-font-id={f.id}
                    onFocus={() => setFocused(index)}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused((x) => (x === index ? null : x));
                    }}
                  >
                    <span className="font-card-name" style={cardStyle(f.id)}>
                      {f.family}
                    </span>
                    <button
                      className={selected ? 'btn font-card-button selected' : 'btn font-card-button'}
                      aria-label={`${selected ? 'Remove' : 'Add'} ${f.family}`}
                      title={`${selected ? 'Remove' : 'Add'} ${f.family}`}
                      disabled={busy.has(f.id)}
                      onClick={() => void toggle(f.id)}
                    >
                      {selected ? <X /> : <Plus />}
                      <span>{selected ? 'Remove' : 'Add'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
