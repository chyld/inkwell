import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, setUnauthorizedHandler, type FolderNode, type Me, type NoteItem, type TagCount } from './api';
import { localDrafts } from './drafts';
import { DialogProvider, useDialogs } from './components/Dialogs';
import { SignIn } from './components/SignIn';
import { Sidebar, findFolder, sameView, type View } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditorPane, activeSaver } from './components/NoteEditor';
import { waitForUploads } from './components/images';
import { signOutFlow } from './signout';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api<Me>('GET', '/me', undefined, { noAuthRedirect: true })
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="boot">Loading…</div>;
  return (
    <DialogProvider>
      {me === null ? (
        <SignIn
          onSignedIn={(m) => {
            // Drafts that belong to any other user are removed at sign-in.
            localDrafts.removeAllExcept(m.id);
            setMe(m);
          }}
        />
      ) : (
        <Main me={me} setMe={setMe} />
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

function Main({ me, setMe }: { me: Me; setMe: (m: Me | null) => void }) {
  const dialogs = useDialogs();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [items, setItems] = useState<NoteItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('list');
  const listSeq = useRef(0);

  const refreshFolders = useCallback(() => {
    api<{ folders: FolderNode[] }>('GET', '/folders').then((r) => setFolders(r.folders), () => {});
  }, []);
  const refreshTags = useCallback(() => {
    api<{ tags: TagCount[] }>('GET', '/tags').then((r) => setTags(r.tags), () => {});
  }, []);
  const refreshMe = useCallback(() => {
    api<Me>('GET', '/me').then(setMe, () => {});
  }, [setMe]);

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

  async function select(id: string) {
    if (id === selected) {
      setScreen('editor');
      return;
    }
    await settleCurrent();
    setFresh(null);
    setSelected(id);
    setScreen('editor');
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
    await settleCurrent();
    const folderId = view.kind === 'folder' ? view.id : view.kind === 'inbox' ? me.inboxId : null;
    try {
      const n = await api<NoteItem & { version: number }>('POST', '/notes', { folderId });
      setQuery('');
      setItems((prev) => [{ ...n, snippet: '' }, ...prev.filter((p) => p.id !== n.id)]);
      setFresh(n.id);
      setSelected(n.id);
      setScreen('editor');
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
      if (activeSaver.current?.hasUnconfirmed()) {
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
        activeSaver.current?.dispose();
        activeSaver.current = null;
      },
      notice: dialogs.notice,
    });
    if (done) setMe(null);
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
    refreshFolders();
    refreshTags();
    refreshMe();
  }

  async function emptyTrash() {
    const ok = await dialogs.confirm({
      title: 'Empty Trash',
      message: 'Permanently delete every note in Trash? This cannot be undone.',
      confirmLabel: 'Empty Trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', '/trash');
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
    }
    setSelected(null);
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
    <div className={`app screen-${screen}`}>
      <Sidebar me={me} folders={folders} tags={tags} view={view} onView={changeView} onFoldersChanged={refreshFolders} onSignOut={signOut} />
      <NoteList
        heading={heading}
        items={items}
        loading={loading}
        error={listError}
        hasMore={!!cursor && !searching}
        onLoadMore={() => loadList(true, cursor)}
        selectedId={selected}
        onSelect={select}
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
          onBack={() => setScreen('list')}
        />
      ) : (
        <section className="editor-pane empty">
          <p>Select a note, or create a new one.</p>
        </section>
      )}
    </div>
  );
}
