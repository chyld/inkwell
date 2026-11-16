// The editor's Styles menu (STYLES-SPEC 8): the user's styles drawn as samples; choosing one applies it.
// The button shows the name of the style whose eight settings the text at the cursor or in the selection has
// (DEVIATIONS 43); text keeps no record of a style, so this is found by matching.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';
import { applyStyle, styleFromText, styleIndex, styleState } from '../styleApply';
import { refreshStyles, useStyles } from '../stylesStore';
import { NOTE_FONTS_REFUSED } from './FontPicker';
import { placementStyle, useMenuPlacement } from './menuPlacement';
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
  const [open, setOpen] = useState(false);
  const styles = useStyles();
  const [focusIdx, setFocusIdx] = useState(0);
  const [form, setForm] = useState<StyleDraft | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
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
    if (open) void refreshStyles();
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
    const start = currentIdx >= 0 ? currentIdx : 0;
    setFocusIdx(start);
    itemsRef.current[start]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, styles]);
  const place = useMenuPlacement(open, wrapRef, popRef, [styles]);
  // The list scrolls to the current style once the menu has its height.
  useLayoutEffect(() => {
    if (open && place && currentIdx >= 0) itemsRef.current[currentIdx]?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(refocusButton: boolean) {
    setOpen(false);
    if (refocusButton) buttonRef.current?.focus();
  }

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

  function move(to: number) {
    const i = (to + count) % count;
    setFocusIdx(i);
    itemsRef.current[i]?.focus();
    itemsRef.current[i]?.scrollIntoView?.({ block: 'nearest' });
  }

  function onKeyDown(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(focusIdx + 1),
      ArrowRight: () => move(focusIdx + 1),
      ArrowUp: () => move(focusIdx - 1),
      ArrowLeft: () => move(focusIdx - 1),
      Home: () => move(0),
      End: () => move(count - 1),
      Escape: () => close(true),
    };
    // Enter and Space activate the focused entry here, with the key's default cancelled: left to the browser,
    // the click would move the focus to the note and the same Enter would then split the text there.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      itemsRef.current[focusIdx]?.click();
      return;
    }
    const k = keys[e.key];
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      k();
    }
  }

  const item = (i: number, content: ReactNode, onClick: () => void, className = 'font-item', extra: Record<string, unknown> = {}) => (
    <button
      key={i}
      ref={(el) => {
        itemsRef.current[i] = el;
      }}
      type="button"
      className={className}
      tabIndex={i === focusIdx ? 0 : -1}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={() => setFocusIdx(i)}
      onClick={onClick}
      {...extra}
    >
      {content}
    </button>
  );

  return (
    <span className="color-tool styles-tool" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={'tb styles-button' + (open ? ' active' : '')}
        title={name}
        aria-label={name}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span className="font-button-label">{label}</span>
        <ChevronDown />
      </button>
      {open && (
        <SampleFontsProvider>
          <div
            id={popId}
            ref={popRef}
            className={'font-popover styles-popover' + (place?.above ? ' above' : '')}
            role="group"
            aria-label="Styles"
            style={placementStyle(place)}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
            }}
          >
            {/* The styles scroll on their own; each row keeps its height. The two entries stay below, always visible. */}
            <div className="menu-scroll">
              {styles !== null && list.length === 0 && <p className="font-empty">No styles yet</p>}
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
