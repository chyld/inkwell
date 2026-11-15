### 1. [high] Session expiry not enforced per request
Sec 5 only deletes expired rows at startup and sign-in, without requiring refusal of expired ids on each /api request or updating a last-used timestamp for the 30-day idle rule. Add per-request expiry checks and define last-used storage.

### 2. [high] Tokens leak through default request logging
Sec 11 bans sensitive data in logs but names no mechanism; Fastify by default logs request headers, so Authorization and Cookie leak via docker compose logs. Require explicit header and body redaction config and a test proving tokens never appear.

### 3. [high] Sign-out waits forever for offline save
Sec 6.3 says sign-out waits for pending save, but failed saves retry forever every 15s; user cannot sign out while offline. Change to timeout sign-out after one flush attempt, proceed regardless, and keep localStorage copy for next sign-in.

### 4. [high] Orphan image uploads never cleaned
Sec 6.5 deletes images only when a note is permanently deleted or 24h after a save unreferences them; uploads never saved into a body (or discarded via 'load theirs') have no deletion rule yet count toward quota forever. Add upload-age cleanup query.

### 5. [medium] Quota check races and body bytes undefined
Sec 6.6 requires rejecting over-quota writes atomically, but concurrent saves/uploads (and agents) can each pass the check before any commits; 'note body bytes' is also undefined. Check quota inside same SQLite transaction and define bytes as UTF-8 JSON length.

VERDICT: NOT READY Session expiry and offline sign-out deadlock must be fixed before building.
END-OF-REVIEW
