### 1. [high] Sign-in rate limits can be bypassed through X-Forwarded-For
Section 5 assumes Caddy overwrites `X-Forwarded-For`, but Caddy's default `reverse_proxy` appends the client-supplied value. If Fastify trusts the first entry, attackers rotate it and defeat both sign-in limits. Specify in Sections 5 and 12 that the Caddyfile sets `header_up X-Forwarded-For {remote_host}`, state exactly which value Fastify uses, and test forged headers from outside.

### 2. [high] The pre-upgrade snapshot cannot be rolled back as described
Section 12 does not make rollback work: `VACUUM INTO` fails if `/data/pre-upgrade.db` already exists, leftover `-wal`/`-shm` files can be replayed against a restored database, and the snapshot excludes image files added or deleted afterwards. Specify a temporary file plus atomic rename, a stopped-containers restore procedure that removes `-wal`/`-shm`, and reconciliation of image files on startup.

### 3. [high] Image upload has no complete lifecycle, so orphans leak quota forever
Section 6.5 says an image belongs to one note but never says how upload binds to it, including a new note not yet saved server-side. Cleanup only happens when that note is next saved, so abandoned uploads permanently consume the Section 6.6 quota. Require a server-created note id before upload, and sweep all unreferenced images older than 24 hours at startup.

### 4. [medium] Optimistic locking covers only title/body saves, not other note mutations
Sections 6.1 and 6.3 increment `version` on folder and tag changes, yet only title/body saves send an expected version or define a 409. Concurrent tabs can silently overwrite moves, tags, trash, restore or delete. Require every note mutation to send the expected version and return 409 with the same resolution flow, or state last-writer-wins and stop incrementing `version` for those changes.

### 5. [medium] Unsaved drafts can trap sign-out and remain readable in the browser
Section 6.3 makes sign-out wait for a pending save while failed saves retry every 15 seconds indefinitely, and never says drafts are cleared on sign-out. With the server down the user cannot leave cleanly, and private text remains in `localStorage` for the next browser-profile user. Add a discard option after a short timeout, clear that user's drafts on sign-out, and expire drafts.

VERDICT: NOT READY — the rate-limit, rollback and image-lifecycle defects in Sections 5, 12 and 6.5 must be specified correctly before building.
END-OF-REVIEW
