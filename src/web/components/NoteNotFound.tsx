import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { APP_TITLE, NOT_FOUND_TITLE } from '../route';

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
        <button className="btn primary" onClick={onAllNotes}>
          Go to all notes
        </button>
      </div>
    </section>
  );
}
