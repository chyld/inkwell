# Code re-review, round 3 (dsv): images, data copy, clean-up, storage limit

Read-only review of `ad7410b` against the Round 2 table in `reviews-code/RESPONSE.md`,
limited to the images / `data copy` / clean-up / storage-limit paths (SPEC 6.5, 6.6, 9).

What verifies. **R1**: the image route sets the sandbox CSP before the 304, and
`app.ts:72` only fills in `PAGE_CSP` when the header is absent, so the test fails on the
untouched code. **R2**: the marker is written before the copy's empty `BEGIN IMMEDIATE`
(store.ts:998-1014), and clean-up reads it *inside* its own immediate transaction
(store.ts:899), so a clean-up that began before the marker must commit before the
snapshot; VACUUM runs on a read-only connection; the copy is built in
`<dir>.partial-<pid>` and renamed; a dead pid's partial is removed. All three named
tests fail on the round-1 code (the hook's write gets SQLITE_BUSY, the target exists
mid-copy, the stale partial survives). The rewritten round-1 lock test still proves what
matters: it runs a real permanent delete (and thus `cleanupImages`) mid-copy and asserts
both that the image survives in the copy and that the next clean-up removes it, so
deleting the marker check makes it fail with the "missing image" abort. **R3** (1 s
second look; the window it covers is only mkdir+rename after the row commit), **R4**
(fsync file, row, directory; the order assertion is genuine), **R5** (`BEGIN IMMEDIATE`
inside the try, `MigrationError`, the test holds a real second connection), **R8** (the
session transaction re-reads hash and disabled flag, so disable-then-re-enable really is
a fresh sign-in's worth of access) and **R16** (README storage text now matches
`IMAGE_GRACE_MS`) all hold. No regression found in the copy, clean-up, reconciliation or
upload paths.

### 1. [low] A copy's postponed clean-up never runs when the copy ends
Where: src/server/store.ts:1046

While a copy runs, `cleanupImages` deletes nothing (store.ts:899); when it ends the marker goes (1046) but no clean-up runs. Deferred images still count in `usage()`, so a user who deletes notes during a copy can keep getting 413s until the daily timer, a restart, or any permanent delete — though README.md:32 and DEVIATIONS.md:21 say removal waits only "until the copy is done". Fix: call `cleanupImages()` after removing the marker.

VERDICT: SHIP — every Round 2 item in the images / data-copy / clean-up / storage area is fixed completely with tests that genuinely fail without it, R8 is correctly "not a defect", and the rewritten lock test still proves the copy's image invariant; only the missing post-copy clean-up is left.
END-OF-REVIEW
