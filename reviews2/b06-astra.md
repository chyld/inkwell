### 1. [high] Unsaved drafts survive account boundaries
Section 6.3 stores private content in persistent localStorage under only a note id; sections 5 and 11 provide no draft cleanup when authentication ends. Signing out can therefore leave readable note content behind. Require user-scoped draft keys, restoration only after authenticating the matching user, and draft removal on sign-out, detected session invalidation, and account changes.

### 2. [medium] Failed saves can trap the user
Section 6.3 retries server errors indefinitely and makes navigation and sign-out wait for saving. A quota rejection under section 6.6 cannot succeed through retries, potentially preventing access to Trash to free space. Specify that 401, 400 and 413 stop automatic retries, and provide explicit recovery or discard actions that allow navigation and sign-out without falsely showing “Saved”.

### 3. [medium] Image references do not enforce note ownership
Sections 6.2 and 11 check image URL shape and user ownership, but section 6.5 assigns each image to one note. A valid body can therefore reference another note’s image belonging to the same user; deleting the original note breaks the surviving note. Require every image reference on save to resolve to an existing image owned by that user and that exact note.

### 4. [medium] Local HTTPS lacks a trust installation step
Section 12 assumes Caddy’s localhost certificate is locally trusted. Caddy running inside Docker cannot automatically install its root certificate into the host browser or MCP clients’ trust stores, so the required local tests can fail TLS verification. Require README instructions to export Caddy’s local CA certificate and configure host/browser and client-runtime trust before testing, without disabling certificate verification.

VERDICT: NOT READY — Resolve draft isolation, failed-save recovery, image reference integrity, and local certificate trust before building.
END-OF-REVIEW
