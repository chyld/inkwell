// The editor's Styles menu (STYLES-SPEC 8): the user's styles drawn as samples; choosing one applies it.
// The button shows the name of the style whose eight settings the text at the cursor or in the selection has
// (DEVIATIONS 43); text keeps no record of a style, so this is found by matching.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';
import { applyStyle, styleFromText, styleIndex, styleState } from '../styleApply';
import { ApiError } from '../api';
import { refreshStyles, useStyles, useStylesLoaded } from '../stylesStore';
import { NOTE_FONTS_REFUSED } from './FontPicker';
import { listKeys, runKey, usePopoverMenu } from './popoverMenu';
import { StyleForm, type Style, type StyleDraft } from './StyleForm';
import { SampleFontsProvider, StyleSample } from './StyleSample';

interface Props {
  editor: Editor;
  notice: (message: string) => void;
  onManage: () => void;
  onBrowseFonts: () => void;
}

export const MENU_SAMPLE_CAP = 20;

export function StylesMenu({ editor, notice, onManage, onBrowseFonts }: Props) {
  const styles = useStyles();
  const loaded = useStylesLoaded();
  const [form, setForm] = useState<StyleDraft | null>(null);
  const m = usePopoverMenu({ placementDeps: [styles] });
  const { open, close, place } = m;
  const list = styles ?? [];
  const count = list.length + 2; // the styles, "Save selection as style…", "Manage styles…"
  // Read through a selector: the button re-renders only when whether styles can be used, or which one matches,
  // changes (not on every keystroke); one walk over the selection gives both.
  const index = useMemo(() => styleIndex(list), [list]);
  const { enabled, match } = useEditorState({ editor, selector: ({ editor }) => styleState(editor, index) });
  // By id in the current list: the selector keeps an equal earlier result, whose style object may be from an
  // earlier fetch of the same list.
  const currentIdx = match.kind === 'one' ? list.findIndex((s) => s.id === match.style.id) : -1;
  const label = currentIdx >= 0 ? list[currentIdx].name : match.kind === 'mixed' ? 'Mixed' : 'Styles';
  const name = match.kind === 'none' ? 'Styles' : `Style: ${label}`;

  // The styles: when the editor mounts (so the name shows before the menu is opened) and fresh each time it opens.
  useEffect(() => {
    void refreshStyles();
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void refreshStyles().then((e) => {
      if (e && alive) notice(`Your styles could not be loaded: ${e instanceof ApiError ? e.message : 'could not reach the server.'}`);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus goes into the menu once the styles have loaded (so a quick Enter cannot pick the wrong entry): on the
  // current style if there is one. Only once per opening, so a refreshed list does not move the focus.
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (styles === null || focused.current) return;
    focused.current = true;
    m.focusItem(currentIdx >= 0 ? currentIdx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, styles]);
  // The list scrolls to the current style once the menu has its height.
  useLayoutEffect(() => {
    if (open && place && currentIdx >= 0) m.itemsRef.current[currentIdx]?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place]);

  function choose(s: Style) {
    const r = applyStyle(editor, s);
    if (r === 'too-many-fonts') {
      close(true);
      notice(NOTE_FONTS_REFUSED);
      return;
    }
    close(false);
    editor.commands.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    // Enter and Space activate the focused entry here, with the key's default cancelled: left to the browser,
    // the click would move the focus to the note and the same Enter would then split the text there.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      m.itemsRef.current[m.focusIdx]?.click();
      return;
    }
    runKey(e, listKeys(m, count));
  }

  const item = (i: number, content: ReactNode, onClick: () => void, className = 'font-item', extra: Record<string, unknown> = {}) => (
    <button key={i} {...m.itemProps(i)} type="button" className={className} onClick={onClick} {...extra}>
      {content}
    </button>
  );

  return (
    <span className="color-tool styles-tool" ref={m.wrapRef}>
      <button {...m.buttonProps} type="button" className={'tb styles-button' + (open ? ' active' : '')} title={name} aria-label={name} aria-haspopup="true" disabled={!enabled}>
        <span className="font-button-label">{label}</span>
        <ChevronDown />
      </button>
      {open && (
        <SampleFontsProvider>
          <div {...m.popoverProps} className={'font-popover styles-popover' + (place?.above ? ' above' : '')} role="group" aria-label="Styles" onKeyDown={onKeyDown}>
            {/* The styles scroll on their own; each row keeps its height. The two entries stay below, always visible. */}
            <div className="menu-scroll">
              {loaded && list.length === 0 && <p className="font-empty">No styles yet</p>}
              {list.map((s, i) =>
                item(i, <StyleSample style={s} text={s.name} cap={MENU_SAMPLE_CAP} />, () => choose(s), 'font-item style-item', { 'aria-pressed': i === currentIdx }),
              )}
            </div>
            <div className="menu-footer">
            {item(
              list.length,
              'Save selection as style…',
              () => {
                const from = styleFromText(editor);
                close(false);
                setForm({ ...from, name: '' });
              },
              'font-item font-browse',
            )}
            {item(list.length + 1, 'Manage styles…', () => {
              close(false);
              onManage();
            })}
            </div>
          </div>
        </SampleFontsProvider>
      )}
      {/* Saving creates the style and changes nothing in the note: there is nothing more to do here. */}
      {form && <StyleForm initial={form} title="New style" onClose={() => setForm(null)} onSaved={() => void refreshStyles()} onBrowseFonts={onBrowseFonts} />}
    </span>
  );
}
