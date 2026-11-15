# Code re-review, round 3 — b14 (kimi)

Focus: search, the CLI, deployment (Dockerfile/compose/Caddyfile, README), SPEC 7.3, 9, 12; verification of the round-2 fix commit `ad7410b`.

Verified fixed and complete, with genuine tests: R2 (marker + empty `BEGIN IMMEDIATE` closes the clean-up race because `tx()` is `.immediate()`; partial-dir + rename; all three named tests fail pre-fix — blocking-write fails on `SQLITE_BUSY` with `busy_timeout = 0`, mid-copy clean-up fails via the hook's delete), R3 (1 s re-look; test fails pre-fix), R4 (fsync order asserted by spy; fails pre-fix), R5 (`BEGIN IMMEDIATE` inside try → `MigrationError`; test fails pre-fix), R15 (`log default` filter block, deploy.test regex fails pre-fix), R16 (README §9 text matches `cleanupImages`: 24 h grace, run on permanent delete/Empty Trash/start/daily). The round-1 lock test was rewritten to run real clean-up mid-copy through the snapshot hook and still proves the lock's purpose: it fails both on round-1 code (delete under the copy fails, or the file is removed and the copy aborts) and without the marker. R8 "not a defect" is correct: disable→enable with the same password leaves hash and `disabled` unchanged, so the verified credentials would succeed fresh; sessions existing during disable are still all deleted (`setDisabled`, store.ts:234; `createSessionIfUnchanged` re-checks under the write lock). Search unchanged and conforming (FTS quoting incl. `"`/`*` cases tested; `unfiled` narrowed before `LIMIT 50`). Dockerfile/compose/Caddyfile/README match SPEC 12 and each other (`{$NOTES_HOST}`, bare-hostname validation, `localhost` local CA, healthz gating, non-root `/data`). No regressions found from the commit in this area.

### 1. [low] `user delete` during `data copy` fails the copy with misleading advice
Where: src/server/store.ts:248 (and store.ts:1033-1039)

`deleteUser` removes the user's image directory without the `copyInProgress()` check clean-up has. Deleting any user during a manual copy (window is the whole copy, seconds–minutes) makes the copy fail with "Restart the app once … and run the copy again" — nothing is broken; just re-running works. Fix: honour the marker in `deleteUser` or soften the message.

### 2. [low] R4 fsync chain still misses the ancestor directory for a user's first image
Where: src/server/images.ts:110-112

Only `path.dirname(dest)` is fsynced. For a user's first upload, `mkdirSync … {recursive:true}` creates `images/<uid>` without fsyncing `images/` itself, so a power cut right then can still drop the confirmed file (R4's exact failure). Needs a power loss inside the first-upload window; fix by fsyncing `images/` when the user dir is new.

VERDICT: SHIP — every round-2 fix in the search/CLI/deployment area is real, complete and test-backed, the rewritten lock test and the R8 verdict hold, and the two leftovers are narrow, fail-safe edge cases.
END-OF-REVIEW
