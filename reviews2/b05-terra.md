### 1. [high] Bind image references to their note
Section 6.2 checks only image URL syntax, so a user can reference another note's image or a nonexistent image. Deleting the owning note then breaks the reference. Require every referenced image to exist and belong to the note being saved, and reject violations before committing.

### 2. [high] Make image and database changes recoverable
Sections 6.5–6.6 require file deletion and atomic quota enforcement, but SQLite transactions cannot roll back filesystem writes or deletes. A crash or failed transaction can leave missing images, orphaned files or incorrect usage. Specify staged uploads, transactional metadata and quota reservations, plus restart reconciliation and deferred file deletion.

### 3. [medium] Preserve the version of an unsaved draft
Section 6.3 stores only the unsaved title and body. After a reload, restoring that draft using the newly fetched version can silently overwrite changes made elsewhere. Store the draft's base version with it and run the normal 409 conflict flow if the server version has changed.

### 4. [medium] Define safe rollback after an update
Section 12 says to restore `pre-upgrade.db` if an update fails, but does not say when to stop the app, how to handle SQLite WAL files, or what happens to writes made after migration. Specify a stopped-service restore procedure that handles WAL consistently and explicitly warns that later changes are lost.

### 5. [medium] Explain local certificate trust
Section 12 calls Caddy's localhost certificate locally trusted, but a CA generated inside its container is not automatically trusted by the host browser or MCP clients. Specify how the README obtains and trusts the local CA certificate, including client trust requirements, or provide another concrete local HTTPS setup.

VERDICT: NOT READY — Image integrity, draft conflicts, and deployment recovery need explicit rules before implementation.
END-OF-REVIEW
