### 1. [medium] Deleting a user can break an in-progress data copy
Where: src/server/store.ts:248
If the owner deletes a user after a data copy snapshots the database but before it copies that user's images, deletion removes the entire image directory without checking the copy marker. The copy then fails despite the images existing when it started. The rewritten test covers note cleanup only. Defer user-directory removal while a copy is active and reconcile it afterward.

### 2. [medium] First uploaded image directory is not made durable
Where: src/server/images.ts:110
A user's first upload creates their image directory, but only that new directory is fsynced; its entry in the parent images directory is not. After a power loss following the 201, the directory and image can disappear while the committed database row survives. Fsync the parent after creating the directory, as well as the image directory after the rename. The named test checks only the latter.

VERDICT: SHIP AFTER FIXES — Concurrent account deletion can interrupt a copy, and a confirmed first image upload can be lost after power failure.
END-OF-REVIEW
