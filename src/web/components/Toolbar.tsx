// The editor's toolbar (DEVIATIONS 45-47): Styles | font | size | colours | inline marks | Headings, Lists,
// Blocks, Insert | Undo, Redo; and the table tools under it inside a table.
import type { ReactNode } from 'react';
import {
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Code,
  Grid2x2X,
  Highlighter,
  Italic,
  Link,
  PanelTop,
  Redo2,
  SquareMinus,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEditorState, type Editor } from '@tiptap/react';
import { HIGHLIGHT_COLORS, isAllowedHref, TEXT_COLORS } from '../../shared/noteRules';
import { BlockMenus } from './BlockMenus';
import { ColorPicker } from './ColorPicker';
import { useDialogs } from './Dialogs';
import { FontPicker, fontStateOf } from './FontPicker';
import { FontSizeControl, sizeStateOf } from './FontSizeControl';
import { StylesMenu } from './StylesMenu';

/**
 * Everything the toolbar and its controls show, as one value: the toolbar re-renders when it changes. The Styles
 * menu subscribes to its own match (StylesMenu), which can change where none of these do.
 */
export function toolbarKey(e: Editor): string {
  const { $from } = e.state.selection;
  const ancestors: string[] = [];
  for (let d = $from.depth; d > 0; d--) ancestors.push($from.node(d).type.name);
  return JSON.stringify([
    fontStateOf(e),
    sizeStateOf(e),
    e.getAttributes('textColor').color ?? null,
    e.getAttributes('highlight').color ?? null,
    ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'table', 'codeBlock'].map((n) => e.isActive(n)),
    [1, 2, 3].map((level) => e.isActive('heading', { level })),
    ancestors,
    e.can().undo(),
    e.can().redo(),
    e.isEditable,
  ]);
}

export function Toolbar({
  editor,
  onImage,
  uploading,
  onBrowseFonts,
  onManageStyles,
  notice,
}: {
  editor: Editor;
  onImage: () => void;
  uploading: boolean;
  onBrowseFonts: () => void;
  onManageStyles: () => void;
  notice: (m: string) => void;
}) {
  const dialogs = useDialogs();
  // Re-render only when something the toolbar shows changes, not on every keystroke (CLEANUP-PLAN pass 1 item 3).
  useEditorState({ editor, selector: ({ editor }) => toolbarKey(editor) });
  const b = (label: ReactNode, title: string, active: boolean, run: () => void, disabled = false, withText = false) => (
    <button
      type="button"
      className={'tb' + (active ? ' active' : '') + (withText ? ' with-text' : '')}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  const chain = () => editor.chain().focus();

  async function link() {
    const prev = editor.getAttributes('link').href ?? '';
    const url = await dialogs.prompt({ title: 'Link', label: 'Address (http, https or mailto). Leave empty to remove the link.', initial: prev, confirmLabel: 'Apply' });
    if (url === null) return;
    const v = url.trim();
    if (!v) {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : v.includes('@') && !v.includes('/') ? `mailto:${v}` : `https://${v}`;
    if (!isAllowedHref(href)) {
      dialogs.notice('Only http, https and mailto links are allowed.');
      return;
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain().insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else chain().extendMarkRange('link').setLink({ href }).run();
  }

  const inTable = editor.isActive('table');
  // Colours never apply inside code (inline code excludes other marks; code blocks allow none).
  const inCode = editor.isActive('code') || editor.isActive('codeBlock');
  return (
    <div className="toolbar-wrap">
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {/* Styles | font | size | colours | inline marks | Headings, Lists, Blocks, Insert | Undo, Redo (DEVIATIONS 45). */}
      <div className="tb-group">
        <StylesMenu editor={editor} notice={notice} onManage={onManageStyles} onBrowseFonts={onBrowseFonts} />
      </div>
      <span className="tb-sep" aria-hidden />
      <div className="tb-group">
        <FontPicker editor={editor} disabled={inCode} onBrowse={onBrowseFonts} notice={notice} />
      </div>
      <span className="tb-sep" aria-hidden />
      <FontSizeControl editor={editor} disabled={inCode} />
      <span className="tb-sep" aria-hidden />
      <div className="tb-group">
        <ColorPicker editor={editor} mark="textColor" colors={TEXT_COLORS} label="Text colour" removeLabel="Remove text colour" icon={<Baseline />} disabled={inCode} />
        <ColorPicker editor={editor} mark="highlight" colors={HIGHLIGHT_COLORS} label="Highlight" removeLabel="Remove highlight" icon={<Highlighter />} disabled={inCode} />
      </div>
      <span className="tb-sep" aria-hidden />
      <div className="tb-group">
        {b(<Bold />, 'Bold', editor.isActive('bold'), () => chain().toggleBold().run())}
        {b(<Italic />, 'Italic', editor.isActive('italic'), () => chain().toggleItalic().run())}
        {b(<Underline />, 'Underline', editor.isActive('underline'), () => chain().toggleUnderline().run())}
        {b(<Strikethrough />, 'Strikethrough', editor.isActive('strike'), () => chain().toggleStrike().run())}
        {b(<Code />, 'Inline code', editor.isActive('code'), () => chain().toggleCode().run())}
        {b(<Link />, 'Link', editor.isActive('link'), link)}
      </div>
      <span className="tb-sep" aria-hidden />
      <div className="tb-group">
        <BlockMenus editor={editor} inTable={inTable} uploading={uploading} onImage={onImage} />
      </div>
      <span className="tb-sep" aria-hidden />
      <div className="tb-group">
        {b(<Undo2 />, 'Undo', false, () => chain().undo().run(), !editor.can().undo())}
        {b(<Redo2 />, 'Redo', false, () => chain().redo().run(), !editor.can().redo())}
      </div>
    </div>
      {/* The table tools: a second, smaller pill under the toolbar, only in a table. */}
      {inTable && (
        <div className="toolbar table-tools" role="toolbar" aria-label="Table">
          {b(<><BetweenHorizontalStart /> Row above</>, 'Add row above', false, () => chain().addRowBefore().run(), false, true)}
          {b(<><BetweenHorizontalEnd /> Row below</>, 'Add row below', false, () => chain().addRowAfter().run(), false, true)}
          {b(<><SquareMinus /> Delete row</>, 'Delete row', false, () => chain().deleteRow().run(), false, true)}
          {b(<><BetweenVerticalStart /> Column left</>, 'Add column left', false, () => chain().addColumnBefore().run(), false, true)}
          {b(<><BetweenVerticalEnd /> Column right</>, 'Add column right', false, () => chain().addColumnAfter().run(), false, true)}
          {b(<><SquareMinus /> Delete column</>, 'Delete column', false, () => chain().deleteColumn().run(), false, true)}
          {b(<><PanelTop /> Header row</>, 'Toggle header row', false, () => chain().toggleHeaderRow().run(), false, true)}
          {b(<><Grid2x2X /> Delete table</>, 'Delete table', false, () => chain().deleteTable().run(), false, true)}
        </div>
      )}
    </div>
  );
}
