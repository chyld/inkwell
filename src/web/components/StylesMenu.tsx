// The editor's Styles menu (STYLES-SPEC 8): the user's styles drawn as samples; choosing one applies it.
// The button always reads "Styles": text keeps no record of a style.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';
import { api } from '../api';
import { applyStyle, canUseStyles, styleFromText } from '../styleApply';
import { NOTE_FONTS_REFUSED } from './FontPicker';
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
  const [styles, setStyles] = useState<Style[] | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [shift, setShift] = useState(0);
  const [form, setForm] = useState<StyleDraft | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
  const enabled = canUseStyles(editor);
  const list = styles ?? [];
  const count = list.length + 2; // the styles, "Save selection as style…", "Manage styles…"

  // The styles, fresh each time the menu opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<Style[]>('GET', '/styles').then(
      (s) => alive && setStyles(Array.isArray(s) ? s : []),
      () => alive && setStyles((x) => x ?? []),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    setFocusIdx(0);
    itemsRef.current[0]?.focus();
    const r = popRef.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 8) setShift(Math.min(0, window.innerWidth - 8 - r.right));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, styles]);
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
    setShift(0);
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
    const k = keys[e.key];
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      k();
    }
  }

  const item = (i: number, content: ReactNode, onClick: () => void, className = 'font-item') => (
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
        title="Styles"
        aria-label="Styles"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span>Styles</span>
        <ChevronDown />
      </button>
      {open && (
        <SampleFontsProvider>
          <div
            id={popId}
            ref={popRef}
            className="font-popover styles-popover"
            role="group"
            aria-label="Styles"
            style={shift ? { left: shift } : undefined}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
            }}
          >
            {styles !== null && list.length === 0 && <p className="font-empty">No styles yet</p>}
            {list.map((s, i) => item(i, <StyleSample style={s} text={s.name} cap={MENU_SAMPLE_CAP} />, () => choose(s), 'font-item style-item'))}
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
        </SampleFontsProvider>
      )}
      {/* Saving creates the style and changes nothing in the note: there is nothing more to do here. */}
      {form && <StyleForm initial={form} title="New style" onClose={() => setForm(null)} onSaved={() => undefined} onBrowseFonts={onBrowseFonts} />}
    </span>
  );
}
