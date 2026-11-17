// The rail (REDESIGN-BRIEF 2.1): a narrow column of icons in the rail colour, replacing the sidebar. Top: All
// notes, Inbox, Folders, Tags. Bottom: Fonts, Styles, Trash, account. Folders and Tags open a panel over the
// list; account opens a small menu. A panel closes when something is chosen, on Escape and on a click outside;
// after a choice or Escape the focus returns to the rail button. On a phone the rail is a bar along the bottom
// and the panels are sheets (CSS only).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleUser, File, Folder, Inbox, Notebook, Paintbrush, Plus, Tag, Trash2, Type, X } from 'lucide-react';
import { api, type FolderNode, type Me, type TagCount } from '../api';
import { formatBytes } from '../util';
import { useDialogs } from './Dialogs';
import { FolderTree, type RailView, type View } from './folders';
import { ApiError } from '../api';

type Panel = 'folders' | 'tags' | 'account';

interface Props {
  me: Me;
  folders: FolderNode[];
  tags: TagCount[];
  view: RailView;
  onView: (v: RailView) => void;
  onFoldersChanged: () => void;
  onSignOut: () => void;
  /** New note (DEVIATIONS 48): as the list's New button, from every screen. */
  onNewNote: () => void;
}

export function Rail({ me, folders, tags, view, onView, onFoldersChanged, onSignOut, onNewNote }: Props) {
  const dialogs = useDialogs();
  const [panel, setPanel] = useState<Panel | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const inbox = folders.find((f) => f.isInbox);
  const tree = folders.filter((f) => !f.isInbox);
  const ids = { folders: useId(), tags: useId(), account: useId(), inboxCount: useId() };

  function close(refocus: boolean) {
    const was = panel;
    setPanel(null);
    if (refocus && was) buttons.current[was]?.focus();
  }

  // A click outside the panel closes it (not one in a dialog the panel opened, nor on its own rail button,
  // which toggles it). The click goes where it was aimed: the focus is not moved.
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || panelRef.current?.contains(t) || buttons.current[panel]?.contains(t) || t.closest?.('.modal-backdrop')) return;
      setPanel(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [panel]);

  // Opening a panel moves the focus into it.
  useEffect(() => {
    if (!panel) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], button, [href], input');
    first?.focus();
  }, [panel]);

  function onPanelKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  /** Choosing a view from a panel shows it and closes the panel, the focus back on the rail button. */
  function choose(v: View) {
    close(true);
    onView(v);
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (e) {
      dialogs.notice(e instanceof ApiError ? e.message : 'Could not reach the server.');
    }
    onFoldersChanged();
  }

  async function newFolder(parentId: string | null) {
    const name = await dialogs.prompt({ title: parentId ? 'New subfolder' : 'New folder', label: 'Name', confirmLabel: 'Create' });
    if (name === null) return;
    await run(async () => {
      const f = await api<FolderNode>('POST', '/folders', { name, parentId });
      choose({ kind: 'folder', id: f.id });
    });
  }

  const toggle = (p: Panel) => (panel === p ? close(true) : setPanel(p));
  // The storage line is fetched when the account menu opens (not after every save); until it arrives, the
  // figures from the last fetch (or sign-in) show.
  const [usage, setUsage] = useState<Pick<Me, 'storageUsed' | 'storageLimit'>>(me);
  useEffect(() => {
    if (panel !== 'account') return;
    let live = true;
    api<Me>('GET', '/me').then(
      (m) => live && setUsage(m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [panel]);
  const pct = Math.min(100, (usage.storageUsed / usage.storageLimit) * 100);
  const storage = `${formatBytes(usage.storageUsed)} of ${formatBytes(usage.storageLimit)} used`;

  const item = (label: string, icon: ReactNode, current: boolean, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button type="button" className={'rail-button' + (current ? ' current' : '')} aria-label={label} title={label} aria-current={current ? 'page' : undefined} onClick={onClick} {...extra}>
      {icon}
    </button>
  );
  const opener = (p: Panel, label: string, icon: ReactNode, current: boolean) => (
    <button
      type="button"
      ref={(el) => {
        buttons.current[p] = el;
      }}
      className={'rail-button' + (current ? ' current' : '') + (panel === p ? ' open' : '')}
      aria-label={label}
      title={label}
      aria-current={current ? 'true' : undefined}
      aria-haspopup="dialog"
      aria-expanded={panel === p}
      aria-controls={panel === p ? ids[p] : undefined}
      onClick={() => toggle(p)}
    >
      {icon}
    </button>
  );

  return (
    <nav id="rail" className="rail" aria-label="Navigation">
      <div className="rail-group">
        <button type="button" className="rail-button rail-new" aria-label="New note" title="New note" onClick={() => (close(false), onNewNote())}>
          <Plus />
        </button>
        {item('All notes', <Notebook />, view.kind === 'all', () => (close(false), onView({ kind: 'all' })))}
        {inbox && (
          <span className="rail-badge-anchor">
            {item('Inbox', <Inbox />, view.kind === 'inbox', () => (close(false), onView({ kind: 'inbox' })), inbox.noteCount > 0 ? { 'aria-describedby': ids.inboxCount } : {})}
            {inbox.noteCount > 0 && (
              <span className="rail-badge" id={ids.inboxCount} aria-label={`${inbox.noteCount} notes`}>
                {inbox.noteCount}
              </span>
            )}
          </span>
        )}
        {opener('folders', 'Folders', <Folder />, view.kind === 'folder' || view.kind === 'unfiled')}
        {opener('tags', 'Tags', <Tag />, view.kind === 'tag')}
      </div>
      <div className="rail-group rail-bottom">
        {item('Fonts', <Type />, view.kind === 'fonts', () => (close(false), onView({ kind: 'fonts' })))}
        {item('Styles', <Paintbrush />, view.kind === 'styles', () => (close(false), onView({ kind: 'styles' })))}
        {item('Trash', <Trash2 />, view.kind === 'trash', () => (close(false), onView({ kind: 'trash' })))}
        {opener('account', 'Account', <CircleUser />, false)}
      </div>

      {panel === 'folders' && (
        <div id={ids.folders} ref={panelRef} className="rail-panel" role="dialog" aria-label="Folders" onKeyDown={onPanelKey}>
          <header className="rail-panel-header">
            <h2>Folders</h2>
            <button type="button" className="icon-button" title="New folder" aria-label="New folder" onClick={() => newFolder(null)}>
              <Plus />
            </button>
            <button type="button" className="icon-button" title="Close" aria-label="Close" onClick={() => close(true)}>
              <X />
            </button>
          </header>
          <div className="rail-panel-scroll">
            <FolderTree folders={tree} all={folders} depth={0} view={view} onView={choose} run={run} newFolder={newFolder} />
            <button type="button" className={'view-button' + (view.kind === 'unfiled' ? ' active' : '')} aria-current={view.kind === 'unfiled' ? 'page' : undefined} onClick={() => choose({ kind: 'unfiled' })}>
              <span className="icon" aria-hidden>
                <File />
              </span>
              <span className="label">Unfiled</span>
            </button>
          </div>
        </div>
      )}

      {panel === 'tags' && (
        <div id={ids.tags} ref={panelRef} className="rail-panel" role="dialog" aria-label="Tags" onKeyDown={onPanelKey}>
          <header className="rail-panel-header">
            <h2>Tags</h2>
            <button type="button" className="icon-button" title="Close" aria-label="Close" onClick={() => close(true)}>
              <X />
            </button>
          </header>
          <div className="rail-panel-scroll">
            {tags.length === 0 && <p className="sidebar-empty">No tags yet</p>}
            <div className="tag-cloud">
              {tags.map((t) => (
                <button
                  type="button"
                  key={t.name}
                  className={'tag-chip' + (view.kind === 'tag' && view.name === t.name ? ' active' : '')}
                  aria-current={view.kind === 'tag' && view.name === t.name ? 'page' : undefined}
                  onClick={() => choose({ kind: 'tag', name: t.name })}
                >
                  #{t.name} <span className="count">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {panel === 'account' && (
        <div id={ids.account} ref={panelRef} className="account-menu" role="dialog" aria-label="Account" onKeyDown={onPanelKey}>
          <p className="account-name">
            <CircleUser />
            <span className="username" title="Signed in">
              {me.username}
            </span>
          </p>
          <div className="storage" title={storage}>
            <div className="storage-bar">
              <div className={'storage-fill' + (pct > 90 ? ' full' : '')} style={{ width: `${pct}%` }} />
            </div>
            <span>{storage}</span>
          </div>
          <button type="button" className="btn sign-out" data-autofocus onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
