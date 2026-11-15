### 1. [low] First image per user yields no parent-dir fsync, so its directory can vanish after power loss

Where: src/server/images.ts:110

Steps: new user's first upload creates images/<userId>/ then renames and fsyncs only that new directory. After power loss its parent entry can be gone, leaving the row without a file. Fix: also fsync the images directory and update the order test.

VERDICT: SHIP AFTER FIXES – R2–R5 and R10 are really and completely fixed (R8 not-a-defect correct), apart from the trivial first-upload fsync gap above.

END-OF-REVIEW
