import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { api, ApiError, setUnauthorizedHandler, type FolderNode, type Me, type NoteItem, type TagCount } from './api';
import { localDrafts } from './drafts';
import { DialogProvider, useDialogs } from './components/Dialogs';
import { SignIn } from './components/SignIn';
import { Sidebar, findFolder, sameView, type View } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditorPane, NoteNotFound, activeSaver } from './components/NoteEditor';
import { currentRoute, initHistory, notePath, setAddress } from './route';
import { clearAllFonts } from './fonts/runtime';
import { waitForUploads } from './components/images';
import { signOutFlow } from './signout';
import { emptyTrashFlow } from './trash';
import { cancelUploads, hasPendingUploads } from './components/images';
import { NoteSaver } from './saver';
import { loadLayout, saveLayout, type Layout } from './layout';
import { currentAuthEpoch, getExpectedUser, newAuthEpoch, setExpectedUser } from './api';

// The user this tab signed in as. It is kept, also across reloads of the tab, until a sign-in or
// a confirmed sign-out in this tab: a 401 never clears it, so after another tab signs in as
// someone else this tab's requests keep saying who they are for and are refused.
const TAB_USER = 'notes:tab-user';
function rememberTabUser(id: string | null) {
  setExpectedUser(id);
  try {
    if (id) sessionStorage.setItem(TAB_USER, id);
    else sessionStorage.removeItem(TAB_USER);
  } catch {
    /* tolerated */
  }
}
function storedTabUser(): string | null {
  try {
    return sessionStorage.getItem(TAB_USER);
  } catch {
    return null;
  }
}

export function App() {
  const [me, setMeState] = useState<Me | null | undefined>(undefined);
  /** Accept user details only for the user this tab is signed in as. */
  const updateMe = useCallback((m: Me) => {
    if (m.id === getExpectedUser()) setMeState(m);
  }, []);
  const signedOut = useCallback(() => {
    rememberTabUser(null);
    setMeState(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      cancelUploads();
      newAuthEpoch(); // continuations started before this (e.g. New note) stop
      setMeState(null); // the sign-in page; the tab's user id is kept
    });
    (async () => {
      try {
        // A new tab asks whose session the cookie holds; a tab that already signed in keeps its user.
        const id = getExpectedUser() ?? storedTabUser() ?? (await api<{ id: string }>('GET', '/session', undefined, { noAuthRedirect: true })).id;
        rememberTabUser(id);
        updateMe(await api<Me>('GET', '/me', undefined, { noAuthRedirect: true }));
      } catch {
        setMeState(null);
      }
    })();
  }, [updateMe]);

  if (me === undefined) return <div className="boot">Loading…</div>;
  return (
    <DialogProvider>
      {me === null ? (
        <SignIn
          onSignedIn={(m) => {
            // Drafts that belong to any other user are removed at sign-in.
            localDrafts.removeAllExcept(m.id);
            newAuthEpoch(); // a late 401 from before this sign-in must not sign this user out
            rememberTabUser(m.id);
            setMeState(m);
          }}
        />
      ) : (
        <Main me={me} updateMe={updateMe} onSignedOut={signedOut} />
      )}
    </DialogProvider>
  );
}

type Screen = 'sidebar' | 'list' | 'editor';

function viewQuery(v: View): string {
  switch (v.kind) {
    case 'folder':
      return `view=folder&folder=${encodeURIComponent(v.id)}`;
    case 'tag':
      return `view=tag&tag=${encodeURIComponent(v.name)}`;
    default:
      return `view=${v.kind}`;
  }
}

function Main({ me, updateMe, onSignedOut }: { me: Me; updateMe: (m: Me) => void; onSignedOut: () => void }) {
  const dialogs = useDialogs();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [items, setItems] = useState<NoteItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // The address names the open note (/n/<id>); a fresh visit or a reload opens it (also after sign-in).
  const [initial] = useState(currentRoute);
  const [selected, setSelected] = useState<string | null>(initial.kind === 'note' ? initial.id : null);
  const [notFound, setNotFound] = useState(initial.kind === 'notFound');
  const [fresh, setFresh] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(initial.kind === 'list' ? 'list' : 'editor');
  useEffect(() => initHistory(), []);
  // Collapsed panels (wide screens only; on a narrow screen each panel is a screen of its own).
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const focusAfterToggle = useRef<string | null>(null);
  function togglePanel(which: keyof Layout) {
    const next = { ...layout, [which]: !layout[which] };
    setLayout(next);
    saveLayout(next);
    // The button that was pressed goes away; keep the focus on its counterpart.
    focusAfterToggle.current = `${which}-${next[which] ? 'show' : 'hide'}`;
  }
  useEffect(() => {
    if (focusAfterToggle.current) document.getElementById(focusAfterToggle.current)?.focus();
    focusAfterToggle.current = null;
  }, [layout]);
  const listSeq = useRef(0);

  const refreshFolders = useCallback(() => {
    api<{ folders: FolderNode[] }>('GET', '/folders').then((r) => setFolders(r.folders), () => {});
  }, []);
  const refreshTags = useCallback(() => {
    api<{ tags: TagCount[] }>('GET', '/tags').then((r) => setTags(r.tags), () => {});
  }, []);
  const refreshMe = useCallback(() => {
    api<Me>('GET', '/me').then(updateMe, () => {});
  }, [updateMe]);

  useEffect(() => {
    refreshFolders();
    refreshTags();
  }, [refreshFolders, refreshTags]);

  const searching = query.trim().length > 0 && view.kind !== 'trash';

  const loadList = useCallback(
    async (append: boolean, cur: string | null) => {
      const seq = ++listSeq.current;
      setLoading(true);
      setListError(null);
      try {
        if (searching) {
          const narrow: Record<string, string | boolean> = {};
          if (view.kind === 'folder') narrow.folderId = view.id;
          if (view.kind === 'inbox') narrow.folderId = me.inboxId;
          if (view.kind === 'tag') narrow.tag = view.name;
          if (view.kind === 'unfiled') narrow.unfiled = true;
          const r = await api<{ results: NoteItem[] }>('POST', '/search', { query, ...narrow });
          const results = r.results;
          if (seq !== listSeq.current) return;
          setItems(results);
          setCursor(null);
        } else {
          const r = await api<{ notes: NoteItem[]; nextCursor: string | null }>('GET', `/notes?${viewQuery(view)}${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`);
          if (seq !== listSeq.current) return;
          setItems((prev) => (append ? [...prev, ...r.notes.filter((n) => !prev.some((p) => p.id === n.id))] : r.notes));
          setCursor(r.nextCursor);
        }
      } catch (e) {
        if (seq !== listSeq.current) return;
        setListError(e instanceof ApiError ? e.message : 'Could not reach the server.');
        if (e instanceof ApiError && e.status === 404 && view.kind === 'folder') setView({ kind: 'all' });
      } finally {
        if (seq === listSeq.current) setLoading(false);
      }
    },
    [view, query, searching, me.inboxId],
  );

  // Reload when the view changes; search is debounced 200 ms.
  useEffect(() => {
    const t = setTimeout(() => loadList(false, null), searching ? 200 : 0);
    return () => clearTimeout(t);
  }, [loadList, searching]);

  /** Wait up to 3 s for a pending save; tell the user if changes stay only on this device. */
  async function settleCurrent(): Promise<void> {
    const start = Date.now();
    // An image still uploading is inserted (and then saved) when it arrives.
    const uploadsDone = await waitForUploads(3000);
    const s = activeSaver.current;
    const ok = !s || !s.hasUnconfirmed() || (await s.flush(Math.max(500, 3000 - (Date.now() - start))));
    if (!ok) dialogs.notice('Some changes could not be saved yet. They are kept on this device and will be offered when you open the note again.');
    else if (!uploadsDone) dialogs.notice('An image is still uploading; it will not be added to the note you are leaving.');
  }

  /** Open a note: from the list, or from Back/Forward (which must not add history entries). */
  async function select(id: string, fromHistory = false) {
    if (id === selected && !notFound) {
      setScreen('editor');
      if (!fromHistory) setAddress(notePath(id), 'push');
      return;
    }
    await settleCurrent();
    setFresh(null);
    setNotFound(false);
    setSelected(id);
    setScreen('editor');
    if (!fromHistory) setAddress(notePath(id), 'push');
  }

  /** Close the open note (the same flush as switching notes); the address returns to "/". */
  async function closeNote(address: 'push' | 'replace' | 'none') {
    if (selected) await settleCurrent();
    setSelected(null);
    setNotFound(false);
    setScreen('list');
    if (address !== 'none') setAddress('/', address);
  }

  // Back and Forward go through the same paths as a click.
  const onPopRef = useRef<() => void>(() => {});
  onPopRef.current = () => {
    const r = currentRoute();
    if (r.kind === 'note') void select(r.id, true);
    else if (r.kind === 'notFound') {
      void (async () => {
        if (selected) await settleCurrent();
        setSelected(null);
        setNotFound(true);
        setScreen('editor');
      })();
    } else void closeNote('none');
  };
  useEffect(() => {
    const on = () => onPopRef.current();
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  /** "Browse fonts…": the note is saved first, as on any navigation, then /fonts. */
  async function openFonts() {
    await settleCurrent();
    setAddress('/fonts', 'push');
  }

  /** From the not-found state: all notes, no note open, and the bad address replaced (so Back does not return to it). */
  function allNotes() {
    void changeView({ kind: 'all' });
    void closeNote('replace');
  }

  async function changeView(v: View) {
    if (!sameView(v, view)) {
      setView(v);
      setItems([]);
      setCursor(null);
    }
    setScreen('list');
  }

  async function newNote() {
    if (view.kind === 'trash') return;
    const epoch = currentAuthEpoch();
    await settleCurrent();
    if (epoch !== currentAuthEpoch()) return; // signed out (or refused) while waiting
    const folderId = view.kind === 'folder' ? view.id : view.kind === 'inbox' ? me.inboxId : null;
    try {
      const n = await api<NoteItem & { version: number }>('POST', '/notes', { folderId });
      setQuery('');
      setItems((prev) => [{ ...n, snippet: '' }, ...prev.filter((p) => p.id !== n.id)]);
      setFresh(n.id);
      setNotFound(false);
      setSelected(n.id);
      setScreen('editor');
      setAddress(notePath(n.id), 'push');
      refreshFolders();
      refreshMe();
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
    }
  }

  // Keyboard shortcut for a new note: Ctrl+Alt+N (⌘⌥N on a Mac).
  const newNoteRef = useRef(newNote);
  newNoteRef.current = newNote;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN')) {
        e.preventDefault();
        void newNoteRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // "Leave site?" warning while changes are unconfirmed. No save is attempted during unload.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Unconfirmed changes in any note (one may still be saving after a switch), or an image still uploading.
      if (NoteSaver.anyUnconfirmed() || hasPendingUploads()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  async function signOut() {
    await settleCurrent();
    const done = await signOutFlow({
      userId: me.id,
      drafts: localDrafts,
      confirmDiscard: (count) =>
        dialogs.confirm({
          title: 'Sign out',
          message: `${count === 1 ? 'One note has' : `${count} notes have`} changes that are only on this device. Signing out discards them.`,
          confirmLabel: 'Discard and sign out',
          danger: true,
        }),
      deleteSession: () => api('DELETE', '/session', undefined, { noAuthRedirect: true }),
      disposeSaver: () => {
        cancelUploads();
        NoteSaver.disposeAll();
        activeSaver.current = null;
      },
      notice: dialogs.notice,
    });
    if (done) {
      newAuthEpoch();
      setAddress('/', 'replace'); // the next person to sign in here starts with no note open
      clearAllFonts(); // every registered face and rule, previews included
      onSignedOut();
    }
  }

  function patchItem(id: string, patch: Partial<NoteItem>) {
    setItems((prev) => {
      const i = prev.findIndex((n) => n.id === id);
      if (i === -1) return prev;
      const next = { ...prev[i], ...patch };
      const rest = prev.filter((n) => n.id !== id);
      // Newest update first: an edited note moves to the top.
      return patch.updatedAt && !searching ? [next, ...rest] : prev.map((n) => (n.id === id ? next : n));
    });
    if ('folderId' in patch) {
      refreshFolders();
      if ((view.kind === 'folder' && patch.folderId !== view.id) || (view.kind === 'inbox' && patch.folderId !== me.inboxId) || (view.kind === 'unfiled' && patch.folderId !== null)) {
        setItems((prev) => prev.filter((n) => n.id !== id));
      }
    }
    if ('tags' in patch && view.kind === 'tag' && !patch.tags!.includes(view.name)) setItems((prev) => prev.filter((n) => n.id !== id));
  }

  function removed(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    setSelected(null);
    setScreen('list');
    setAddress('/', 'replace'); // moved to Trash, restored or deleted: no note is open
    refreshFolders();
    refreshTags();
    refreshMe();
  }

  async function emptyTrash() {
    let emptied = false;
    try {
      emptied = await emptyTrashFlow({
        userId: me.id,
        drafts: localDrafts,
        trashedIds: async () => {
          const ids: string[] = [];
          let cursor: string | null = null;
          do {
            const r: { notes: NoteItem[]; nextCursor: string | null } = await api('GET', `/notes?view=trash${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
            ids.push(...r.notes.map((n) => n.id));
            cursor = r.nextCursor;
          } while (cursor);
          return ids;
        },
        confirm: (message) => dialogs.confirm({ title: 'Empty Trash', message, confirmLabel: 'Empty Trash', danger: true }),
        emptyTrash: () => api('DELETE', '/trash'),
      });
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
      return;
    }
    if (!emptied) return; // cancelled: nothing changed, the open note stays open
    setSelected(null);
    setNotFound(false);
    setAddress('/', 'replace');
    loadList(false, null);
    refreshTags();
    refreshMe();
  }

  const heading =
    view.kind === 'all'
      ? 'All notes'
      : view.kind === 'inbox'
        ? 'Inbox'
        : view.kind === 'unfiled'
          ? 'Unfiled'
          : view.kind === 'trash'
            ? 'Trash'
            : view.kind === 'tag'
              ? `#${view.name}`
              : (findFolder(folders, view.id)?.name ?? 'Folder');

  return (
    <div className={`app screen-${screen}${layout.sidebar ? ' sidebar-collapsed' : ''}${layout.list ? ' list-collapsed' : ''}`}>
      {layout.sidebar && <PanelStrip id="sidebar-show" controls="sidebar" label="Show folders and tags" text="Folders" onClick={() => togglePanel('sidebar')} />}
      <Sidebar
        me={me}
        folders={folders}
        tags={tags}
        view={view}
        onView={changeView}
        onFoldersChanged={refreshFolders}
        onSignOut={signOut}
        collapsed={layout.sidebar}
        onCollapse={() => togglePanel('sidebar')}
      />
      {layout.list && <PanelStrip id="list-show" controls="note-list" label="Show note list" text={heading} onClick={() => togglePanel('list')} />}
      <NoteList
        collapsed={layout.list}
        onCollapse={() => togglePanel('list')}
        heading={heading}
        items={items}
        loading={loading}
        error={listError}
        hasMore={!!cursor && !searching}
        onLoadMore={() => loadList(true, cursor)}
        selectedId={selected}
        onSelect={(id) => void select(id)}
        query={query}
        onQuery={setQuery}
        searching={searching}
        isTrash={view.kind === 'trash'}
        onNewNote={newNote}
        onEmptyTrash={emptyTrash}
        onBack={() => setScreen('sidebar')}
      />
      {selected ? (
        <NoteEditorPane
          key={selected}
          noteId={selected}
          me={me}
          folders={folders}
          allTags={tags}
          autoFocusTitle={fresh === selected}
          onMeta={patchItem}
          onTrashed={removed}
          onRestored={removed}
          onDeleted={removed}
          onTagsChanged={refreshTags}
          onStorageChanged={refreshMe}
          onBack={() => void closeNote('push')}
          onAllNotes={allNotes}
          onBrowseFonts={() => void openFonts()}
        />
      ) : notFound ? (
        <NoteNotFound onBack={() => void closeNote('push')} onAllNotes={allNotes} />
      ) : (
        <section className="editor-pane empty">
          <p>Select a note, or create a new one.</p>
        </section>
      )}
    </div>
  );
}

/** The slim strip a collapsed panel leaves behind (wide screens only): one button that brings the panel back. */
function PanelStrip({ id, controls, label, text, onClick }: { id: string; controls: string; label: string; text: string; onClick: () => void }) {
  return (
    <button id={id} className="panel-strip" aria-expanded={false} aria-controls={controls} aria-label={label} title={label} onClick={onClick}>
      <PanelLeftOpen className="panel-strip-icon" />
      <span className="panel-strip-text" aria-hidden>
        {text}
      </span>
    </button>
  );
}
