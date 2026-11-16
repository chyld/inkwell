// Views, folder helpers and the folder tree (shown in the rail's Folders panel, Rail.tsx).
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Ellipsis, Folder } from 'lucide-react';
import { api, type FolderNode } from '../api';
import { useDialogs } from './Dialogs';

export type View =
  | { kind: 'all' }
  | { kind: 'inbox' }
  | { kind: 'unfiled' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; name: string }
  /** The /fonts page (FONTS-SPEC 7) and the /styles page (STYLES-SPEC 9): not lists of notes. */
  | { kind: 'fonts' }
  | { kind: 'styles' };

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

/** The folder tree with counts, expand/collapse and each folder's actions (shown in the rail's Folders panel). */
export function FolderTree({
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
        <button
          className="twisty"
          aria-label={open ? 'Collapse' : 'Expand'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
          style={{ visibility: folder.children.length ? 'visible' : 'hidden' }}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </button>
        <button className="folder-name" onClick={() => onView({ kind: 'folder', id: folder.id })}>
          <Folder className="icon" />
          <span className="label">{folder.name}</span>
          {folder.noteCount > 0 && <span className="count">{folder.noteCount}</span>}
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="icon-button folder-menu-button" aria-label={`Actions for ${folder.name}`} title="Folder actions" aria-haspopup="menu" onClick={() => setMenu(!menu)}>
            <Ellipsis />
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
