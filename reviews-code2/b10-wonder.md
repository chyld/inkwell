### 1. [high] Sign-out misses a saver still flushing after a note switch
Where: src/web/components/NoteEditor.tsx:146
Open note A, make two edits while its PUT is slow, switch to B before the 3 s flush ends, then sign out and confirm discarding drafts. Cleanup keeps A's saver flushing undisposed until its own timeout (line 146), while sign-out disposes only `activeSaver` (B). A's late success can call `writeDraft()` and send again after `removeAllFor`, resurrecting a discarded draft. Fix: track and dispose every live saver before draft removal.

### 2. [medium] Empty Trash leaves drafts of permanently deleted notes behind
Where: src/web/App.tsx:249
Give a trashed note a local draft (its save failed, then it was trashed in another tab), then use Empty Trash. Unlike Delete permanently (`NoteEditor.tsx:281`), `emptyTrash` deletes trashed notes without removing or mentioning their `draft:<user>:<note>` entries. The orphaned draft can never be offered again, yet still counts as unsaved at sign-out. Fix: have the server return deleted ids, remove their drafts, and mention them in the confirmation.

### 3. [medium] Closing the tab during an upload gives no leave-site warning
Where: src/web/App.tsx:191
Drop or paste an image and close or reload the tab before the upload finishes. No saver change exists until insertion, so `hasUnconfirmed()` is false and the handler at line 191 shows no warning; the upload is abandoned and the image never reaches the note. Fix: also trigger `beforeunload` while uploads are pending, by exporting a pending-upload check from `images.tsx`.

### 4. [medium] Discard deletes a newer draft another tab wrote after the offer appeared
Where: src/web/components/NoteEditor.tsx:215
While this tab shows the Restore/Discard banner, another tab can restore and edit the same draft, replacing the stored entry. Restore now re-reads storage, but Discard (line 215) removes whatever is currently stored without comparing it with the offered draft, deleting the other tab's newer unsaved work. Fix: re-read on Discard too, and keep the draft with a warning if its `savedAt` or owner changed.

### 5. [low] Draft lock leaves tags and Move editable
Where: src/web/components/NoteEditor.tsx:371
While a draft offer is pending, body and title are locked, but TagEditor stays enabled (`readOnly={trashed}` only) and Move to… stays clickable. Either one PATCHes the server note immediately, before Restore or Discard is chosen, so the note is not actually read-only and its metadata can diverge from the draft decision. Fix: disable tags and Move while `locked`, as the toolbar already is.

VERDICT: SHIP AFTER FIXES — the residual sign-out draft resurrection and the untracked permanent-delete and tab-close paths must be fixed before the draft guarantees can be trusted.
END-OF-REVIEW
