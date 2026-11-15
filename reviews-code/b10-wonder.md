### 1. [high] Sign-out can resurrect a discarded draft
Where: src/web/saver.ts:110
Make one edit whose PUT is slow, make another, then sign out and confirm discarding drafts. `signOut` removes drafts and disposes the saver, but the in-flight PUT's success handler has no disposed check: it calls `writeDraft()` for the remaining edit, recreating `draft:<user>:<note>` after removal, or saves despite discard. Guard completion handlers when disposed and settle or abort in-flight saves before draft removal.

### 2. [medium] A trashed-then-restored note can never save again in the open tab
Where: src/web/saver.ts:164
In tab A open a note; in tab B trash it, so A's next PUT gets 409 `in_trash`. The saver maps every non-version 409 to terminal `gone`, and `change()` refuses to send while `gone`. Even after B restores the note, A can edit indefinitely without another save attempt, with only “Not saved” shown. Map `in_trash` to a retryable-on-next-edit state or reload the note state.

### 3. [medium] Image uploads are invisible to switch, close and insertion-position handling
Where: src/web/components/images.tsx:26
Start a slow image upload, then switch notes or keep typing. The settle logic only waits for the `NoteSaver`, not uploads; `uploadOne` resumes after `await` and silently returns if the editor was destroyed, leaving an orphaned upload and an unchanged note. If still open, the captured drop position is stale and can insert in the wrong place. Track uploads as pending work and map or validate the insertion position.

### 4. [medium] Trashing ignores a failed final save and can lead to permanent loss
Where: src/web/components/NoteEditor.tsx:240
With the network down or a conflict active, click Trash. `trash()` awaits `flush(3000)` but ignores its `false` result and trashes anyway, with no notice. Opening the note in Trash suppresses the draft offer for trashed notes, and Delete permanently can then destroy the only local copy without mentioning it. Abort or confirm when flush fails, and warn about a local draft before permanent deletion.

### 5. [low] Draft offer stays stale after new edits and Restore overwrites them
Where: src/web/components/NoteEditor.tsx:287
Open a note with an old draft, ignore the banner, and type new edits. The saver overwrites the stored draft, but the component's draft state and banner still describe the old snapshot. Clicking Restore then replaces the current edits with that stale snapshot without warning. Clear or update the draft offer on the first new saver change, or confirm when current unsaved edits would be replaced.

### 6. [low] Unfiled search filters only after the server's 50-result limit
Where: src/web/App.tsx:94
In the Unfiled view, search is sent unfiltered to `/search`, the server returns only its top 50 ranked matches, and the app then filters to `folderId === null`. An unfiled match ranked below filed matches falsely produces “No notes match your search.” Add server-side unfiled narrowing before the limit, like folder and tag narrowing, instead of filtering a truncated result set.

VERDICT: SHIP AFTER FIXES — the sign-out draft race and the latched, ignored and untracked save paths must be fixed before this can be trusted with real notes.
END-OF-REVIEW
