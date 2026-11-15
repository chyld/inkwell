### 1. [medium] Agent-client setup is shipped unverified

Where: README.md:205

SPEC 8.4 requires each of the four clients to be checked by hand before hand-over. The README says none was tried (lines 205-211), and `notes agent add` prints the same untested commands. If a flag is wrong (Grok and Muse most likely), `mcp add` fails or registers a server that never connects, and §9 has no agent troubleshooting. Fix: test each and publish what actually works.

### 2. [medium] A backup can succeed while its database references missing images

Where: src/server/store.ts:937

`dataCopy` snapshots the database, then copies each image file it finds, silently skipping files already deleted. If a permanent delete or Empty Trash (both call `cleanupImages`) runs during the backup, the copied `notes.db` keeps rows for images absent from the copy's `images/`, and the command still reports success; restoring that copy loses those images. Fix: verify every row's file exists and fail loudly.

### 3. [low] Concurrent startups can overwrite the rollback snapshot

Where: src/server/db.ts:133

The snapshot is published to `/data/pre-upgrade.db` before `BEGIN IMMEDIATE` and the version re-check. Two processes that both see pending migrations (crashing app plus `docker compose run … notes`) can have the slower `VACUUM` finish after the faster commit; it then publishes a migrated database over the good snapshot. README §6 rollback would restore the new schema under old code. Fix: publish only if `user_version` is still the captured value.

### 4. [low] The "keep mine" test compares the body with itself

Where: test/conflict.test.ts:39

`expect(now.body).toEqual((await c.get(...)).json().body)` re-reads the note and compares it with itself, so it always passes. A `keepMine()` bug that sent a stale or wrong body would still satisfy this test; only version 3 and the title are checked. Fix: assert `now.body` equals `doc(p('mine'))`.

VERDICT: SHIP AFTER FIXES — The Dockerfile, Compose, Caddyfile and README deployment path are sound, but the unverified agent setup and the backup/rollback gaps should be closed before the owner depends on them.

END-OF-REVIEW
