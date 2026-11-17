// The toolbar's block dropdowns: Headings, Lists, Blocks and Insert. Each is an icon button with a chevron;
// Headings, Lists and Blocks show the icon of what is in use at the cursor (drawn as pressed), or the group's
// own icon. Rows toggle exactly as the old separate buttons did. Keyboard: arrows, Home/End, Enter/Space,
// Escape (back to the button), Tab (closes); ArrowDown on the button opens the menu.
import { useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, Heading, Heading1, Heading2, Heading3, ImagePlus, List, ListOrdered, ListTodo, LoaderCircle, Minus, Pilcrow, Plus, Quote, SquareCode, Table, TextQuote } from 'lucide-react';
import { runKey, usePopoverMenu } from './popoverMenu';

export interface MenuRow {
  id: string;
  label: string;
  icon: ReactNode;
  /** Marked with aria-checked; undefined for plain actions (Insert). */
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  /** The menu's name: "Headings", "Lists", "Blocks", "Insert". */
  name: string;
  /** The button's icon when nothing in the group is in use. */
  icon: ReactNode;
  rows: MenuRow[];
  /** The row whose icon the button shows (drawn pressed), if any. */
  current?: MenuRow | null;
  /** menuitemradio (one of several, as headings) or menuitemcheckbox (toggles); plain menuitem without checks. */
  kind: 'radio' | 'checkbox' | 'action';
}

export function ToolbarMenu({ name, icon, rows, current = null, kind }: Props) {
  // Tab closes it (below) rather than a focus-out.
  const m = usePopoverMenu({ closeOnFocusOut: false });
  const label = current ? `${name}: ${current.label}` : name;
  const enabledIdx = rows.map((r, i) => (r.disabled ? -1 : i)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    if (!m.open) return;
    const checked = rows.findIndex((r) => r.checked && !r.disabled);
    const start = checked >= 0 ? checked : (enabledIdx[0] ?? 0);
    m.focusItem(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.open]);

  /** Moves over the enabled rows only, wrapping; ±Infinity: the last or the first. */
  function move(to: number) {
    if (!enabledIdx.length) return;
    const at = enabledIdx.indexOf(m.focusIdx);
    const next = to === Infinity ? enabledIdx.length - 1 : to === -Infinity ? 0 : (((at < 0 ? 0 : at) + to) % enabledIdx.length + enabledIdx.length) % enabledIdx.length;
    m.focusItem(enabledIdx[next], true);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      m.close(false);
      return;
    }
    // Enter and Space choose the focused row here, with the key's default cancelled: left to the browser,
    // the button's click would move the focus to the note and the same Enter would then split the text there.
    if ((e.key === 'Enter' || e.key === ' ') && rows[m.focusIdx]) {
      e.preventDefault();
      e.stopPropagation();
      choose(rows[m.focusIdx]);
      return;
    }
    runKey(e, { ArrowDown: () => move(1), ArrowUp: () => move(-1), Home: () => move(-Infinity), End: () => move(Infinity), Escape: () => m.close(true) });
  }

  function choose(r: MenuRow) {
    if (r.disabled) return;
    m.close(false);
    r.run();
  }

  const role = kind === 'radio' ? 'menuitemradio' : kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem';
  return (
    <span className="color-tool tb-menu-tool" ref={m.wrapRef}>
      <button
        {...m.buttonProps}
        type="button"
        className={'tb tb-menu-button' + (current ? ' active' : '') + (m.open ? ' open' : '')}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        onKeyDown={(e) => {
          m.buttonProps.onKeyDown(e);
          if (e.key === 'ArrowDown' && !m.open) {
            e.preventDefault();
            m.setOpen(true);
          }
        }}
      >
        {current ? current.icon : icon}
        <ChevronDown className="tb-chevron" />
      </button>
      {m.open && (
        <div {...m.popoverProps} className={'font-popover tb-menu' + (m.place?.above ? ' above' : '')} role="menu" aria-label={name} onKeyDown={onKeyDown}>
          <div className="menu-scroll">
            {rows.map((r, i) => (
              <button
                key={r.id}
                {...m.itemProps(i)}
                type="button"
                role={role}
                aria-checked={kind === 'action' ? undefined : !!r.checked}
                disabled={r.disabled}
                className="font-item tb-menu-item"
                onClick={() => choose(r)}
              >
                {r.icon}
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/** The innermost of these node types around the cursor (or the selection's start). */
function innermost(editor: Editor, names: string[]): string | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name;
    if (names.includes(n)) return n;
  }
  return null;
}

export function BlockMenus({ editor, inTable, uploading, onImage }: { editor: Editor; inTable: boolean; uploading: boolean; onImage: () => void }) {
  const chain = () => editor.chain().focus();
  const level = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l })) ?? null;
  const inParagraph = editor.state.selection.$from.parent.type.name === 'paragraph';
  const headings: MenuRow[] = [
    { id: 'p', label: 'Normal text', icon: <Pilcrow />, checked: level === null && inParagraph, run: () => chain().setParagraph().run() },
    { id: 'h1', label: 'Heading 1', icon: <Heading1 />, checked: level === 1, run: () => chain().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', icon: <Heading2 />, checked: level === 2, run: () => chain().toggleHeading({ level: 2 }).run() },
    { id: 'h3', label: 'Heading 3', icon: <Heading3 />, checked: level === 3, run: () => chain().toggleHeading({ level: 3 }).run() },
  ];
  const list = innermost(editor, ['bulletList', 'orderedList', 'taskList']);
  const lists: MenuRow[] = [
    { id: 'bulletList', label: 'Bullet list', icon: <List />, checked: list === 'bulletList', run: () => chain().toggleBulletList().run() },
    { id: 'orderedList', label: 'Numbered list', icon: <ListOrdered />, checked: list === 'orderedList', run: () => chain().toggleOrderedList().run() },
    { id: 'taskList', label: 'Task list', icon: <ListTodo />, checked: list === 'taskList', run: () => chain().toggleTaskList().run() },
  ];
  const block = innermost(editor, ['blockquote', 'codeBlock']);
  const blocks: MenuRow[] = [
    { id: 'blockquote', label: 'Quote', icon: <Quote />, checked: block === 'blockquote', run: () => chain().toggleBlockquote().run() },
    { id: 'codeBlock', label: 'Code block', icon: <SquareCode />, checked: block === 'codeBlock', run: () => chain().toggleCodeBlock().run() },
  ];
  const inserts: MenuRow[] = [
    { id: 'hr', label: 'Horizontal line', icon: <Minus />, run: () => chain().setHorizontalRule().run() },
    { id: 'table', label: 'Table', icon: <Table />, disabled: inTable, run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'image', label: 'Image', icon: uploading ? <LoaderCircle className="spin" /> : <ImagePlus />, disabled: uploading, run: onImage },
  ];
  return (
    <>
      <ToolbarMenu name="Headings" icon={<Heading />} rows={headings} current={headings.find((r) => r.id !== 'p' && r.checked)} kind="radio" />
      <ToolbarMenu name="Lists" icon={<List />} rows={lists} current={lists.find((r) => r.checked)} kind="checkbox" />
      <ToolbarMenu name="Blocks" icon={<TextQuote />} rows={blocks} current={blocks.find((r) => r.checked)} kind="checkbox" />
      <ToolbarMenu name="Insert" icon={<Plus />} rows={inserts} kind="action" />
    </>
  );
}
