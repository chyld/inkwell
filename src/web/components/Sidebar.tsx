import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type FolderNode, type Me, type TagCount } from '../api';
import { formatBytes } from '../util';
import { useDialogs } from './Dialogs';

export type View =
  | { kind: 'all' }
  | { kind: 'inbox' }
  | { kind: 'unfiled' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; name: string };

export function sameView(a: View, b: View) {
  return a.kind === b.kind && (a as any).id === (b as any).id && (a as any).name === (b as any).name;
}

export function findFolder(folders: FolderNode[], id: string | null | undefined): FolderNode | null {
  if (!id) return null;
  for (const f of folders) {
    if (f.id === id) return f;
    const c = findFolder(f.children, id);
    if (c) return c;
  }
  return null;
}

export function folderPath(folders: FolderNode[], id: string | null): string {
  const out: string[] = [];
  const walk = (list: FolderNode[], trail: string[]): boolean => {
    for (const f of list) {
      if (f.id === id) {
        out.push(...trail, f.name);
        return true;
      }
      if (walk(f.children, [...trail, f.name])) return true;
    }
    return false;
  };
  walk(folders, []);
  return out.join(' / ');
}

export function isInSubtree(root: FolderNode, id: string): boolean {
  if (root.id === id) return true;
  return root.children.some((c) => isInSubtree(c, id));
}

interface Props {
  me: Me;
  folders: FolderNode[];
  tags: TagCount[];
  view: View;
  onView: (v: View) => void;
  onFoldersChanged: () => void;
  onSignOut: () => void;
}

export function Sidebar({ me, folders, tags, view, onView, onFoldersChanged, onSignOut }: Props) {
  const dialogs = useDialogs();
  const inbox = folders.find((f) => f.isInbox);
  const tree = folders.filter((f) => !f.isInbox);

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
      onView({ kind: 'folder', id: f.id });
    });
  }

  const pct = Math.min(100, (me.storageUsed / me.storageLimit) * 100);

  return (
    <nav className="sidebar" aria-label="Folders and views">
      <div className="sidebar-scroll">
        <ViewButton label="All notes" icon="🗒️" active={view.kind === 'all'} onClick={() => onView({ kind: 'all' })} />
        {inbox && <ViewButton label="Inbox" icon="📥" count={inbox.noteCount} active={view.kind === 'inbox'} onClick={() => onView({ kind: 'inbox' })} />}
        <div className="sidebar-heading">
          <span>Folders</span>
          <button className="icon-button" title="New folder" aria-label="New folder" onClick={() => newFolder(null)}>
            +
          </button>
        </div>
        <FolderTree folders={tree} all={folders} depth={0} view={view} onView={onView} run={run} newFolder={newFolder} />
        <ViewButton label="Unfiled" icon="📄" active={view.kind === 'unfiled'} onClick={() => onView({ kind: 'unfiled' })} />
        <div className="sidebar-heading">
          <span>Tags</span>
        </div>
        {tags.length === 0 && <p className="sidebar-empty">No tags yet</p>}
        <div className="tag-cloud">
          {tags.map((t) => (
            <button
              key={t.name}
              className={'tag-chip' + (view.kind === 'tag' && view.name === t.name ? ' active' : '')}
              onClick={() => onView({ kind: 'tag', name: t.name })}
            >
              #{t.name} <span className="count">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-gap" />
        <ViewButton label="Trash" icon="🗑️" active={view.kind === 'trash'} onClick={() => onView({ kind: 'trash' })} />
      </div>
      <div className="sidebar-footer">
        <div className="storage" title={`${formatBytes(me.storageUsed)} of ${formatBytes(me.storageLimit)} used`}>
          <div className="storage-bar">
            <div className={'storage-fill' + (pct > 90 ? ' full' : '')} style={{ width: `${pct}%` }} />
          </div>
          <span>
            {formatBytes(me.storageUsed)} of {formatBytes(me.storageLimit)} used
          </span>
        </div>
        <div className="account">
          <span className="username" title="Signed in">
            {me.username}
          </span>
          <button className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}

function ViewButton({ label, icon, count, active, onClick }: { label: string; icon: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button className={'view-button' + (active ? ' active' : '')} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="icon" aria-hidden>
        {icon}
      </span>
      <span className="label">{label}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  );
}

function FolderTree({
  folders,
  all,
  depth,
  view,
  onView,
  run,
  newFolder,
}: {
  folders: FolderNode[];
  all: FolderNode[];
  depth: number;
  view: View;
  onView: (v: View) => void;
  run: (a: () => Promise<unknown>) => Promise<void>;
  newFolder: (parentId: string | null) => Promise<void>;
}) {
  return (
    <ul className="folder-tree" role={depth === 0 ? 'tree' : 'group'}>
      {folders.map((f) => (
        <FolderItem key={f.id} folder={f} all={all} depth={depth} view={view} onView={onView} run={run} newFolder={newFolder} />
      ))}
    </ul>
  );
}

function FolderItem({
  folder,
  all,
  depth,
  view,
  onView,
  run,
  newFolder,
}: {
  folder: FolderNode;
  all: FolderNode[];
  depth: number;
  view: View;
  onView: (v: View) => void;
  run: (a: () => Promise<unknown>) => Promise<void>;
  newFolder: (parentId: string | null) => Promise<void>;
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = view.kind === 'folder' && view.id === folder.id;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  async function rename() {
    setMenu(false);
    const name = await dialogs.prompt({ title: 'Rename folder', label: 'Name', initial: folder.name, confirmLabel: 'Rename' });
    if (name === null || name === folder.name) return;
    await run(() => api('PATCH', `/folders/${folder.id}`, { name }));
  }
  async function move() {
    setMenu(false);
    const pick = await dialogs.pickFolder({
      title: `Move “${folder.name}” to…`,
      folders: all,
      rootLabel: 'Top level',
      current: folder.parentId,
      disabled: (f) => f.isInbox || isInSubtree(folder, f.id),
    });
    if (!pick || pick.id === folder.parentId) return;
    await run(() => api('PATCH', `/folders/${folder.id}`, { parentId: pick.id }));
  }
  async function remove() {
    setMenu(false);
    const ok = await dialogs.confirm({
      title: 'Delete folder',
      message: `Delete “${folder.name}”? Only an empty folder can be deleted; notes from it that are in Trash become unfiled.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api('DELETE', `/folders/${folder.id}`);
      if (active) onView({ kind: 'all' });
    });
  }

  return (
    <li role="treeitem" aria-expanded={folder.children.length ? open : undefined} aria-selected={active}>
      <div className={'folder-row' + (active ? ' active' : '')} style={{ paddingLeft: 6 + depth * 14 }}>
        <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} style={{ visibility: folder.children.length ? 'visible' : 'hidden' }}>
          {open ? '▾' : '▸'}
        </button>
        <button className="folder-name" onClick={() => onView({ kind: 'folder', id: folder.id })}>
          <span aria-hidden>📁</span> {folder.name}
          {folder.noteCount > 0 && <span className="count">{folder.noteCount}</span>}
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="icon-button folder-menu-button" aria-label={`Actions for ${folder.name}`} aria-haspopup="menu" onClick={() => setMenu(!menu)}>
            ⋯
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => (setMenu(false), newFolder(folder.id))}>
                New subfolder
              </button>
              <button role="menuitem" onClick={rename}>
                Rename…
              </button>
              <button role="menuitem" onClick={move}>
                Move to…
              </button>
              <button role="menuitem" className="danger-text" onClick={remove}>
                Delete…
              </button>
            </div>
          )}
        </div>
      </div>
      {open && folder.children.length > 0 && <FolderTree folders={folder.children} all={all} depth={depth + 1} view={view} onView={onView} run={run} newFolder={newFolder} />}
    </li>
  );
}
