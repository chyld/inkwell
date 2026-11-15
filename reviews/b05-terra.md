### 1. [high] Manual database copy can lose committed notes
Section 12 asks for a single file-copy command while section 4 enables SQLite WAL. Committed data may still reside in the WAL, so copying only the database can produce an incomplete or inconsistent backup. Specify a SQLite online backup command or a documented stopped-container procedure that captures a consistent database and includes restore steps.

### 2. [high] Cross-user writes are not specified
Sections 11 and 13 address queries and fetching, but do not explicitly require ownership checks on mutations or referenced folder and tag IDs. A crafted request could attach a note to another user's folder or alter another user's data. Require owner-scoped authorization for every read and mutation, including all referenced IDs, and test cross-user writes.

### 3. [medium] Autosave can silently lose edits
Section 6.3 requires saving when a page is hidden, but a normal asynchronous request may be terminated on navigation or process shutdown; concurrent saves can also arrive out of order. Specify serialized saves, durable local recovery for unsent edits, and a warning before navigation with unsaved changes. Test closing or reloading during an in-flight save.

### 4. [medium] Trash and tag lifecycle conflict
Section 7.2 deletes a tag when no note outside Trash uses it, while section 6.4 allows restoring trashed notes. A note's tags can therefore disappear before restoration, and rename behavior for trashed notes is unclear. Keep tags while any note uses them, include trashed notes in renames, and restore their associations.

### 5. [medium] Proxy-aware rate limiting is underspecified
Section 5 limits attempts per IP, but all requests reach the app through Caddy. Without a trusted-proxy policy, every user may share one limit, or an attacker may spoof forwarded addresses. Specify that Caddy overwrites client IP headers and Fastify trusts them only from the Caddy proxy; test both cases.

### 6. [low] Scope is heavy for a tiny first release
Sections 6.4, 7 and 10 combine scheduled Trash cleanup, nested folders, tags, ranked live search, drag and drop, and mobile navigation for fewer than 10 users. These add substantial implementation and testing work. Define a minimal first release with flat folders, basic search, and menu-based moves; defer the remaining features pending actual use.

VERDICT: The core approach is plausible, but data safety and authorization need clearer requirements before implementation.
END-OF-REVIEW
