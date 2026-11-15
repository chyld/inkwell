### 1. [medium] First-upload parent directory is not fsynced
Where: src/server/images.ts:110
On a user's first upload, line 110 creates `images/<userId>`, but line 112 fsyncs only that new directory. Its entry in `images` is never fsynced. After a 201 followed by a power cut, the per-user directory can disappear; startup then deletes the database row (`src/server/store.ts:944-947`), losing the confirmed image. Also fsync `store.imagesDir` after creating the user directory.

VERDICT: SHIP AFTER FIXES — The copy-marker redesign, retry, rewritten clean-up test and R8 verdict check out, but first-upload crash durability remains incomplete.
END-OF-REVIEW