// A screen loaded on demand (the editor, /fonts, /styles) whose code cannot be loaded: usually the app was updated
// on the server and this page asks for a file of the previous build. Instead of a blank app, a message and a Reload
// that keeps the address and writes every pending draft first (BUGFIX-LIST item 2).
import { Component, type ReactNode } from 'react';
import { NoteSaver } from '../saver';

/** Set when Vite reports that a file of a lazily loaded screen could not be preloaded (the app was likely updated). */
let newerBuildLikely = false;
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    newerBuildLikely = true; // the import still fails, and the boundary below shows the message
  });
}

export function reloadKeepingDrafts() {
  NoteSaver.writeAllDrafts();
  window.location.reload();
}

export class ScreenErrorBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="editor-pane empty screen-error" aria-label={this.props.label}>
        <div className="not-found" role="alert">
          <h2>This part of the app could not be loaded</h2>
          <p>{newerBuildLikely ? 'The app was probably updated on the server. ' : ''}Reload the page to continue; your unsaved changes are kept on this device.</p>
          <button className="btn primary" onClick={reloadKeepingDrafts}>
            Reload
          </button>
        </div>
      </section>
    );
  }
}
