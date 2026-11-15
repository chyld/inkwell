# Code review — b12 (GLM), against SPEC.md draft 3

Read: SPEC.md, DEVIATIONS.md, src/web/** (App, saver, drafts, NoteEditor, Sidebar,
NoteList, Dialogs, images, api, util, styles), src/shared/schema.ts, the server
(api, app, store, images, mcp, markdown, config, db, main, ratelimit, passwords,
clients, errors), the CLI, deployment files, and the test suite. Read-only; no
tests or servers were run.

### 1. [medium] Draft banner outlives its draft; "Restore" can overwrite newer content

Where: src/web/components/NoteEditor.tsx:129-147 (also 185-198, 287-299; src/web/saver.ts:115)

`draft` state is set only at mount (line 136) and cleared only by Restore/Discard. When a save confirms, saver.ts:115 deletes the localStorage draft, but nothing clears the banner, so the editor keeps offering a draft that no longer exists. Steps: open a note that has a draft, edit, let the autosave succeed — the banner still shows. Clicking Restore re-applies the mount-time draft over the newer content and saves with the stale base version; after the resulting 409, "Keep mine" overwrites the newer saved note with the old draft. Fix: clear `draft` from `onSaved`, and re-read the store when restoring.

### 2. [low] Autosave confirmation runs a stale closure and reorders search results

Where: src/web/components/NoteEditor.tsx:105-127 (with src/web/App.tsx:218-234)

`makeSaver` is memoized on `[me.id, note.id]` and invoked from a `[]`-deps effect, so `onSaved` permanently holds the first render's `props.onMeta` — App's `patchItem` with its mount-time `searching` (App.tsx:225). Steps: open a note, type in the search box (results ranked with bm25 per SPEC 7.3), then let the autosave confirm: `patch.updatedAt && !searching` is evaluated with the stale `searching=false`, so the saved note jumps to the top of the search results instead of keeping rank order. Fix: keep the callback in a ref updated each render, or read `searching` from a ref.

VERDICT: SHIP AFTER FIXES — the core flows (schema validation, autosave and versioning, the 409 choice, drafts persistence, sign-out, isolation, images, MCP, deployment) are solid and genuinely tested, but the stale draft banner with its content-overwriting Restore path should be fixed first.
END-OF-REVIEW