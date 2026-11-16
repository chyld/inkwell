import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ChevronDown,
  ChevronLeft,
  Code,
  Folder,
  Grid2x2X,
  Highlighter,
  Italic,
  Link,
  PanelTop,
  Redo2,
  SquareMinus,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { api, ApiError, NetworkError, type FolderNode, type Me, type Note, type NoteItem, type TagCount } from '../api';
import { localDrafts, type Draft } from '../drafts';
import { NoteSaver, type SaveStatus } from '../saver';
import { noteExtensions, isAllowedHref, normalizeTag, fontsInDoc, TAGS_PER_NOTE, TEXT_COLORS, HIGHLIGHT_COLORS } from '../../shared/schema';
import { ColorPicker } from './ColorPicker';
import { FontPicker } from './FontPicker';
import { FontSizeControl } from './FontSizeControl';
import { StylesMenu } from './StylesMenu';
import { BlockMenus } from './BlockMenus';
import { ImageResizeKeys, ResizableImage } from '../ImageView';
import { NoteFontSession } from '../fonts/runtime';
import { NOTE_FONTS_MAX } from '../../shared/fonts';
import { relativeTime } from '../util';
import { APP_TITLE, NOT_FOUND_TITLE, noteTitle } from '../route';
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
  /** "Go to all notes" from the not-found state. */
  onAllNotes?: () => void;
  /** "Browse fonts…" in the font menu: go to /fonts (the note is saved first, as on any navigation). */
  onBrowseFonts?: () => void;
  /** "Manage styles…" in the Styles menu: go to /styles (the note is saved first). */
  onManageStyles?: () => void;
}

/** Shown for an address that names no note of this user: a malformed id, a deleted note or someone else's (same message for all). */
export function NoteNotFound({ onBack, onAllNotes }: { onBack: () => void; onAllNotes: () => void }) {
  useEffect(() => {
    document.title = NOT_FOUND_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, []);
  return (
    <section className="editor-pane empty" aria-label="Editor">
      <button className="icon-button mobile-only back" onClick={onBack} aria-label="Back to list" title="Back to list">
        <ChevronLeft />
      </button>
      <div className="not-found" role="alert">
        <h2>This note was not found</h2>
        <p>It may have been deleted, or the address may be wrong.</p>
        <button className="primary" onClick={onAllNotes}>
          Go to all notes
        </button>
      </div>
    </section>
  );
}

export function NoteEditorPane(props: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);
  // The fonts of this opening of the note (FONTS-SPEC 8.3): kept across a conflict's reload.
  const [fontSession] = useState(() => new NoteFontSession());
  useEffect(() => () => fontSession.close(), [fontSession]);

  useEffect(() => {
    let alive = true;
    setNote(null);
    setError(null);
    setMissing(false);
    api<Note>('GET', `/notes/${props.noteId}`)
      .then((n) => alive && setNote(n))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
      });
    return () => {
      alive = false;
    };
  }, [props.noteId, reload]);

  if (missing) return <NoteNotFound onBack={props.onBack} onAllNotes={props.onAllNotes ?? props.onBack} />;
  if (error)
    return (
      <section className="editor-pane empty">
        <button className="icon-button mobile-only back" onClick={props.onBack} aria-label="Back to list" title="Back to list">
          <ChevronLeft />
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
  return <EditorBody key={`${note.id}:${reload}`} {...props} note={note} reloadNote={() => setReload((r) => r + 1)} setNote={setNote} fontSession={fontSession} />;
}

/**
 * A paste that would bring the note past 50 fonts keeps the fonts already in the note (and new ones up
 * to the limit, in order) and drops the marks of the extra ones (FONTS-SPEC 8.1).
 */
export function limitPastedFonts(slice: Slice, editor: Editor): Slice {
  const used = fontsInDoc(editor.state.doc);
  const added = new Set<string>();
  let dropped = false;
  const keep = (id: string) => {
    if (used.has(id) || added.has(id)) return true;
    if (used.size + added.size >= NOTE_FONTS_MAX) return false;
    added.add(id);
    return true;
  };
  const mapNode = (node: PMNode): PMNode => {
    if (node.isText) {
      const font = node.marks.find((m) => m.type.name === 'fontFamily');
      if (font && !keep(font.attrs.font as string)) {
        dropped = true;
        return node.mark(font.removeFromSet(node.marks));
      }
      return node;
    }
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(mapNode(c)));
    return node.copy(Fragment.fromArray(kids));
  };
  const kids: PMNode[] = [];
  slice.content.forEach((c) => kids.push(mapNode(c)));
  return dropped ? new Slice(Fragment.fromArray(kids), slice.openStart, slice.openEnd) : slice;
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

function EditorBody(props: Props & { note: Note; reloadNote: () => void; setNote: (n: Note) => void; fontSession: NoteFontSession }) {
  const { note, me } = props;
  const dialogs = useDialogs();
  const trashed = note.trashedAt !== null;
  const [title, setTitle] = useState(note.title);
  const titleRef = useRef(note.title);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [missingImages, setMissingImages] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [folderId, setFolderId] = useState(note.folderId);
  const [tags, setTags] = useState(note.tags);
  // Shown in the header; follows confirmed saves, and "x min ago" is refreshed once a minute.
  const [updatedAt, setUpdatedAt] = useState(note.updatedAt);
  const [, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  // The page title (and so a bookmark's name) follows the note's title.
  const titleShown = useRef(false);
  useEffect(() => {
    if (!titleShown.current) {
      titleShown.current = true;
      document.title = noteTitle(title);
      return;
    }
    const t = setTimeout(() => (document.title = noteTitle(title)), 300);
    return () => clearTimeout(t);
  }, [title]);
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
  const saverRef = useRef<NoteSaver | null>(null);
  // The saver outlives renders; it must call the current callbacks, not the first render's.
  const propsRef = useRef(props);
  propsRef.current = props;

  const makeSaver = useCallback(
    (version: number) => {
      saverRef.current?.dispose();
      const s = new NoteSaver(me.id, note.id, version, {
        put: (id, payload) => api('PUT', `/notes/${id}`, payload),
        drafts: localDrafts,
        onStatus: (st, msg, err) => {
          setStatus(st);
          setStatusMsg(msg ?? null);
          setMissingImages(err?.code === 'image_missing' && Array.isArray(err.extra.images) ? (err.extra.images as string[]) : []);
        },
        onConflict: () => setConflict(true),
        onSaved: (info) => {
          const at = info.updatedAt ?? new Date().toISOString();
          setUpdatedAt(at);
          // A save can complete after the note was closed (flush on unmount): the editor is gone then.
          const ed = editorRef.current;
          const snippet = ed && !ed.isDestroyed ? ed.getText().slice(0, 200) : undefined;
          propsRef.current.onMeta(note.id, { title: info.title, updatedAt: at, ...(snippet === undefined ? {} : { snippet }) });
          propsRef.current.onStorageChanged();
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
  const upload = useImageUpload(editorRef, dialogs, () => propsRef.current.onStorageChanged());
  // Until the user answers the draft offer, nothing can be edited: an edit would overwrite the stored draft.
  const locked = trashed || draft !== null;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: note.body,
    editable: !trashed,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'prose', 'aria-label': 'Note body' },
      transformPasted: (slice) => (editorRef.current ? limitPastedFonts(fixPastedTables(slice, editorRef.current), editorRef.current) : slice),
      handlePaste: (_view, event) => upload.handleFiles(event.clipboardData?.files),
      handleDrop: (view, event) => {
        const files = (event as DragEvent).dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return upload.handleFiles(files, pos?.pos);
      },
    },
    onUpdate: ({ editor }) => {
      if (lockedRef.current) return;
      saverRef.current?.change(titleRef.current, editor.getJSON());
    },
  });
  editorRef.current = editor;

  // The fonts in the document: when the note opens and on every change (typing, paste, undo, redo);
  // the draft and conflict paths below also call it, as they replace the document.
  const syncFonts = () => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) props.fontSession.update(fontsInDoc(ed.state.doc));
  };
  useEffect(() => {
    if (!editor) return;
    syncFonts();
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && syncFonts();
    editor.on('transaction', onTr);
    return () => {
      editor.off('transaction', onTr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === locked) editor.setEditable(!locked, false);
  }, [editor, locked]);

  useEffect(() => {
    if (props.autoFocusTitle) document.getElementById('note-title')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTitle(v: string) {
    if (locked) return;
    setTitle(v);
    titleRef.current = v;
    if (editor) saverRef.current?.change(v, editor.getJSON());
  }

  function restoreDraft() {
    if (!draft || !editor) return;
    // Use the draft as stored now: another tab may have changed or removed it since the offer appeared.
    const current = localDrafts.get(me.id, note.id);
    setDraft(null);
    if (!current) {
      dialogs.notice('That draft is no longer on this device; the saved note is shown.');
      return;
    }
    const s = makeSaver(current.version);
    editor.commands.setContent(current.body as any, { emitUpdate: false });
    syncFonts();
    setTitle(current.title);
    titleRef.current = current.title;
    s.change(current.title, editor.getJSON(), true);
  }

  function discardDraft() {
    const current = localDrafts.get(me.id, note.id);
    if (current && draft && (current.savedAt !== draft.savedAt || current.owner !== draft.owner)) {
      // Another tab wrote a newer draft since the offer appeared: keep it, and offer that one.
      setDraft(current);
      dialogs.notice('These unsaved changes were updated in another tab. Check them, then choose again.');
      return;
    }
    localDrafts.remove(me.id, note.id);
    setDraft(null);
  }

  /** Take images that no longer exist on the server out of the note, so it can be saved. */
  function removeMissingImages() {
    if (!editor) return;
    const srcs = new Set(missingImages.map((id) => `/api/images/${id}`));
    const ranges: [number, number][] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && srcs.has(node.attrs.src)) ranges.push([pos, pos + node.nodeSize]);
    });
    const tr = editor.state.tr;
    for (const [from, to] of ranges.reverse()) tr.delete(from, to);
    editor.view.dispatch(tr);
    setMissingImages([]);
  }

  function keepMine() {
    setConflict(false);
    saverRef.current?.keepMine();
    syncFonts();
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
    const saved = (await saverRef.current?.flush(3000)) ?? true;
    // A stored draft (offer still open, or a save that never got through) means unsaved changes too.
    const stored = localDrafts.get(me.id, note.id);
    if (saved && stored && !draft) {
      // This tab's own changes are saved, so the draft was left by another tab: offer it.
      setDraft(stored);
      dialogs.notice('The note was not moved to Trash: this device has changes to it from another tab. Restore or discard them first.');
      return;
    }
    if (!saved || stored !== null) {
      dialogs.notice('The note was not moved to Trash: its latest changes are not saved yet. Try again once they are saved.');
      return;
    }
    if (await act(() => api('POST', `/notes/${note.id}/trash`))) props.onTrashed(note.id);
  }
  async function restore() {
    if (await act(() => api('POST', `/notes/${note.id}/restore`))) props.onRestored(note.id);
  }
  async function deleteForever() {
    const local = localDrafts.get(me.id, note.id) !== null;
    const ok = await dialogs.confirm({
      title: 'Delete permanently',
      message:
        `Delete “${note.title || 'Untitled'}” permanently? This cannot be undone.` +
        (local ? ' This device also has changes to this note that exist only on this device; they are discarded too.' : ''),
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    if (await act(() => api('DELETE', `/notes/${note.id}`))) {
      localDrafts.remove(me.id, note.id);
      props.onDeleted(note.id);
    }
  }

  const location = folderId ? folderPath(props.folders, folderId) || findFolder(props.folders, folderId)?.name || 'Folder' : 'Unfiled';
  const statusText = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Not saved';

  const created = new Date(note.createdAt);
  const updated = new Date(updatedAt);
  const sameYear = created.getFullYear() === new Date().getFullYear();
  const showTagRow = !locked || tags.length > 0 || note.origin.type === 'agent';

  return (
    <section className="editor-pane" aria-label="Editor">
      {/* Mock-up 07 (DEVIATIONS 47): one title row (folder / title, tags; dates, save status and Move to Trash on the
          right), then the flat slate toolbar, the banners, and the paper with the body, with no gaps between them. */}
      <header className="editor-header">
        <div className="editor-row">
          <div className="slim-left">
            <button className="icon-button mobile-only" onClick={props.onBack} aria-label="Back to list" title="Back to list">
              <ChevronLeft />
            </button>
            {!trashed && (
              <button className="folder-button" onClick={moveTo} title="Move to…" aria-label="Move to…" disabled={locked}>
                <Folder />
                <span className="folder-button-label">{location}</span>
                <ChevronDown />
              </button>
            )}
            {trashed && (
              <span className="editor-trashed">
                <Trash2 />
                <span>In Trash · was in {location}</span>
              </span>
            )}
            <span className="title-sep" aria-hidden>
              /
            </span>
            <input
              id="note-title"
              className="title-input"
              placeholder="Untitled"
              value={title}
              maxLength={200}
              readOnly={locked}
              onChange={(e) => onTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
              aria-label="Title"
            />
            {note.origin.type === 'agent' && <span className="agent-badge">by {note.origin.name}</span>}
            {showTagRow && <TagEditor tags={tags} allTags={props.allTags} readOnly={locked} onChange={setNoteTags} />}
          </div>
          <div className="slim-right">
            <span className="editor-dates" title={`Created ${created.toLocaleString()} · Updated ${updated.toLocaleString()}`}>
              Created{' '}
              <time dateTime={note.createdAt}>{created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })}</time> · Updated{' '}
              <time dateTime={updatedAt}>{relativeTime(updatedAt)}</time>
            </span>
            {!trashed && (
              <span className={`save-status ${status}`} role="status" aria-live="polite" title={statusMsg ?? undefined}>
                {statusText}
              </span>
            )}
            {!trashed && (
              <button className="icon-button" onClick={trash} title="Move to Trash" aria-label="Move to Trash">
                <Trash2 />
              </button>
            )}
          </div>
        </div>
      </header>
      {!locked && editor && (
        <Toolbar editor={editor} onImage={upload.pick} uploading={upload.busy} onBrowseFonts={props.onBrowseFonts ?? (() => {})} onManageStyles={props.onManageStyles ?? (() => {})} notice={dialogs.notice} />
      )}
      {statusMsg && status === 'unsaved' && !conflict && (
        <div className="banner warn">
          <span>{statusMsg}</span>
          {missingImages.length > 0 && !locked && (
            <span className="banner-actions">
              <button className="primary" onClick={removeMissingImages}>
                Remove missing images
              </button>
            </span>
          )}
        </div>
      )}
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
      {/* The paper: the body, full width; it scrolls, the title row and the toolbar above stay put. */}
      <div className="editor-scroll paper">
        <div className="paper-column">
          <EditorContent editor={editor} className="editor-content" />
        </div>
      </div>
      {upload.input}
    </section>
  );
}

// The note schema with the web-only image resize view (same node, same attributes) and its Tab key.
const EDITOR_EXTENSIONS = [...noteExtensions.map((e) => (e.name === 'image' ? ResizableImage : e)), ImageResizeKeys];

function Toolbar({
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
  const [pillRef, wrapped] = usePillWrapped();
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
    <div className="toolbar" role="toolbar" aria-label="Formatting" ref={pillRef} data-wrapped={wrapped || undefined}>
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

/**
 * Marks the toolbar as wrapped (data-wrapped) when it takes more than one row. Since mock-up 07 the bar is flat
 * either way, so no rule uses it now; it is kept as a hook. CSS cannot tell that a flex row has wrapped, so this
 * compares the bar's height with one row of its buttons.
 */
function usePillWrapped(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const row = el.querySelector('.tb')?.getBoundingClientRect().height ?? 0;
      const inner = el.clientHeight - parseFloat(getComputedStyle(el).paddingTop || '0') - parseFloat(getComputedStyle(el).paddingBottom || '0');
      setWrapped(row > 0 && inner > row * 1.5);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, wrapped];
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
            <button className="chip-x" aria-label={`Remove tag ${t}`} title={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X />
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
