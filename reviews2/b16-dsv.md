### 1. [high] Sessions are never checked for expiry
Section 5 removes expired rows only at startup and sign-in, and never says a request re-checks expiry or refreshes last-used; a long-running container therefore honours a session far past 90 days. Add: every authenticated request rejects and deletes a session whose `last_used` exceeds 30 days or `created_at` exceeds 90, refreshing `last_used` at most hourly.

### 2. [high] New notes have no id, so images cannot be uploaded
Sections 6.3 and 10 never say when a new note reaches the server, yet 6.5 attaches every uploaded image to a note id; an image pasted before the first save has no id to upload against. Add to 6.3: "New note" immediately POSTs `/api/notes` with the current folder and returns the id and version 1.

### 3. [medium] Images are not confined to their note
Section 6.2 accepts any `/api/images/<id>` source, while 6.5 deletes "images of that note" on permanent delete and after 24 hours unreferenced. Copying content from one note into another therefore deletes images the second note still shows. Change 6.2 to require the image row's `note_id` to match the note being saved, and state that cross-note paste re-uploads.

### 4. [medium] Tag and folder edits cause false 409s
Section 6.1 bumps `version` on tag and folder changes, but 6.3 saves only title, body and version. Tagging a note while a save is in flight leaves the editor's version stale, so its next autosave returns 409 and offers "keep mine/load theirs" for a conflict that never happened. Scope `version` to title and body only.

### 5. [low] Conflict handling is oversized, and retries never stop
Section 6.3's keep-mine/load-theirs dialog, localStorage restore prompt and 2/5/15-second retry ladder are heavy for single-editor notes; the ladder also retries permanent 400/413/401 forever, leaving "Not saved" and blocking sign-out. Replace with last-write-wins plus a changed-elsewhere banner, and retry only network and 5xx errors.

VERDICT: NOT READY — session expiry, new-note creation and image ownership are unresolved and would yield a security hole, a build blocker and broken images.
END-OF-REVIEW
