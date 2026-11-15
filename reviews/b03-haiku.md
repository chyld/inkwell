### 1. [high] Rate limits break behind Caddy

Behind Caddy, all requests come from Caddy's IP, so the 20-per-IP limit (section 5) locks everyone out once 20 failures occur from any user; naively trusting a client-sent X-Forwarded-For would bypass it. Change: trust X-Forwarded-For only from Caddy's address; key the per-username limit on username plus IP, so one attacker cannot lock out a user.

### 2. [high] Database copy command is unsafe in WAL mode

Section 12 (README item 1) makes a hand copy of the database file the only recovery method. In WAL mode, recent commits sit in notes.db-wal, so copying notes.db alone silently loses them. Change: add `notes backup <file>` to section 9 (SQLite online backup API or VACUUM INTO), make the README use it, and add a restore test to section 13.

### 3. [medium] Version number missing from note model

Section 6.3 requires each save to send the note's version, and the server to reject stale saves, but section 6.1 lists no version field. Change: add to 6.1: "A version integer, starting at 1, incremented on every save. A save with any other version gets HTTP 409."

### 4. [medium] Folder delete rule conflicts with Trash

Section 7.1 allows deleting only folders with no notes, but 6.4 keeps trashed notes with their old folder and restores them there "if it still exists". Unclear whether a folder holding only trashed notes can be deleted. Change: in 7.1, trashed notes do not block folder deletion; deleting a folder unfiles its trashed notes.

### 5. [medium] Acceptance test 4 contradicts the MCP handshake

Section 13 item 4 says every MCP operation other than create_note fails with the token, but a client cannot call create_note without initialize and tools/list succeeding (section 8.2). As written the test cannot pass. Change: replace with "only the MCP handshake (initialize, notifications, tools/list) and tools/call for create_note succeed; any other tool name fails."

### 6. [medium] Deployment gaps that will break the first run

Section 12 never says how NOTES_HOST reaches Caddy's config, and section 11 runs the app as non-root without saying the data volume is writable by that user, so SQLite will likely fail on first start. Change: the Caddyfile reads `{$NOTES_HOST}` and the caddy service receives NOTES_HOST; the Dockerfile chowns the data directory before USER; the Origin check compares against `https://<NOTES_HOST>`.

VERDICT: Well-scoped and buildable for fewer than 10 users once the rate-limit, backup, version-field and deployment gaps are fixed; the feature list and stack are heavier than this audience needs but not harmful.
END-OF-REVIEW
