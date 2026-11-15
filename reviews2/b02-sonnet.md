### 1. [high] Tag and folder changes cause self-inflicted 409s
Section 6.1 bumps `version` on tag and folder changes, but 6.3 autosave sends the version last received. Adding a tag or moving a note while the editor is open, or while a save is in flight, makes the next autosave return 409 against the user's own change. Change 6.1: bump `version` only on title or body changes.

### 2. [medium] Trusted-proxy range is undefined
Section 5 says Fastify trusts `X-Forwarded-For` only from "the Compose network", but Compose assigns that subnet dynamically. If the guess is wrong, every sign-in appears to come from Caddy's IP, so 20 failures lock out everyone, or the header can be spoofed. In section 12, pin a subnet in `docker-compose.yml`, set `trustProxy` to it, and test it in criterion 9.

### 3. [medium] Local test path and agent clients are not verifiable as written
With `NOTES_HOST=localhost` (sections 8.4, 12), Caddy's local CA is not trusted by the host browser or by agent clients, and hosted clients (possibly Grok, Muse) cannot reach localhost at all. Add README steps for trusting Caddy's root certificate. Change 8.4 so only locally reachable clients are verified during the build and the rest are checked by the owner after deploy.

### 4. [medium] Image cleanup is over-built and breaks pasted images
Section 6.5 ties each image to one note and sweeps unreferenced images on every save after 24 hours. Pasting an image into a second note breaks once the first note is edited or deleted. For under 10 users, drop the sweep and per-note ownership: images belong to the user, are removed only by `user delete`, and count toward quota.

### 5. [low] Session limits are never enforced per request
Section 5 removes expired rows only at app start and sign-in, and never says requests check expiry. On a long-running app a session can outlive 30 idle days or 90 total days. Add: every `/api` request rejects a session past either limit, and last-used is updated at most once per hour.

VERDICT: NOT READY - finding 1 breaks everyday editing and finding 2 can lock every user out of sign-in.
END-OF-REVIEW
