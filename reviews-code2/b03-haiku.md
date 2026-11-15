### 1. [medium] Confirmed image uploads can lose their file after power loss
Where: src/server/images.ts:100
The upload commits its row, renames the file in and returns 201, with no fsync of the file or directory. After a power cut the row can survive while the file is empty or missing. Startup deletes a missing file's row (SPEC 6.5), so a confirmed image is lost and notes using it cannot be saved. Fix: fsync the temp file before the insert and the directory after the rename.

### 2. [medium] Data copy blocks live writes while it snapshots
Where: src/server/store.ts:964
dataCopy holds BEGIN IMMEDIATE across its VACUUM INTO and image linking. On the live server, each save or upload waits the 5 s busy timeout inside a synchronous call, then gets a 500. A DELETE /notes with images to clean up can return 500 after the delete committed (api.ts:113-115). Fix: take the snapshot without the lock (WAL reads are consistent) and hold it only for the link pass.

### 3. [low] A lock timeout during upgrade escapes the migration error path
Where: src/server/db.ts:137
BEGIN IMMEDIATE sits before the try block, so a lock timeout (SQLITE_BUSY after 5 s, while another process holds the write lock) escapes as a raw error. main.ts logs it as 'fatal' with a stack trace and exits 1, not with the clear 'database migration failed' line SPEC 12 asks for. Fix: move the BEGIN IMMEDIATE inside the try and wrap failures as MigrationError.

VERDICT: SHIP AFTER FIXES - the folder, tag, Trash, versioning and transaction code has no defect I could verify, and the snapshot-lock and synchronous fixes are correct, but the image durability gap and the copy lock should be fixed first.
END-OF-REVIEW
