### 1. [medium] Failed autosaves can block recovery
Section 6.3 retries failed saves and waits for a pending save before navigation or sign-out. A quota rejection can therefore prevent reaching notes to delete (§6.6). Specify terminal handling for 400/401/413, preserve the draft, and allow navigation or sign-out after a failed save with an explicit unsaved-changes choice.

### 2. [medium] Browser drafts lack account isolation
Section 6.3 stores private content in localStorage under only the note id, without cleanup after session expiry or account changes. Another account using that browser can inspect leftover drafts. Require user-and-note keys, restoration only for the authenticated owner, and purging the previous account's drafts before signing out or entering a different account.

### 3. [medium] Image references can cross note boundaries
Sections 6.2 and 11 validate image URLs and user ownership, but do not require the image to belong to the note being saved. Reusing an image id in another note then breaks that note when the original is permanently deleted (§6.5). Require every saved image reference to resolve to an existing image owned by that same user and note.

### 4. [medium] Local HTTPS trust is not established
Section 12 calls Caddy's localhost certificate locally trusted, but its CA lives inside the container; browsers and MCP clients on the host will not automatically trust it. Require README instructions to export the persistent Caddy root certificate and configure trust for the browser and each tested client runtime before local acceptance tests, without disabling certificate verification.

VERDICT: NOT READY — Resolve these privacy, save-recovery, image-integrity and local-testing gaps before implementation.
END-OF-REVIEW
