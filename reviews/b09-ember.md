### 1. [high] No backups plus auto-migration guarantees data loss
Sections 2 and 12 promise no backups yet auto-run migrations on container start, so a bad migration, disk loss, or accidental user delete destroys all notes irrecoverably. Require a pre-migration database snapshot, document the manual copy from section 12 in the README, and add a daily encrypted backup before launch.

### 2. [high] Agent and session auth split is prose only
Sections 4, 8, and 11 run /api, /mcp, and static files in one process, splitting agent tokens from browser sessions only by prose. One router bug exposes notes via tokens. Require separate auth middleware, reject browser Origin/CORS on /mcp, and add acceptance tests proving /api tokens and /mcp sessions both fail.

### 3. [high] Sliding sessions and Host-derived CSRF origin
Section 5 gives 30-day sessions renewed on use with no absolute expiry, no rotation on login, and Origin checked against the app origin without saying how it is derived. Stolen cookies live forever and Host spoofing defeats CSRF checks. Require rotation on login, an absolute 30-day cap, and validation against NOTES_HOST from section 12.

### 4. [medium] Trash purge and direct SQLite CLI have no scheduler
Sections 6.4, 9, and 12 require a daily Trash purge and direct SQLite CLI access, but Compose runs only app and caddy with no scheduler or lock protocol while the app holds WAL. The purge never runs and concurrent writes risk corruption. Require an in-process timer with busy_timeout or a scheduler service, and stop the app for CLI writes.

### 5. [medium] Per-username rate limit enables lockout denial of service
Section 5 allows five failed sign-ins per username per 15 minutes, so anyone can permanently lock out any of the fewer than 10 users by guessing their name. Require IP-only throttling or exponential backoff, never a per-username hard lock, and keep identical responses to avoid enumeration.

### 6. [medium] FTS5 query parsing is not actually specified
Sections 7.3 and 11 require FTS5 input passed as data never spliced, but FTS5 still parses operators and quotes unless the whole query is quoted and escaped. Require exact quoting/escaping rules, prefix matching on the quoted last term only, and FTS-index updates in the same transaction as note saves.

VERDICT: Do not build yet; fix backups, auth separation, sessions, scheduling, lockout, and search escaping first.
END-OF-REVIEW
