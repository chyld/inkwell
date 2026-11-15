### 1. [high] Concurrent sign-ins bypass the failure limits
Where: src/server/api.ts:44
The limit is checked before asynchronous Argon2 verification, and failures are recorded only afterwards. An attacker can submit many guesses concurrently from one IP before any completes; all pass the check and are verified, bypassing both limits and consuming substantial memory. Reserve capacity for in-flight attempts or serialize checks per IP and pair, releasing reservations on success.

### 2. [high] Password changes can leave a newly issued session alive
Where: src/server/store.ts:252
Sign-in reads the password hash and disabled flag before awaiting verification. If the CLI changes the password and deletes sessions during that await, verification of the old password still succeeds and creates a session after the deletion. Disabling and then enabling can similarly revive such a session. Atomically recheck the current hash and enabled state when inserting the session.

### 3. [high] Manual copies can silently omit referenced images
Where: src/server/store.ts:929
The database snapshot and file copies are unsynchronized with the running app. After the snapshot, cleanup or user deletion can remove an image file before it is copied; the loop silently skips it and reports success, leaving a copied database with a missing image. Coordinate snapshot and file retention with writers, and fail the copy if any snapshot image cannot be copied.

### 4. [medium] Concurrent migrations can overwrite the rollback snapshot
Where: src/server/db.ts:129
The app and CLI can both observe pending migrations. One can migrate after the other has checked the version but before it runs VACUUM INTO; the latter then replaces pre-upgrade.db with the already-upgraded database and finds no work under the lock. Rollback no longer has the old schema. Serialize the version check, snapshot and migration across processes.

### 5. [medium] Caddy logs more than the permitted request fields
Where: Caddyfile:23
The JSON access log deletes a few credential headers and the query string but retains the remaining request headers and other request metadata. For example, a client-supplied secret in a custom header is written to stdout, contrary to the method, path, status and duration-only logging requirement. Configure an allowlist of those fields and test the actual Caddy log output.

VERDICT: DO NOT SHIP until the authentication races and data-copy integrity are fixed.
END-OF-REVIEW
