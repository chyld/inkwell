### 1. [high] No backups means one failure loses every note
Sections 2, 3 and 12 make backups 'None' while all notes live in one SQLite file on one VPS; disk failure, bad migration, or `user delete` is irreversible. Change §12 to require automatic daily encrypted off-VPS snapshots, 14-day retention, and a tested restore step in the README.

### 2. [high] Non-expiring agent tokens can spam-fill the disk
Section 8.1 issues tokens that never expire, Section 8.3 allows 60 notes/hour each, and no per-user storage or agent-count quota exists; a leaked token silently fills the disk/Inbox indefinitely until server CLI access revokes it. Change §8 to 90-day expiry, 10 notes/hour, and a 100 MB per-user quota.

### 3. [high] CLI writes SQLite directly while the app is running
Section 9 has the CLI write the SQLite file directly while Section 4's app process serves requests and runs migrations at startup; concurrent writers risk locking, stale-session, FTS, and cascade bypasses. Change §9 so the CLI calls the app's internal admin API, or requires stopping `app` before any write.

### 4. [medium] Sessions renew forever and users cannot change passwords
Section 5 renews 30-day sessions on use with no absolute expiry, and reserves password changes to the server CLI; a stolen cookie or known password therefore persists while the victim cannot act. Change §5 to a 30-day absolute cap, 7-day idle timeout, and in-app password change revoking other sessions.

### 5. [medium] Optimistic-locking version is never defined
Section 6.3 rejects saves using 'the note's last known version number', but Section 6.1 defines no version field, increment rule, or its MCP interaction; implementers will diverge and autosave conflicts can discard work. Change §6.1 to add an integer `version` starting at 1, incremented atomically on every successful save.

### 6. [medium] Scope is overbuilt for fewer than 10 users
For under 10 users (Section 1), Sections 6.4, 7.1, 7.2 and 10 require nested folders, drag-and-drop, tag renaming, a 30-day Trash job, phone layouts and themes before core reliability exists. Change §§6-10 to cut nesting beyond one level, drag-and-drop, and tag renaming; defer the rest until after launch.

VERDICT: Sound isolation and agent least-privilege, but do not build until data-loss, token-lifetime, and CLI-concurrency decisions are fixed.
END-OF-REVIEW
