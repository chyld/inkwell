// The /styles page (STYLES-SPEC 9): every style as a card with its settings; create, edit, delete.
import { useEffect, useState } from 'react';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_FONT_FAMILY, fontById } from '../../shared/fonts';
import { api, ApiError, type Style, type StyleDraft } from '../api';
import { APP_TITLE, STYLES_TITLE } from '../route';
import { useDialogs } from './Dialogs';
import { NEW_STYLE, StyleForm } from './StyleForm';
import { SampleFontsProvider, StyleSample } from './StyleSample';
import { refreshStyles, useStyles } from '../stylesStore';

export const STYLES_MAX = 50;
export const STYLES_FULL = `You can keep at most ${STYLES_MAX} styles. Delete one to add another.`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The chips of a card, in the stated order. */
export function styleChips(s: Style): { key: string; text: string; dot?: { attr: 'data-text-color' | 'data-highlight'; value: string } }[] {
  const out: ReturnType<typeof styleChips> = [
    { key: 'font', text: s.font ? (fontById(s.font)?.family ?? s.font) : DEFAULT_FONT_FAMILY },
    { key: 'size', text: `${s.size} px` },
  ];
  if (s.bold) out.push({ key: 'bold', text: 'Bold' });
  if (s.italic) out.push({ key: 'italic', text: 'Italic' });
  if (s.underline) out.push({ key: 'underline', text: 'Underline' });
  if (s.strike) out.push({ key: 'strike', text: 'Strikethrough' });
  if (s.textColor) out.push({ key: 'color', text: cap(s.textColor), dot: { attr: 'data-text-color', value: s.textColor } });
  if (s.highlight) out.push({ key: 'highlight', text: `${cap(s.highlight)} highlight`, dot: { attr: 'data-highlight', value: s.highlight } });
  return out;
}

export function StylesPage({ onBack, onBrowseFonts }: { onBack: () => void; onBrowseFonts: () => void }) {
  const dialogs = useDialogs();
  // The shared list (stylesStore): the editor's Styles button matches against the same one.
  const styles = useStyles();
  const [form, setForm] = useState<{ initial: StyleDraft; id?: string; title: string } | null>(null);

  useEffect(() => {
    document.title = STYLES_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, []);

  async function load() {
    const e = await refreshStyles();
    if (e) dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = styles ?? [];
  const full = list.length >= STYLES_MAX;

  function newStyle() {
    if (full) return; // stays focusable, does nothing
    setForm({ initial: NEW_STYLE, title: 'New style' });
  }

  async function remove(s: Style) {
    const ok = await dialogs.confirm({ title: `Delete “${s.name}”?`, message: 'Text you already styled keeps its formatting.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/styles/${s.id}`);
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
    }
    await load();
  }

  const newButton = (
    <button className="btn primary" aria-disabled={full || undefined} onClick={newStyle}>
      <Plus /> New style
    </button>
  );

  return (
    <section className="browse-page styles-page" aria-label="Styles">
      <div className="browse-scroll styles-scroll">
        <header className="browse-header styles-header">
          <button className="icon-button mobile-only" onClick={onBack} aria-label="Back to notes" title="Back to notes">
            <ChevronLeft />
          </button>
          <h2>Styles</h2>
          <p className="browse-count styles-count" role="status" aria-live="polite">
            {styles === null ? '' : `${list.length} of ${STYLES_MAX}`}
          </p>
          {newButton}
          {full && <span className="styles-full">{STYLES_FULL}</span>}
        </header>
        {styles !== null && list.length === 0 && (
          <div className="styles-empty">
            <h3>No styles yet</h3>
            <p>A style is a saved set of text formatting you can apply with one click.</p>
            {newButton}
            <p>You can also select text in a note and choose Save selection as style.</p>
          </div>
        )}
        <SampleFontsProvider>
          <div className="styles-grid" role="list" aria-label="Your styles">
            {list.map((s) => (
              <div key={s.id} className="style-card" role="listitem" data-style-id={s.id}>
                <div className="style-card-name">
                  <StyleSample style={s} text={s.name} cap={28} />
                </div>
                <ul className="style-chips" aria-label="Settings">
                  {styleChips(s).map((c) => (
                    <li key={c.key} className="style-chip">
                      {c.dot && <span className={c.dot.attr === 'data-text-color' ? 'chip-dot' : 'chip-swatch'} {...{ [c.dot.attr]: c.dot.value }} aria-hidden />}
                      {c.text}
                    </li>
                  ))}
                </ul>
                <div className="style-card-actions">
                  <button className="btn" aria-label={`Edit ${s.name}`} onClick={() => setForm({ initial: s, id: s.id, title: 'Edit style' })}>
                    <Pencil /> Edit
                  </button>
                  <button className="btn" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>
                    <Trash2 /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SampleFontsProvider>
      </div>
      {form && <StyleForm initial={form.initial} id={form.id} title={form.title} onClose={() => setForm(null)} onSaved={() => void load()} onBrowseFonts={onBrowseFonts} />}
    </section>
  );
}
