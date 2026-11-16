// The style form (STYLES-SPEC 7): one dialog wherever a style is created or edited. Its controls hold
// plain values until Save; they look and behave like the toolbar's.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Baseline, Bold, Highlighter, Italic, Minus, Plus, Strikethrough, Underline } from 'lucide-react';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, HIGHLIGHT_COLORS, TEXT_COLORS } from '../../shared/noteRules';
import { api, ApiError } from '../api';
import { ColorMenu } from './ColorPicker';
import { FontMenu } from './FontPicker';
import { SampleFontsProvider, StyleSample, useSampleFonts, type StyleSettings } from './StyleSample';

export interface Style extends StyleSettings {
  id: string;
  name: string;
}
export type StyleDraft = StyleSettings & { name: string };

export const NEW_STYLE: StyleDraft = { name: '', font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null };
export const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog';

interface Props {
  /** The style being edited, or a new style's starting values. */
  initial: StyleDraft;
  id?: string;
  title: string;
  onSaved: (s: Style) => void;
  onClose: () => void;
  onBrowseFonts: () => void;
}

export function StyleForm(props: Props) {
  return (
    <SampleFontsProvider>
      <StyleFormBody {...props} />
    </SampleFontsProvider>
  );
}

function StyleFormBody({ initial, id, title, onSaved, onClose, onBrowseFonts }: Props) {
  const [v, setV] = useState<StyleDraft>(initial);
  const [sizeText, setSizeText] = useState(String(initial.size));
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const nameErrId = useId();
  const fonts = useSampleFonts();
  const set = <K extends keyof StyleDraft>(k: K, value: StyleDraft[K]) => setV((x) => ({ ...x, [k]: value }));

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setSize(n: number) {
    const c = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
    set('size', c);
    setSizeText(String(c));
  }

  async function save() {
    setNameError(null);
    setFormError(null);
    setSaving(true);
    try {
      const body = { name: v.name, font: v.font, size: v.size, bold: v.bold, italic: v.italic, underline: v.underline, strike: v.strike, textColor: v.textColor, highlight: v.highlight };
      const s = id ? await api<Style>('PUT', `/styles/${id}`, body) : await api<Style>('POST', '/styles', body);
      onSaved(s);
      onClose();
    } catch (e) {
      // The dialog stays open: name problems under Name, everything else above the buttons.
      if (e instanceof ApiError && (e.code === 'name_taken' || e.code === 'invalid_name')) {
        setNameError(e.message);
        nameRef.current?.focus();
      } else setFormError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  const toggle = (k: 'bold' | 'italic' | 'underline' | 'strike', label: string, icon: ReactNode) => (
    <button type="button" className={'tb' + (v[k] ? ' active' : '')} aria-label={label} title={label} aria-pressed={v[k]} onClick={() => set(k, !v[k])}>
      {icon}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal style-form" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) void save();
          }}
        >
          <label className="field">
            <span>Name</span>
            <input ref={nameRef} value={v.name} maxLength={200} onChange={(e) => set('name', e.target.value)} aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? nameErrId : undefined} />
          </label>
          {nameError && (
            <p className="field-error" id={nameErrId} role="alert">
              {nameError}
            </p>
          )}
          <div className="style-form-row" role="group" aria-label="Formatting">
            <FontMenu
              state={v.font ? { kind: 'one', id: v.font } : { kind: 'none' }}
              disabled={false}
              listCurrent
              refocusAfterChoose
              onBrowse={() => {
                onClose();
                onBrowseFonts();
              }}
              onChoose={(f) => {
                set('font', f);
                if (f) fonts?.retry(f); // the font changed: ask for its faces again if they failed before
                return true;
              }}
            />
            <span className="tb-sep" aria-hidden />
            <div className="tb-group size-group" role="group" aria-label="Font size">
              <button type="button" className="tb" aria-label="Decrease font size" title="Decrease font size" disabled={v.size <= FONT_SIZE_MIN} onClick={() => setSize(v.size - 1)}>
                <Minus />
              </button>
              <input
                className="size-input"
                type="text"
                inputMode="numeric"
                aria-label="Font size"
                title="Font size"
                maxLength={2}
                value={sizeText}
                onChange={(e) => {
                  // A whole number in range takes effect as it is typed.
                  setSizeText(e.target.value);
                  const t = e.target.value.trim();
                  if (/^[0-9]{1,2}$/.test(t) && Number(t) >= FONT_SIZE_MIN && Number(t) <= FONT_SIZE_MAX) set('size', Number(t));
                }}
                onBlur={() => setSizeText(String(v.size))} // anything else: the last good value back
              />
              <button type="button" className="tb" aria-label="Increase font size" title="Increase font size" disabled={v.size >= FONT_SIZE_MAX} onClick={() => setSize(v.size + 1)}>
                <Plus />
              </button>
            </div>
            <span className="tb-sep" aria-hidden />
            <div className="tb-group">
              {toggle('bold', 'Bold', <Bold />)}
              {toggle('italic', 'Italic', <Italic />)}
              {toggle('underline', 'Underline', <Underline />)}
              {toggle('strike', 'Strikethrough', <Strikethrough />)}
            </div>
            <div className="tb-group">
              <ColorMenu kind="textColor" colors={TEXT_COLORS} current={v.textColor} onPick={(c) => set('textColor', c)} label="Text colour" removeLabel="No text colour" removeText="None" icon={<Baseline />} disabled={false} refocusAfterPick />
              <ColorMenu kind="highlight" colors={HIGHLIGHT_COLORS} current={v.highlight} onPick={(c) => set('highlight', c)} label="Highlight" removeLabel="No highlight" removeText="None" icon={<Highlighter />} disabled={false} refocusAfterPick />
            </div>
          </div>
          <div className="style-preview" aria-label="Preview">
            <StyleSample style={v} text={PREVIEW_TEXT} />
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
