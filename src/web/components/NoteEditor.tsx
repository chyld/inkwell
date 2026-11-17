import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, Folder, Trash2 } from 'lucide-react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { api, ApiError, NetworkError, type FolderNode, type Me, type Note, type NoteItem, type TagCount } from '../api';
import { localDrafts, type Draft } from '../drafts';
import { NoteSaver, activeSaver, type SaveStatus } from '../saver';
import { noteExtensions, fontsInDoc } from '../../shared/schema';
import { Toolbar } from './Toolbar';
import { TagEditor } from './TagEditor';
import { fixPastedTables, limitPastedFonts } from '../paste';
import { ImageResizeKeys, ResizableImage } from '../ImageView';
import { FontSession } from '../fonts/runtime';
import { NOTE_FONTS_MAX } from '../../shared/fonts';
import { relativeTime } from '../util';
import { APP_TITLE, noteTitle } from '../route';
import { useDialogs } from './Dialogs';
import { folderPath } from './folders';
import { useImageUpload } from './images';
import { NoteNotFound } from './NoteNotFound';
import { selectionFromPaper } from '../paperClick';
import { HeaderCellsInFirstRow } from '../tableRules';

interface Props {
  noteId: string;
  me: Me;
  folders: FolderNode[];
  allTags: TagCount[];
  autoFocusTitle: boolean;
  onMeta: (id: string, patch: Partial<NoteItem>) => void;
  /** The note left the list it was in: moved to Trash, restored from it, or deleted for good. */
  onRemoved: (id: string) => void;
  onTagsChanged: () => void;
  onBack: () => void;
  /** "Go to all notes" from the not-found state. */
  onAllNotes?: () => void;
  /** "Browse fonts…" in the font menu: go to /fonts (the note is saved first, as on any navigation). */
  onBrowseFonts?: () => void;
  /** "Manage styles…" in the Styles menu: go to /styles (the note is saved first). */
  onManageStyles?: () => void;
}

export function NoteEditorPane(props: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);
  // The fonts of this opening of the note (FONTS-SPEC 8.3): kept across a conflict's reload.
  const [fontSession] = useState(() => new FontSession({ max: NOTE_FONTS_MAX }));
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

function EditorBody(props: Props & { note: Note; reloadNote: () => void; setNote: (n: Note) => void; fontSession: FontSession }) {
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
          const next = err?.code === 'image_missing' && Array.isArray(err.extra.images) ? (err.extra.images as string[]) : [];
          // Only a real change re-renders: the saver reports a status on every edit.
          setMissingImages((prev) => (prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next));
        },
        onConflict: () => setConflict(true),
        onSaved: (info) => {
          const at = info.updatedAt ?? new Date().toISOString();
          setUpdatedAt(at);
          // A save can complete after the note was closed (flush on unmount): the editor is gone then.
          const ed = editorRef.current;
          const snippet = ed && !ed.isDestroyed ? ed.getText().slice(0, 200) : undefined;
          propsRef.current.onMeta(note.id, { title: info.title, updatedAt: at, ...(snippet === undefined ? {} : { snippet }) });
          // The storage line is read when the account menu opens (Rail), not after every save.
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
  const upload = useImageUpload(editorRef, dialogs);
  // Until the user answers the draft offer, nothing can be edited: an edit would overwrite the stored draft.
  const locked = trashed || draft !== null;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: note.body,
    editable: !trashed,
    // Transactions do not re-render this whole pane (the toolbar subscribes to what it shows: Toolbar below).
    shouldRerenderOnTransaction: false,
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
      // The document is serialised by the saver only when it writes a draft or sends (not per keystroke).
      saverRef.current?.change(titleRef.current, () => editor.getJSON());
    },
  });
  editorRef.current = editor;

  // The fonts in the document: when the note opens, and after changes (typing, paste, undo, redo), at most every
  // FONT_SCAN_MS rather than per keystroke; the draft and conflict paths below call it directly, as they replace
  // the document.
  const syncFonts = () => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) props.fontSession.want(fontsInDoc(ed.state.doc));
  };
  useEffect(() => {
    if (!editor) return;
    syncFonts();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged || timer) return;
      timer = setTimeout(() => {
        timer = null;
        syncFonts();
      }, FONT_SCAN_MS);
    };
    editor.on('transaction', onTr);
    return () => {
      editor.off('transaction', onTr);
      if (timer) clearTimeout(timer);
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
    if (editor) saverRef.current?.change(v, () => editor.getJSON());
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
    s.takeOverDraft(); // restored here: this editor replaces it from now on, and clears it once saved
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

  // Tag changes (BUGFIX-LIST item 3): each change is applied to the latest list asked for, not to the list on
  // screen (several tags pasted or typed quickly all count), and one PATCH is in flight at a time; changes made
  // meanwhile go next, as one list, in order.
  const confirmedTags = useRef(note.tags);
  const wantedTags = useRef<string[] | null>(null);
  const sendingTags = useRef(false);
  function changeTags(change: (current: string[]) => string[]) {
    const base = wantedTags.current ?? confirmedTags.current;
    const next = change(base);
    if (next.length === base.length && next.every((t, i) => t === base[i])) return;
    wantedTags.current = next;
    void sendTags();
  }
  async function sendTags() {
    if (sendingTags.current) return;
    sendingTags.current = true;
    try {
      while (wantedTags.current) {
        const list = wantedTags.current;
        const r = await act(() => api<{ tags: string[] }>('PATCH', `/notes/${note.id}`, { tags: list }));
        if (!r) {
          wantedTags.current = null; // refused or failed: later changes start from what the server has
          break;
        }
        if (wantedTags.current === list) wantedTags.current = null;
        confirmedTags.current = r.tags;
        setTags(r.tags);
        props.onMeta(note.id, { tags: r.tags });
        props.onTagsChanged();
      }
    } finally {
      sendingTags.current = false;
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
    if (await act(() => api('POST', `/notes/${note.id}/trash`))) props.onRemoved(note.id);
  }
  async function restore() {
    if (await act(() => api('POST', `/notes/${note.id}/restore`))) props.onRemoved(note.id);
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
      props.onRemoved(note.id);
    }
  }

  const location = folderId ? folderPath(props.folders, folderId) || 'Folder' : 'Unfiled';
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
              /* As wide as its text: CSS field-sizing does it where supported; this is the fallback (DEVIATIONS 50). */
              size={Math.max(title.length, 8)}
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
            {(showTagRow || note.origin.type === 'agent') && <span className="title-divider" aria-hidden />}
            {note.origin.type === 'agent' && <span className="agent-badge">by {note.origin.name}</span>}
            {showTagRow && <TagEditor tags={tags} allTags={props.allTags} readOnly={locked} onChange={changeTags} />}
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
              <button className="btn primary" onClick={removeMissingImages}>
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
            <button className="btn primary" onClick={restoreDraft}>
              Restore
            </button>
            <button className="btn" onClick={discardDraft}>Discard</button>
          </span>
        </div>
      )}
      {conflict && (
        <div className="banner warn" role="alert">
          <span>This note was changed somewhere else since you opened it.</span>
          <span className="banner-actions">
            <button className="btn primary" onClick={keepMine}>
              Keep mine
            </button>
            <button className="btn" onClick={loadTheirs}>Load theirs</button>
          </span>
        </div>
      )}
      {trashed && (
        <div className="banner">
          <span>This note is in Trash and cannot be edited.</span>
          <span className="banner-actions">
            <button className="btn primary" onClick={restore}>
              Restore
            </button>
            <button className="btn danger" onClick={deleteForever}>
              Delete permanently
            </button>
          </span>
        </div>
      )}
      {/* The paper: the body, full width; it scrolls, the title row and the toolbar above stay put. */}
      <div
        className="editor-scroll paper"
        onMouseDown={(e) => {
          // A press on the paper around the text acts on the nearest point of the text (and deselects an image).
          // Touch sends mousedown only for a tap, never for a swipe that scrolls; the scrollbar is left alone.
          const el = e.currentTarget;
          if (e.button !== 0 || !editor || !editor.isEditable || editor.view.dom.contains(e.target as Node)) return;
          if (e.clientX >= el.getBoundingClientRect().left + el.clientLeft + el.clientWidth) return;
          const sel = selectionFromPaper(editor.view, e.clientX, e.clientY);
          if (!sel) return;
          e.preventDefault(); // the focus does not leave the editor
          editor.view.dispatch(editor.state.tr.setSelection(sel)); // the pressed point is on screen: no scrolling
          if (!editor.view.hasFocus()) editor.view.focus();
        }}
      >
        <div className="paper-column">
          <EditorContent editor={editor} className="editor-content" />
        </div>
      </div>
      {upload.input}
    </section>
  );
}

/** How long after a change the document is scanned for fonts (debounced; it was per keystroke). */
export const FONT_SCAN_MS = 250;

// The note schema with the web-only image resize view (same node, same attributes) and its Tab key.
export const EDITOR_EXTENSIONS = [...noteExtensions.map((e) => (e.name === 'image' ? ResizableImage : e)), ImageResizeKeys, HeaderCellsInFirstRow];
