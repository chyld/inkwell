### 1. [medium] Clean-up deletes images that an unsaved draft still needs
Where: src/server/store.ts:889-893
Steps: insert an image online, lose connectivity before the save lands, close the tab, and reopen the note more than 24 hours after the upload. Clean-up has already deleted the unlinked image row and file, as the server cannot see drafts. Restore's save gets 400 'refers to an image that does not exist', the saver blocks (saver.ts:181), and the image is gone. Fix: keep unlinked images longer (a SPEC 6.5 decision) and name the missing image in the message.

### 2. [low] First upload's directory is not fsynced (needs a power cut)
Where: src/server/images.ts:110-112
Steps: a user's first upload creates images/<userId>, but only that directory is fsynced (images.ts:112). A power cut after the 201 keeps the row (synchronous = FULL), but loses the new directory's entry in images/, so the next start deletes the row as having no file. The R4 test (test/images.test.ts:333) asserts exactly one directory fsync on a first upload, so it pins the gap. Fix: fsync images/ after creating the user directory.

VERDICT: SHIP AFTER FIXES, because the round-2 data-layer rows (R2, R5, R10 and the R8 verdict) are genuinely fixed and their tests fail without the fix, but the 24-hour image clean-up can delete an image that an unsaved draft still needs.
END-OF-REVIEW
