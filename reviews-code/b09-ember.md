### 1. [medium] Concurrent starters can destroy the pre-upgrade snapshot
Where: src/server/db.ts:136
Two processes that both see pending migrations each VACUUM INTO a pre-upgrade copy before taking the write lock. If the second copies after the first commits, it overwrites pre-upgrade.db with the migrated database, then no-ops, leaving no rollback copy. Hold BEGIN IMMEDIATE across the version check, snapshot and migration, or skip the rename when nothing remains.

### 2. [low] Data copy can keep rows for image files cleaned up mid-copy
Where: src/server/store.ts:929
dataCopy VACUUMs once, then copies files listed from the copy. An image unreferenced and deleted by cleanup between the two steps is skipped on disk, but its row stays in the copied database until startup reconciliation. Re-check each file against the live row list, or delete the now-orphaned rows from the copy before finishing.

### 3. [low] Corrupt hierarchy or missing Inbox crashes folder reads instead of erroring cleanly
Where: src/server/store.ts:429
listFolders force-unwraps each folder's parent and inboxId assumes an Inbox exists. Any inconsistency (older database, manual edit, failed rollback) makes whitescreen 500s on /folders and /me rather than a defined response or repair. Treat missing parents as roots and return a 500-safe response instead of throwing.

VERDICT: SHIP AFTER FIXES: fix the snapshot race first; the remaining items are minor hardening.
END-OF-REVIEW
