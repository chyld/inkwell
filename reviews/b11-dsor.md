### 1. [high] No automated backups risk total data loss
Section 2 says "Backups: None" and Section 12 only offers a manual copy command. For a note-taking app, a lost Docker volume means all notes are gone. Add a daily automated backup of the SQLite file to a separate volume or off-site storage, and document restore in Section 12.

### 2. [high] DuckDNS "once" update will break the site
Section 12 assumes a static IP and says the DuckDNS name is pointed "once". DuckDNS requires updating the IP at least every 30 days or the hostname is deleted; an IP change also breaks HTTPS. Replace "once" with a daily DuckDNS updater (cron or container) or document the 30-day requirement.

### 3. [medium] Agent tokens never expire
Section 8.1 states tokens do not expire but can be revoked. A leaked token grants create-note access forever. Add a default expiration (e.g., 90 days) or require periodic rotation in Section 8.1.

### 4. [medium] CLI and app share SQLite without busy handling
Section 9 has the CLI write directly to the SQLite file while the app runs. Concurrent writes can return "database is locked". Specify a busy timeout (e.g., 5 seconds) and retry logic for the CLI's SQLite access in Section 9.

### 5. [medium] Trash with 30-day cleanup is over-engineered
Section 6.4 adds a Trash view, restore logic, and a daily cleanup job for fewer than 10 users. Replace it with immediate delete plus a confirmation dialog or a simple undo toast, and remove the daily job.

### 6. [medium] Session fixation: no session ID regeneration on sign-in
Section 5 does not say the session ID is regenerated on sign-in. An attacker who sets a session cookie before sign-in could hijack the session. Add to Section 5: "A new session id is generated on sign-in; the old session id is invalidated."

VERDICT: The spec is well-structured but has critical gaps in backups and deployment, plus several security and over-engineering issues that should be fixed before building.

END-OF-REVIEW
