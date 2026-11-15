# Code re-review b14 (kimi)

Scope: search (incl. the new Unfiled narrowing), the CLI, deployment files and README accuracy (SPEC 7.3, 9, 12), plus regression checks of the fix commit.

RESPONSE.md rows in scope, verified against the code: #3 (IPv6 /64) correct "not a defect" — the Compose network has no `enable_ipv6` and no AAAA record is claimed. #5 and #14 verdicts correct per SPEC 6.2/6.5 and real foreign keys. #4 (`synchronous = FULL`, db.ts:117), #6 (snapshot re-check, VACUUM and migration all under one `BEGIN IMMEDIATE`, db.ts:137-174; test uses a real second process holding the lock), #10 (`dataCopy` holds the write lock, hard-links, fails atomically on a missing file, store.ts:957-1005; both named tests fail pre-fix), #11 (Caddyfile log filter keeps only method/uri/status/duration and strips the query string, Caddyfile:25-42), #20 (`unfiled` narrowed server-side before `LIMIT 50`, store.ts:805, api.ts:155, App.tsx:96; the test's 55 filed + 1 unfiled note makes it fail pre-fix), #22 (README §4 now says to pick another name and the CLI error explains why). #24 (clients unverified) out of scope as instructed. No regressions found in the touched web/markdown/schema/ratelimit code.

### 1. [low] `data copy` holds the database write lock through slow byte copies, stalling the running app
Where: src/server/store.ts:964-996
`BEGIN IMMEDIATE` is held for the whole copy: VACUUM INTO plus the image loop that falls back to `copyFileSync` when hard links fail (any target outside /data). A copy taking over the 5 s busy timeout makes concurrent saves, uploads and MCP calls throw SQLITE_BUSY → 500/tool errors, violating SPEC 9 "safe to use while the app is running". Fix: byte-copy outside the lock, re-verifying each file exists (fail if gone).

### 2. [low] An interrupted `data copy` leaves a partial directory that blocks the next run
Where: src/server/store.ts:960-1003
Cleanup of the target directory only runs in the `catch` of synchronous errors. If the CLI is interrupted (Ctrl+C, kill, SSH drop) mid-copy, the partial target remains, and re-running the same `notes data copy <dir>` fails with "already exists. Choose a new directory." Fix: remove a partial target on signal, or mark/copy into a temp sibling and rename on success.

VERDICT: SHIP — every "fixed" and "not a defect" claim in the search, CLI and deployment areas checks out with genuine regression tests, and only the two minor `data copy` operational warts above remain.
END-OF-REVIEW
