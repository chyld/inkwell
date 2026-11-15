# Code re-review b11 (dsor): web saving, drafts, uploads, Trash and sign-out

Scope: `src/web` at HEAD (the b45f617 fix plus the Round-2 ad7410b follow-up): `App.tsx`, `saver.ts`, `drafts.ts`, `signout.ts`, `trash.ts`, `components/NoteEditor.tsx`, `components/images.tsx`, `api.ts`, and the named web/saver tests. I did not run the suite; the named tests were read. (RESPONSE.md reports 154 tests; the lead's run was 138.)

Verified, no finding: Round-1 #8, #9, #13, #15–#19, #23 and Round-2 R6, R7, R9–R14. The code and tests match the claims; each test targets the pre-fix failure. R10's `emptyTrashFlow` is correct, but the App wrapper regressed (finding 2); R6/R12 are correct within one tab, but not across tabs (finding 1). R11's test is non-vacuous today because Trash stays enabled while the offer is open.

### 1. [high] A stale tab's Empty Trash can delete the next account's notes
Where: src/web/api.ts:27

Session/auth-epoch state is per tab; the cookie is shared. Leave Alice's Empty Trash confirmation open in tab A; sign out and in as Bob in tab B, then confirm in A: `DELETE /trash` carries Bob's cookie and deletes Bob's notes (the stale tab can also create notes/uploads in Bob's account). Fix: send the expected user id and reject a mismatch; invalidate pending work across tabs.

### 2. [medium] Cancelling Empty Trash closes the open editor
Where: src/web/App.tsx:280

`emptyTrashFlow` returns false on cancel, but `emptyTrash` ignores the result and always runs `setSelected(null)` and `loadList`. Open a note, switch to Trash, click Empty Trash, then Cancel: the editor closes and its save is left to unmount cleanup although nothing was deleted; the old code returned on cancel. Fix: return unless the flow resolves true, and leave the editor alone on error too.

### 3. [medium] A stalled image upload keeps every switch waiting
Where: src/web/components/images.tsx:85

`pendingUploads` loses a job only when its fetch settles; `api` has no signal or timeout, and `cancelUploads`/`closed` stop only queued files. If `POST /api/images` stalls, the job stays forever: every note switch waits the full 3 s and shows the upload notice, and the leave-site warning never clears. Fix: abort each upload on close/sign-out or a timeout, and settle/remove it on abort.

### 4. [medium] Trash does not wait for a pending image upload
Where: src/web/components/NoteEditor.tsx:265

`trash()` flushes the saver but not `waitForUploads`, and the Trash button stays enabled while `upload.busy`. Drop an image and immediately click Trash: the note moves and the editor unmounts; the upload then finishes, reports "not added to the note", and the image is never in the note (it is only in storage). Fix: await `waitForUploads` or disable the action while an upload is running.

### 5. [low] Silent draft-storage failure contradicts "kept on this device"
Where: src/web/drafts.ts:59

`localDrafts.set` swallows quota/disabled-storage errors, yet `saver.ts:172` and `App.tsx:137` tell the user changes are "kept on this device". With storage full/blocked and the server unreachable, type and close: no draft is written, nothing is offered on reopen, and the changes are lost (the sign-out prompt cannot count them either). Fix: let `set` report failure and show a distinct "cannot be kept on this device" warning.

VERDICT: DO NOT SHIP — the web fixes and tests in the focus area are genuine, but a stale tab's Empty Trash confirmation can permanently delete the next user's notes, and the remaining editor/upload/draft issues need fixes.
END-OF-REVIEW
