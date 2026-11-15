### 1. [high] Pre-upgrade snapshot and rollback break on reuse and WAL mode

In Section 12, `VACUUM INTO` `/data/pre-upgrade.db` fails when the file already exists. Also, a failed migration exits `app` (breaking `docker compose exec`), and copying `pre-upgrade.db` without deleting WAL sidecars risks corruption. Change Section 12 to `VACUUM INTO` a temp file then rename, and document restoring via `docker compose run` while removing `-wal`/`-shm` files.

### 2. [high] Autosave version conflicts with folder/tag edits and Trash

Section 6.1 increments `version` on folder/tag edits, while Section 6.3 autosaves only `title` and `body`, triggering false 409s when organizing a note while typing. Section 6.3's `UPDATE` also omits `trashed_at IS NULL`, allowing edits to trashed notes (violating Section 6.4). Scope `version` to `title`/`body` (or sync folder/tag responses) and reject saves to trashed notes.

### 3. [medium] Unreferenced images leak quota and cross-note copies break

Section 6.5 deletes >24h unreferenced images only when their owning note saves, leaking quota if never resaved. Sections 6.2 and 11 also allow saving another note's image ID, breaking when that note is deleted. Change Section 6.5 to sweep all >24h unreferenced user images on any save, and reject cross-note image IDs in Section 6.2.

### 4. [medium] Build requires live tests of four external AI clients against localhost

Section 8.4 requires checking Claude Code, Codex, Grok, and Muse end-to-end against `localhost` during the build. Cloud clients cannot reach `localhost`, local tools will not trust Caddy's container-internal CA (Section 12), and builds cannot depend on four external accounts. Restrict Section 8.4 build checks to the MCP SDK client and verify external clients post-deploy.

### 5. [low] Unscoped localStorage keys and case-sensitive rate-limit keys

Section 6.3 keys `localStorage` drafts only by note id, leaking drafts across users on shared browsers if IDs are sequential integers. Section 5 keys sign-in limits on `(username, client IP)` without lower-casing `username`, letting case variants bypass the 5-attempt cap. Key `localStorage` by `(user_id, note_id)` (Section 6.3) and lower-case `username` when rate-limiting (Section 5).

VERDICT: NOT READY — Fix the pre-upgrade snapshot/rollback procedure and the autosave version and Trash concurrency rules before building.
END-OF-REVIEW
