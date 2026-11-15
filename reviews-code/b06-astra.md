### 1. [high] Small Markdown tables can exhaust server memory
Where: src/server/markdown.ts:117

An agent can submit a GFM table with 2,000 header columns and 10,000 short `|x|` rows within 100,000 bytes. The converter pads every row to 2,000 cells, allocating over 20 million cells synchronously before body-size validation or the rate check. This can exhaust memory and stop the shared server, even for an already-rate-limited agent. Enforce a generated-node/byte budget before allocating cells.

### 2. [high] An overlapping login survives password revocation
Where: src/server/store.ts:258

Start signing in with the old password, then let CLI password replacement commit while asynchronous verification is pending. Verification uses the previously fetched hash; afterward `/api/session` inserts a fresh session, beyond the reset's session deletion. The old password therefore yields a usable session after replacement. Recheck the current password hash and enabled state and insert the session together in one immediate transaction after verification.

### 3. [high] Live data copies silently lose referenced images
Where: src/server/store.ts:937

After `VACUUM INTO` captures a note referencing an image older than 24 hours, permanently delete that note while copying continues. Cleanup can remove its image before the CLI copies it. The missing file is silently skipped, yet the command reports success with a database still referencing it. Coordinate snapshot/image copying with uploads and deletions; fail on missing files. The CLI copy test creates no images.

### 4. [medium] One editor's save deletes another editor's unsaved draft
Where: src/web/saver.ts:115

Open the same note in two tabs. While A's save response is pending, edit B, which writes its draft to the shared user/note key. A's success unconditionally removes that key. B's ensuing 409 does not recreate its draft; reloading loses B's changes despite the draft guarantee. Preserve drafts per editing instance and clear only the revision acknowledged by that save.

### 5. [medium] Parallel sign-ins bypass both failure limits
Where: src/server/api.ts:44

Send many simultaneous wrong-password requests from one IP before any verification finishes. Each passes `isBlocked`, then awaits Argon2; failures are recorded only afterward, so all guesses are verified despite the five/twenty limits. This also queues expensive password work without a bound. Reserve capacity for pending attempts before awaiting verification, release successful reservations, and count failures. Existing rate-limit tests send attempts sequentially and miss this race.

VERDICT: SHIP AFTER FIXES — Address the denial-of-service, authentication and data-loss paths before deployment.
END-OF-REVIEW
