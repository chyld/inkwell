### 1. [high] No safe backup or recovery story

“Backups: None” (§2) risks total data loss, and manually copying a live SQLite database (§12) is unsafe in WAL mode. Replace §2, §3, and §12 with nightly SQLite online backups, defined retention, an off-VPS copy procedure, a pre-upgrade backup, and a documented restore drill; specify the CLI/API used for consistency.

### 2. [high] Login throttling enables denial of service

The per-username limit (§5) lets an attacker continually lock out a victim, while an unspecified proxy-aware client-IP scheme may put everyone behind Caddy’s address. Require canonical username plus validated client IP keys, retain an IP-wide limit, restrict proxy trust to Caddy, and define window/reset behavior; do not impose an attacker-triggerable account-wide lockout (§4, §5, §11).

### 3. [medium] Search escaping and highlighting are underspecified

Binding an FTS5 `MATCH` parameter prevents SQL injection but does not neutralize FTS operators, so quotes, colons, or parentheses can alter queries or cause errors (§7.3). Require tokenization and double-quote escaping, with prefix `*` added only to the final term. Return plain-text snippets with match ranges, not FTS-generated HTML, and add hostile-query/XSS tests (§11, §13).

### 4. [medium] Autosave concurrency can lose edits

The version rule (§6.3) does not require an atomic compare-and-swap or define overlapping autosaves and “keep mine,” permitting races and repeated false conflicts. Specify one in-flight save with queued latest state, transactionally update only when the version matches, increment versions on every mutation, and make “keep mine” retry against the newly fetched server version; add concurrent-save tests (§13).

### 5. [medium] Compose startup and upgrades are not resilient

Section 12 omits restart policies, migration failure behavior, and health semantics, so reboots can leave the app stopped and `/healthz` can report readiness too early. Require `restart: unless-stopped` for both services, make health pass only after successful migrations/database access, fail startup on migration errors, and document version-pinned upgrades and rollback compatible with the backup procedure.

VERDICT: The architecture is proportionate for a small private app, but the draft is not implementation-ready until durability, authentication throttling, search safety, concurrency, and deployment recovery are specified.
END-OF-REVIEW
