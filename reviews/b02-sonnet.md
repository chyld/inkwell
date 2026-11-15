### 1. [high] "No backups" plus auto-migrations and an unsafe copy command
Section 12 runs migrations automatically on start, and the README's "one command that copies the database file" would be a plain `cp` of a live WAL database, which can produce a corrupt copy. Change sections 2 and 12: the README command must be `sqlite3 <db> ".backup <file>"`, and the app must run it automatically before any migration.

### 2. [medium] Login rate limits break behind Caddy and enable lockout
Section 5 limits by IP, but the app only sees Caddy's address, so the limit becomes global or trusts a spoofable X-Forwarded-For. The per-username limit also lets anyone lock out a known user indefinitely. Change section 5: read the client IP only from Caddy's header and trust it only from the Compose network. Count failures per username plus IP.

### 3. [medium] Volume permissions and SQLite concurrency are unspecified
Sections 4, 9, 11 and 12: a non-root `app` cannot open a root-owned named volume, which is the most likely first-deploy failure. The CLI and the app also both write SQLite. Add to section 12: the image creates and chowns the data directory, `busy_timeout` is set, and the Caddyfile is a listed deliverable.

### 4. [medium] FTS consistency with tags and Trash is undefined
Section 7.3 indexes title, body and tag names, but section 7.2 allows tag rename and section 6.4 allows Trash and restore. The spec never says how the index stays correct. Change section 7.3: the index is updated in the same transaction as every note, tag or Trash change. Alternatively, drop tag rename, which is not needed for fewer than 10 users.

### 5. [low] Over-engineering for fewer than 10 users
Several features cost more than they return. Change the spec to remove nested folders to depth 5 (section 7.1), tag rename (7.2), drag and drop (10), the 60-notes-per-hour agent limit (8.3) and the daily Trash purge job (6.4). Keep one flat folder level and a manual "Empty Trash".

### 6. [low] Agent-supplied Markdown is the main untrusted input but its validation is unnamed
Section 8.3 converts Markdown on the server but does not name the parser, and section 6.3 validation is stated only for editor saves. Change section 8.3: converter output must pass the same section 6.3 schema validation before storage. Add a test to section 13 for raw HTML, `javascript:` links and oversized input.

VERDICT: A sound, security-conscious design, but the backup and migration story, proxy-aware rate limiting and first-deploy volume permissions must be fixed before building, and the feature set should be trimmed.
END-OF-REVIEW
