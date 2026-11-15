### 1. [high] Manual copies can silently omit referenced images
Where: src/server/store.ts:924

`VACUUM INTO` snapshots the database, but files are copied afterward from the live tree. If a save unlinks an old image and cleanup deletes it after the snapshot, lines 936–937 skip it while the snapshot’s note still references it; the command reports success and restoration loses that image. Serialize image mutations with the whole copy and fail on any missing file.

### 2. [medium] Unbounded image decoding permits memory/CPU exhaustion
Where: src/server/images.ts:24

An authenticated user can upload many small, highly compressed 10,000×10,000 images or long animations concurrently. `stats()` fully decodes every pixel of every frame with no concurrency or work limit, so modest request volume can exhaust the documented 1 GB VPS. Serialize and bound decoding, and validate animation frames with bounded resources rather than an unconstrained all-frame Sharp operation.

### 3. [low] Unlink failures turn committed deletes into 500s and strand files
Where: src/server/store.ts:872

After an image row is deleted, `rmSync` can throw (for example, EACCES or EIO). The note deletion has already committed, yet the API returns 500; cleanup aborts, and later passes no longer select the rowless file, leaving it until restart. Catch unlink failures per victim, continue, and arrange filesystem reconciliation/retry without changing the completed request’s outcome.

VERDICT: SHIP AFTER FIXES, because manual copies can silently lose referenced images and image decoding needs resource controls.

END-OF-REVIEW