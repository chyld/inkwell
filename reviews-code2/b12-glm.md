# Re-review — b12 (GLM): fix commit b45f617, web front end

Scope: the reworked saver and local drafts (read-only until Restore/Discard,
per-editor draft ownership, disposal on sign-out, in_trash retry), upload
tracking, Trash and sign-out flows (SPEC 6.3, 10). Read: src/web (saver.ts,
drafts.ts, signout.ts, App.tsx, NoteEditor.tsx, images.tsx, api.ts,
Dialogs.tsx, NoteList.tsx, SignIn.tsx), test/saver.test.ts, test/web/*,
reviews-code/RESPONSE.md rows 8, 9, 13, 15, 16, 17, 18, 19, 23, the fix
commit diff, and the first-round reviews that raised them. Read-only; no tests
or servers were run.

Every "fixed" row in this area checks out in the code, and each named test
traces to a concrete failure mode that exists on the pre-fix code: the
disposed check in the PUT success handler (else-branch writeDraft recreated a
discarded draft and again=true sent a second PUT); the lock (isEditable was
true while the offer was open, so writeDraft overwrote the stored draft);
clearOwnDraft (the confirm unconditionally removed a key another tab owned);
409 in_trash latching 'gone' blocked all later saves; trash() ignored flush's
false; restoreDraft applied the mount-time snapshot; onSaved ran the first
render's onMeta. Sign-out (row 8) required a new module, but the old App.tsx
code swallowed every DELETE error and still called setMe(null), so the defect
and fix are both real. The lock is complete: ProseMirror's editHandlers
(paste/drop) never run while editable is false (prosemirror-view input.ts:52),
and title/tags cannot overwrite the draft (tags PATCH does not touch it).
No "not a defect" row falls in this area. One low defect remains.

### 1. [low] Empty Trash leaves permanently deleted notes' drafts behind

Where: src/web/App.tsx:258

Edit a note, reload (a draft is pending), then click Move to Trash: the fresh saver has nothing unconfirmed, so the note trashes with the draft still stored. Empty Trash permanently deletes it but removes no draft (unlike Delete permanently, NoteEditor.tsx:281). The key dangles until sign-out, can never be offered again (the note 404s), and inflates the sign-out discard prompt. Fix: remove the deleted notes' drafts after DELETE /trash succeeds.

VERDICT: SHIP — every claimed fix in the web front end is genuinely and completely fixed with tests that fail without the change, and the one remaining low defect is a bounded localStorage leak, not a blocker.
END-OF-REVIEW
