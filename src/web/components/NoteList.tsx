import type { NoteItem } from '../api';
import { ChevronLeft, PanelLeftClose, Plus } from 'lucide-react';
import { highlightPieces, isMac, relativeTime } from '../util';

interface Props {
  heading: string;
  items: NoteItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  searching: boolean;
  isTrash: boolean;
  onNewNote: () => void;
  onEmptyTrash: () => void;
  onBack: () => void;
  collapsed: boolean;
  onCollapse: () => void;
}

export function NoteList(p: Props) {
  const shortcut = isMac() ? '⌘⌥N' : 'Ctrl+Alt+N';
  return (
    <section id="note-list" className={'note-list' + (p.collapsed ? ' collapsed' : '')} aria-label="Notes">
      <header className="list-header">
        <button className="icon-button mobile-only" onClick={p.onBack} aria-label="Back to folders" title="Back to folders">
          <ChevronLeft />
        </button>
        <button
          id="list-hide"
          className="icon-button collapse-button desktop-only"
          aria-expanded={true}
          aria-controls="note-list"
          aria-label="Hide note list"
          title="Hide note list"
          onClick={p.onCollapse}
        >
          <PanelLeftClose />
        </button>
        <h2 title={p.heading}>{p.heading}</h2>
        {!p.isTrash && (
          <button className="primary" onClick={p.onNewNote} title={`New note (${shortcut})`}>
            <Plus /> New note
          </button>
        )}
        {p.isTrash && p.items.length > 0 && !p.searching && (
          <button className="danger" onClick={p.onEmptyTrash}>
            Empty Trash
          </button>
        )}
      </header>
      {!p.isTrash && (
        <div className="search-box">
          <input
            type="search"
            placeholder={p.heading === 'All notes' ? 'Search notes' : `Search in ${p.heading}`}
            aria-label="Search notes"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
          />
        </div>
      )}
      <div className="list-scroll">
        {p.error && <p className="list-message error">{p.error}</p>}
        {!p.loading && !p.error && p.items.length === 0 && (
          <p className="list-message">{p.searching ? 'No notes match your search.' : p.isTrash ? 'Trash is empty.' : 'No notes here yet.'}</p>
        )}
        <ul>
          {p.items.map((n) => (
            <li key={n.id}>
              <button className={'note-item' + (n.id === p.selectedId ? ' selected' : '')} onClick={() => p.onSelect(n.id)} aria-current={n.id === p.selectedId}>
                <div className="note-item-top">
                  <span className={'note-title' + (n.title ? '' : ' untitled')}>
                    <Highlight text={n.title || 'Untitled'} query={p.searching ? p.query : ''} />
                  </span>
                  <time dateTime={n.updatedAt}>{relativeTime(p.isTrash ? n.trashedAt : n.updatedAt)}</time>
                </div>
                {n.snippet && (
                  <p className="note-snippet">
                    <Highlight text={n.snippet} query={p.searching ? p.query : ''} />
                  </p>
                )}
                {(n.tags.length > 0 || n.origin.type === 'agent') && (
                  <div className="note-meta">
                    {n.origin.type === 'agent' && <span className="agent-badge">by {n.origin.name}</span>}
                    {n.tags.map((t) => (
                      <span key={t} className="tag-chip small">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        {p.loading && <p className="list-message">Loading…</p>}
        {p.hasMore && !p.loading && (
          <button className="load-more" onClick={p.onLoadMore}>
            Load more
          </button>
        )}
      </div>
    </section>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlightPieces(text, query).map((piece, i) => (piece.hit ? <mark key={i}>{piece.text}</mark> : <span key={i}>{piece.text}</span>))}
    </>
  );
}
