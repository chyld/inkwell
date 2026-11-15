# Re-review — b12 (GLM): round-2 fix commit ad7410b, web front end

Scope: savers and local drafts (disposal of every live saver at sign-out,
Discard against a newer draft, locks while the draft offer is open, Empty
Trash and drafts, trashing a note with a stored draft), upload tracking and
the leave-site warning (SPEC 6.3, 10). Read: src/web (saver.ts, drafts.ts,
signout.ts, trash.ts, api.ts, App.tsx, NoteEditor.tsx, images.tsx),
test/saver.test.ts, test/web/*, the data-copy tests, the commit diff
(`git show ad7410b` and its parent), RESPONSE.md Round 2, DEVIATIONS.md.
Read-only; no tests, npm, docker or servers were run; no agents started.

Every Round 2 row in this area is really fixed, and each named test traces
to a failure the pre-fix code produces. R6: uploadAll checks the upload epoch
and the closed flag before each file (src/web/components/images.tsx:84-91)
and sign-out cancels batches once the server confirms it (App.tsx:220); on
the old loop the queued second file is posted, so both tests fail without it.
R7: api() binds each request to an auth epoch and honors a 401 only if it is
still current (src/web/api.ts:24,48), bumped at sign-in and sign-out
(App.tsx:34,227); without the epoch check the test's handler fires. R9:
NoteSaver.live plus disposeAll (src/web/saver.ts:23-29) run before drafts are
removed (signout.ts:31, App.tsx:221); the un-disposed saver writes the draft
back after removeAllFor and sends a second PUT, so the test fails. R10:
emptyTrashFlow mentions and removes the deleted notes' drafts
(src/web/trash.ts:15-27) using deletedIds the server returns
(src/server/api.ts:120-122). R11: trash() also refuses a note with a stored
draft (NoteEditor.tsx:268); without that clause the test's POST /trash goes
out. R12: beforeunload fires on any live saver's unconfirmed changes or a
pending upload (App.tsx:197); the dialog itself is not automated, as the
response admits, but the wiring is present. R13: Discard re-reads storage and
keeps a draft whose savedAt or owner changed (NoteEditor.tsx:215-221); the
test deletes the other tab's draft without the guard. R14: tags and Move
to… are locked together with the editor (`locked`, NoteEditor.tsx:305,379).
R8's "not a defect" is correct: createSessionIfUnchanged re-reads the row
inside the transaction and refuses a disabled user or a changed hash
(src/server/store.ts:313-319), and disabling deletes all sessions
(store.ts:234), so a session appears only when a fresh sign-in with the same
credentials would succeed at that moment. The rewritten round-1 data-copy
test still proves what the lock was for: real clean-up runs mid-copy and the
finished copy still contains the image (test/images.test.ts:240), a
busy_timeout=0 connection writes during the copy (line 260), and an
interrupted run leaves no partial target behind (line 290).

### 1. [low] Canceling Empty Trash now closes the note being read

Where: src/web/App.tsx:280

Open a trashed note in Trash, click Empty Trash, then Cancel: emptyTrashFlow
returns false but its result is discarded, so setSelected(null) and the
reloads still run — the old code returned before them. The note being read
closes although nothing was deleted; the same happens if the trash listing
fails. Fix: early-return when the flow returns false, keeping the cleanup for
emptied/error paths.

VERDICT: SHIP AFTER FIXES — every round-2 fix in this focus area is genuine, complete and test-backed (and R8's verdict stands); only the small Empty Trash cancel-path regression the commit introduced remains.
END-OF-REVIEW
