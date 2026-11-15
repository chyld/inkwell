import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { api, ApiError, NetworkError, type FolderNode, type Me, type Note, type NoteItem, type TagCount } from '../api';
import { localDrafts, type Draft } from '../drafts';
import { NoteSaver, type SaveStatus } from '../saver';
import { noteExtensions, isAllowedHref, normalizeTag, TAGS_PER_NOTE } from '../../shared/schema';
import { relativeTime } from '../util';
import { useDialogs } from './Dialogs';
import { findFolder, folderPath } from './Sidebar';
import { useImageUpload } from './images';

/** The saver of the note on screen, for flushing before switching notes or signing out. */
export const activeSaver: { current: NoteSaver | null } = { current: null };

interface Props {
  noteId: string;
  me: Me;
  folders: FolderNode[];
  allTags: TagCount[];
  autoFocusTitle: boolean;
  onMeta: (id: string, patch: Partial<NoteItem>) => void;
  onTrashed: (id: string) => void;
  onRestored: (id: string) => void;
  onDeleted: (id: string) => void;
  onTagsChanged: () => void;
  onStorageChanged: () => void;
  onBack: () => void;
}

export function NoteEditorPane(props: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setNote(null);
    setError(null);
    api<Note>('GET', `/notes/${props.noteId}`)
      .then((n) => alive && setNote(n))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not reach the server.'));
    return () => {
      alive = false;
    };
  }, [props.noteId, reload]);

  if (error)
    return (
      <section className="editor-pane empty">
        <button className="icon-button mobile-only back" onClick={props.onBack} aria-label="Back to list">
          ‹
        </button>
        <p>{error}</p>
      </section>
    );
  if (!note)
    return (
      <section className="editor-pane empty">
        <p>Loading…</p>
      </section>
    );
  return <EditorBody key={`${note.id}:${reload}`} {...props} note={note} reloadNote={() => setReload((r) => r + 1)} setNote={setNote} />;
}

/** Convert header cells outside a table's first row into normal cells (pasted tables). */
function fixPastedTables(slice: Slice, editor: Editor): Slice {
  const schema = editor.schema;
  const mapNode = (node: PMNode): PMNode => {
    if (node.type.name === 'table') {
      const rows: PMNode[] = [];
      node.forEach((row, _o, i) => {
        const cells: PMNode[] = [];
        row.forEach((cell) => {
          cells.push(i > 0 && cell.type.name === 'tableHeader' ? schema.nodes.tableCell.create(cell.attrs, cell.content, cell.marks) : mapNode(cell));
        });
        rows.push(row.copy(Fragment.from(cells)));
      });
      return node.copy(Fragment.from(rows));
    }
    if (node.isLeaf || node.isText) return node;
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(mapNode(c)));
    return node.copy(Fragment.from(kids));
  };
  const kids: PMNode[] = [];
  slice.content.forEach((c) => kids.push(mapNode(c)));
  return new Slice(Fragment.from(kids), slice.openStart, slice.openEnd);
}

function EditorBody(props: Props & { note: Note; reloadNote: () => void; setNote: (n: Note) => void }) {
  const { note, me } = props;
  const dialogs = useDialogs();
  const trashed = note.trashedAt !== null;
  const [title, setTitle] = useState(note.title);
  const titleRef = useRef(note.title);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [folderId, setFolderId] = useState(note.folderId);
  const [tags, setTags] = useState(note.tags);
  const saverRef = useRef<NoteSaver | null>(null);

  const makeSaver = useCallback(
    (version: number) => {
      saverRef.current?.dispose();
      const s = new NoteSaver(me.id, note.id, version, {
        put: (id, payload) => api('PUT', `/notes/${id}`, payload),
        drafts: localDrafts,
        onStatus: (st, msg) => {
          setStatus(st);
          setStatusMsg(msg ?? null);
        },
        onConflict: () => setConflict(true),
        onSaved: (info) => {
          props.onMeta(note.id, { title: info.title, updatedAt: info.updatedAt ?? new Date().toISOString(), snippet: editorRef.current?.getText().slice(0, 200) ?? '' });
          props.onStorageChanged();
        },
      });
      saverRef.current = s;
      activeSaver.current = s;
      return s;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.id, note.id],
  );

  useEffect(() => {
    makeSaver(note.version);
    if (!trashed) {
      const d = localDrafts.get(me.id, note.id);
      if (d) {
        const same = d.title === note.title && JSON.stringify(d.body) === JSON.stringify(note.body);
        if (same) localDrafts.remove(me.id, note.id);
        else setDraft(d);
      }
    }
    return () => {
      const s = saverRef.current;
      if (activeSaver.current === s) activeSaver.current = null;
      // Changes made after the switch began are still sent; the draft stays until confirmed.
      if (s && s.hasUnconfirmed() && !s.isConflicted()) void s.flush(3000).then(() => s.dispose());
      else s?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editorRef = useRef<Editor | null>(null);
  const upload = useImageUpload(editorRef, dialogs, props.onStorageChanged);

  const editor = useEditor({
    extensions: noteExtensions,
    content: note.body,
    editable: !trashed,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'prose', 'aria-label': 'Note body' },
      transformPasted: (slice) => (editorRef.current ? fixPastedTables(slice, editorRef.current) : slice),
      handlePaste: (_view, event) => upload.handleFiles(event.clipboardData?.files),
      handleDrop: (view, event) => {
        const files = (event as DragEvent).dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return upload.handleFiles(files, pos?.pos);
      },
    },
    onUpdate: ({ editor }) => {
      saverRef.current?.change(titleRef.current, editor.getJSON());
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (props.autoFocusTitle) document.getElementById('note-title')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTitle(v: string) {
    setTitle(v);
    titleRef.current = v;
    if (editor) saverRef.current?.change(v, editor.getJSON());
  }

  function restoreDraft() {
    if (!draft || !editor) return;
    const s = makeSaver(draft.version);
    editor.commands.setContent(draft.body as any, { emitUpdate: false });
    setTitle(draft.title);
    titleRef.current = draft.title;
    setDraft(null);
    s.change(draft.title, editor.getJSON(), true);
  }

  function discardDraft() {
    localDrafts.remove(me.id, note.id);
    setDraft(null);
  }

  function keepMine() {
    setConflict(false);
    saverRef.current?.keepMine();
  }

  function loadTheirs() {
    setConflict(false);
    saverRef.current?.discardLocal();
    props.reloadNote();
  }

  async function act<T>(f: () => Promise<T>): Promise<T | undefined> {
    try {
      return await f();
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : e instanceof NetworkError ? e.message : 'Something went wrong.');
      return undefined;
    }
  }

  async function moveTo() {
    const pick = await dialogs.pickFolder({ title: 'Move note to…', folders: props.folders, rootLabel: 'Unfiled', current: folderId });
    if (!pick) return;
    const r = await act(() => api<{ folderId: string | null }>('PATCH', `/notes/${note.id}`, { folderId: pick.id }));
    if (r) {
      setFolderId(r.folderId);
      props.onMeta(note.id, { folderId: r.folderId });
    }
  }

  async function setNoteTags(next: string[]) {
    const r = await act(() => api<{ tags: string[] }>('PATCH', `/notes/${note.id}`, { tags: next }));
    if (r) {
      setTags(r.tags);
      props.onMeta(note.id, { tags: r.tags });
      props.onTagsChanged();
    }
  }

  async function trash() {
    await saverRef.current?.flush(3000);
    if (await act(() => api('POST', `/notes/${note.id}/trash`))) props.onTrashed(note.id);
  }
  async function restore() {
    if (await act(() => api('POST', `/notes/${note.id}/restore`))) props.onRestored(note.id);
  }
  async function deleteForever() {
    const ok = await dialogs.confirm({
      title: 'Delete permanently',
      message: `Delete “${note.title || 'Untitled'}” permanently? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    if (await act(() => api('DELETE', `/notes/${note.id}`))) props.onDeleted(note.id);
  }

  const location = folderId ? folderPath(props.folders, folderId) || findFolder(props.folders, folderId)?.name || 'Folder' : 'Unfiled';
  const statusText = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Not saved';

  return (
    <section className="editor-pane" aria-label="Editor">
      <header className="editor-header">
        <button className="icon-button mobile-only" onClick={props.onBack} aria-label="Back to list">
          ‹
        </button>
        <div className="editor-location">
          {!trashed && (
            <button className="link-button" onClick={moveTo} title="Move to…">
              📁 {location} ▾
            </button>
          )}
          {trashed && <span>In Trash · was in {location}</span>}
          {note.origin.type === 'agent' && <span className="agent-badge">by {note.origin.name}</span>}
        </div>
        {!trashed && (
          <span className={`save-status ${status}`} role="status" aria-live="polite" title={statusMsg ?? undefined}>
            {statusText}
          </span>
        )}
        {!trashed && (
          <button className="icon-button" onClick={trash} title="Move to Trash" aria-label="Move to Trash">
            🗑️
          </button>
        )}
      </header>
      {statusMsg && status === 'unsaved' && !conflict && <div className="banner warn">{statusMsg}</div>}
      {draft && (
        <div className="banner">
          <span>
            This device has changes to this note that were not saved ({relativeTime(new Date(draft.savedAt).toISOString())}).
          </span>
          <span className="banner-actions">
            <button className="primary" onClick={restoreDraft}>
              Restore
            </button>
            <button onClick={discardDraft}>Discard</button>
          </span>
        </div>
      )}
      {conflict && (
        <div className="banner warn" role="alert">
          <span>This note was changed somewhere else since you opened it.</span>
          <span className="banner-actions">
            <button className="primary" onClick={keepMine}>
              Keep mine
            </button>
            <button onClick={loadTheirs}>Load theirs</button>
          </span>
        </div>
      )}
      {trashed && (
        <div className="banner">
          <span>This note is in Trash and cannot be edited.</span>
          <span className="banner-actions">
            <button className="primary" onClick={restore}>
              Restore
            </button>
            <button className="danger" onClick={deleteForever}>
              Delete permanently
            </button>
          </span>
        </div>
      )}
      {!trashed && editor && <Toolbar editor={editor} onImage={upload.pick} uploading={upload.busy} />}
      <div className="editor-scroll">
        <input
          id="note-title"
          className="title-input"
          placeholder="Untitled"
          value={title}
          maxLength={200}
          readOnly={trashed}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editor?.commands.focus('start');
            }
          }}
          aria-label="Title"
        />
        <TagEditor tags={tags} allTags={props.allTags} readOnly={trashed} onChange={setNoteTags} />
        <EditorContent editor={editor} className="editor-content" />
        <p className="editor-dates">
          Created {new Date(note.createdAt).toLocaleString()} · Updated {relativeTime(note.updatedAt)}
        </p>
      </div>
      {upload.input}
    </section>
  );
}

function Toolbar({ editor, onImage, uploading }: { editor: Editor; onImage: () => void; uploading: boolean }) {
  const dialogs = useDialogs();
  const b = (label: string, title: string, active: boolean, run: () => void, disabled = false) => (
    <button
      type="button"
      className={'tb' + (active ? ' active' : '')}
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
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tb-group">
        {b('B', 'Bold', editor.isActive('bold'), () => chain().toggleBold().run())}
        {b('I', 'Italic', editor.isActive('italic'), () => chain().toggleItalic().run())}
        {b('S', 'Strikethrough', editor.isActive('strike'), () => chain().toggleStrike().run())}
        {b('</>', 'Inline code', editor.isActive('code'), () => chain().toggleCode().run())}
        {b('🔗', 'Link', editor.isActive('link'), link)}
      </div>
      <div className="tb-group">
        {b('H1', 'Heading 1', editor.isActive('heading', { level: 1 }), () => chain().toggleHeading({ level: 1 }).run())}
        {b('H2', 'Heading 2', editor.isActive('heading', { level: 2 }), () => chain().toggleHeading({ level: 2 }).run())}
        {b('H3', 'Heading 3', editor.isActive('heading', { level: 3 }), () => chain().toggleHeading({ level: 3 }).run())}
      </div>
      <div className="tb-group">
        {b('•', 'Bullet list', editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
        {b('1.', 'Numbered list', editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
        {b('☑', 'Task list', editor.isActive('taskList'), () => chain().toggleTaskList().run())}
        {b('❝', 'Quote', editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
        {b('{ }', 'Code block', editor.isActive('codeBlock'), () => chain().toggleCodeBlock().run())}
        {b('―', 'Horizontal rule', false, () => chain().setHorizontalRule().run())}
      </div>
      <div className="tb-group">
        {b('▦', 'Insert table', false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), inTable)}
        {b(uploading ? '…' : '🖼', 'Insert image', false, onImage, uploading)}
      </div>
      <div className="tb-group">
        {b('↶', 'Undo', false, () => chain().undo().run(), !editor.can().undo())}
        {b('↷', 'Redo', false, () => chain().redo().run(), !editor.can().redo())}
      </div>
      {inTable && (
        <div className="tb-group table-tools" aria-label="Table">
          {b('+Row↑', 'Add row above', false, () => chain().addRowBefore().run())}
          {b('+Row↓', 'Add row below', false, () => chain().addRowAfter().run())}
          {b('−Row', 'Delete row', false, () => chain().deleteRow().run())}
          {b('+Col←', 'Add column left', false, () => chain().addColumnBefore().run())}
          {b('+Col→', 'Add column right', false, () => chain().addColumnAfter().run())}
          {b('−Col', 'Delete column', false, () => chain().deleteColumn().run())}
          {b('Header', 'Toggle header row', false, () => chain().toggleHeaderRow().run())}
          {b('✕Table', 'Delete table', false, () => chain().deleteTable().run())}
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, allTags, readOnly, onChange }: { tags: string[]; allTags: TagCount[]; readOnly: boolean; onChange: (t: string[]) => void }) {
  const [value, setValue] = useState('');
  const dialogs = useDialogs();
  const listId = useMemo(() => `tags-${Math.random().toString(36).slice(2)}`, []);
  function add(raw: string) {
    const t = normalizeTag(raw);
    setValue('');
    if (!t) {
      if (raw.trim()) dialogs.notice('A tag is 1-50 characters and cannot contain commas.');
      return;
    }
    if (tags.includes(t)) return;
    if (tags.length >= TAGS_PER_NOTE) {
      dialogs.notice(`A note can have at most ${TAGS_PER_NOTE} tags.`);
      return;
    }
    onChange([...tags, t]);
  }
  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          {!readOnly && (
            <button className="chip-x" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <>
          <input
            className="tag-input"
            placeholder={tags.length ? 'Add tag' : 'Add tags'}
            aria-label="Add tag"
            list={listId}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(',')) v.split(',').forEach((p, i, a) => (i < a.length - 1 ? add(p) : setValue(p)));
              else setValue(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(value);
              } else if (e.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1));
            }}
            onBlur={() => value.trim() && add(value)}
          />
          <datalist id={listId}>
            {allTags
              .filter((t) => !tags.includes(t.name))
              .map((t) => (
                <option key={t.name} value={t.name} />
              ))}
          </datalist>
        </>
      )}
    </div>
  );
}
