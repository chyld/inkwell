### 1. [high] Cached images bypass authorization after account changes
Where: src/server/images.ts:105
Alice views an image, signs out, and Bob signs in using the same browser profile. The image response remains fresh for a year without varying on Cookie, so revisiting its URL can return Alice's cached bytes without running the ownership check. Sign-out does not clear this cache. Require session revalidation on every reuse with private, no-cache, must-revalidate, or use no-store.

### 2. [high] An in-flight login can survive a password reset
Where: src/server/store.ts:258
checkCredentials reads the password hash before awaiting Argon2. If the CLI password change commits during verification, it deletes existing sessions, but verification against the old hash subsequently succeeds and POST /session creates a fresh valid session. Someone holding the old password retains access after the reset. Recheck the verified hash and enabled state and insert the session in one transaction, rejecting changed credentials.

### 3. [medium] Failed sign-out leaves a valid session behind
Where: src/web/App.tsx:212
Take the network offline and click Sign out. The failed DELETE is swallowed and the app shows the sign-in screen, although its HttpOnly cookie and server session remain valid. Once connectivity returns, another person can reload and access the previous user's notes without credentials. Treat only successful deletion or an already-invalid session as completion; show failures and allow retry instead of claiming sign-out succeeded.

### 4. [medium] Parallel sign-ins bypass both failure limits
Where: src/server/api.ts:44
Send many concurrent wrong-password requests from one IP before any Argon2 verification finishes. Each sees empty failure counters and enters checkCredentials; none rechecks the limit before verification, so arbitrarily many guesses are processed despite the five-per-pair and twenty-per-IP limits. The rate-limit tests send requests serially and miss this. Reserve pending attempts against both limits before awaiting verification, releasing reservations on success and recording failures on completion.

### 5. [medium] Editing before choosing draft recovery destroys the draft
Where: src/web/components/NoteEditor.tsx:155
Reopen a note with an unsaved local draft and type into the editable server copy before selecting Restore or Discard. onUpdate sends that edit through the new saver, overwriting the existing draft's localStorage key; successful autosave then removes it. Closing or switching notes loses the original unsaved content without discarding it explicitly. Disable editing and autosave until the recovery choice, or preserve the pending draft separately.

### 6. [medium] Manual copies can silently omit referenced images
Where: src/server/store.ts:937
After dataCopy snapshots the database, the running app can permanently delete a snapshotted note and clean up its old image before the CLI copies that file. The missing file is silently skipped, yet the command succeeds with a database still containing the note and image reference. Restoring this copy loses the image. Coordinate snapshot/file copying with image deletion across processes, and fail rather than silently omit missing files.

VERDICT: SHIP AFTER FIXES — Correct the authorization, session, and data-preservation defects before deployment.
END-OF-REVIEW
