### 1. [high] Manual backup of a live WAL database is unsafe
§12 README says the owner backs up by copying the database file by hand, but copying a WAL-mode SQLite database (§4) while the app runs can yield a corrupt copy, and with no export (§3) and permanent purges (§6.4), a disk failure loses every note. Change: specify `sqlite3 .backup`/`VACUUM INTO`, document restore, add a restore test to §13.

### 2. [medium] Per-IP rate limiting breaks behind Caddy
§5 rate-limits failed sign-ins per IP, but behind Caddy (§4) the app only sees Caddy's container IP unless proxy headers are trusted — one shared 20-per-15-minute bucket lets a few failures lock all users out, while blindly trusting client-supplied `X-Forwarded-For` is spoofable. Change: §12 must specify deriving client IP from exactly one trusted proxy hop (Caddy).

### 3. [medium] No restart policy: a reboot takes the site down
§12's Compose file specifies no restart behaviour: after a VPS reboot, OOM kill, or crash, `app` and `caddy` stay down until the owner notices — and nothing monitors a private <10-user instance. Change: require `restart: unless-stopped` for both services in §12 and state it in README item 6.

### 4. [medium] No self-service password change
Users cannot change passwords in the web app (§5, open question 4) and email reset is out of scope (§3), so every forgotten password means the owner SSHes in and new passwords travel through the owner out-of-band. Change: resolve open question 4 by adding change-own-password (current password required) to §5/§10; keep CLI `user passwd` as break-glass.

### 5. [low] The static-IP assumption is load-bearing
§12 assumes a static IP (open question 8). If it is dynamic, DuckDNS goes stale and Let's Encrypt issuance/renewal fails — yet §12 says no DuckDNS token is needed and §11 says no secrets are required. Change: resolve open question 8; if dynamic, add an updater container and its token to §12/§11, and failed-renewal recovery to README item 7.

### 6. [low] Search features outscale the app
§7.3 demands relevance ranking with title weighting, highlighted snippets, prefix matching on the last word, and as-you-type results — extra machinery to build and test for a personal app with a few thousand notes at most. Change: order results by FTS5's default ranking or updated time, and make snippets and as-you-type optional.

VERDICT: A careful, right-sized spec with a sound security design; approve once the backup/restore path is made safe and tested (finding 1) and the deployment gaps (findings 2 and 3) are specified.
END-OF-REVIEW