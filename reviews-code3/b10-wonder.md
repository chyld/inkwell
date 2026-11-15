### 1. [low] A signed-out user's in-flight upload still counts as the next user's pending upload
Where: src/web/components/images.tsx:13
Start a slow upload as Alice, sign out after the 3 s wait, then sign in as Bob while it still runs. `cancelUploads()` only bumps the epoch; the job stays in shared `pendingUploads` until it settles. Bob's note switches stall in `waitForUploads`, can show "An image is still uploading…", and tab-close warns, though he has no upload. Fix: drop or epoch-tag pending jobs at sign-out.

### 2. [low] An already-open tab can be permanently refused Trash by another tab's stale draft, with no way to act on it
Where: src/web/components/NoteEditor.tsx:268
Open a note in tab A; in tab B edit it, leave changes unsaved, and close tab B (draft stored). In tab A, Move to Trash always refuses with "Try again once they are saved", yet tab A never offers that draft (it is read only at mount, lines 132–140) and cannot save or discard it without reloading. Fix: offer that draft when Trash is refused for this reason.

### 3. [low] Cancelling Empty Trash now closes the open trashed note
Where: src/web/App.tsx:280
In Trash, open a trashed note, click Empty Trash, then Cancel. `emptyTrashFlow` returns `false`, but `emptyTrash()` ignores that result and still runs `setSelected(null)` and reloads the list, closing the editor although nothing was deleted (before this commit, cancelling returned early). The same happens if fetching the trashed ids fails. Fix: only clear the selection and refresh when the flow returns `true`.

VERDICT: SHIP — Every Round 2 "fixed" item in the focus area (R9–R14, plus R6/R7) is genuinely implemented in the code its named test exercises, the rewritten data-copy test really does run clean-up mid-copy through the permanent-delete route, the R8 "not a defect" verdict is correct, and the remaining issues above are low-severity.
END-OF-REVIEW
