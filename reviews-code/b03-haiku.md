### 1. [medium] Confirmed saves can roll back after a power loss
Where: src/server/db.ts:116
A save shows "Saved" when the WAL commit returns, but `synchronous = NORMAL` does not sync the log on each commit. After a power cut or kernel crash, the last confirmed saves can roll back, and the client has already deleted its draft. With no backups, that edit is gone. Fix: `synchronous = FULL`, one fsync per commit, which is cheap at this scale.

### 2. [low] A missing image file makes its note unsaveable
Where: src/server/store.ts:914
If an image file is missing at boot, reconcileImageFiles deletes the row. The cascade drops the note_images link, but the note body still references /api/images/<id>. Every later save of that note fails in assertImagesOwned (store.ts:617) with 400, and the editor shows "Not saved". Fix: keep rows that a note_images link still uses, so saves keep working.

### 3. [low] A second process can overwrite the pre-upgrade snapshot
Where: src/server/db.ts:136
migrate() reads user_version (line 129), then runs VACUUM INTO and renames the copy over pre-upgrade.db with no lock. If the app and a CLI command start together during an update, the later snapshot can be taken after the other process commits. That replaces the pre-migration snapshot with a post-migration one, so rollback no longer restores the old schema. Fix: hold a lock file across snapshot and migration, and re-read user_version after taking it.

VERDICT: SHIP AFTER FIXES - the folder, tag, Trash, versioning, transaction and migration code matches SPEC 6.1-6.6, 7.1-7.3 and 12 on reading, and the durability setting should be fixed before the owner relies on it.
END-OF-REVIEW
