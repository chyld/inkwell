# Code re-review b02 (sonnet): sign-in, sessions, in-flight reservation, Origin, proxy, headers, logging

Scope read: `git show HEAD` for api.ts, ratelimit.ts, store.ts, db.ts, images.ts, Caddyfile and the web sign-out files; app.ts, config.ts, docker-compose.yml, SPEC 5, 9 and 11; and test/signin-limit.test.ts and test/sessions.test.ts.

Row 1 (in-flight attempts): fixed completely. `begin()` reserves the pair and address keys synchronously, before the first await. `finish()` runs in a `finally`, so a throw cannot leak a reservation. A 429 is returned before any Argon2 work. The named test fires 30 parallel guesses. Before the fix all 30 passed the check and gave 401, so the test does fail without the fix.

Row 2 (password-change race): fixed completely. `createSessionIfUnchanged` runs in `BEGIN IMMEDIATE`. It re-reads the row and compares `password_hash` and `disabled`, and treats a deleted user as "changed". The CLI's `UPDATE` plus session `DELETE` is one transaction, so either order is safe. Both named tests delay argon2 by 300 ms and commit the change mid-verify. Without the fix the session is created, so both tests fail without it.

Row 3 (IPv6 /64): "not a defect" is correct for the shipped Compose file, which has no `enable_ipv6` and no AAAA record. The Origin check, `trustProxy`, session cookie, security headers and the Caddy log filter all match SPEC 5 and 11.

### 1. [low] `data copy` falls back to copying under the write lock, so a slow copy stalls sign-in and saves
Where: src/server/store.ts:991-993

The lock is held while image files are linked. If `linkSync` fails (target on another file system, for example `/tmp` in the container), `copyFileSync` runs for every image while still holding `BEGIN IMMEDIATE`. better-sqlite3 waits on a busy lock synchronously, so the app's event loop blocks for up to 5 s per write. The write then fails with 500, and a sign-in whose `createSessionIfUnchanged` fails is counted as a failed attempt. The README path under `/data` links instantly, so this is rare. Fix: when `linkSync` fails, fail with "choose a directory on the data volume" instead of copying under the lock.

VERDICT: SHIP — all three RESPONSE rows in my focus area are fixed or correctly dismissed, with tests that fail without the fixes, and I found only one low-severity regression, outside the sign-in path.
END-OF-REVIEW
