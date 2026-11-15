### 1. [high] No backups, and the manual copy is unsafe
Sections 2 and 12.1 accept "Backups: None"; the only recovery is copying the live SQLite file by hand, which under WAL yields a stale or torn copy. Notes are the product. Change 12.1 to require a daily `sqlite3 notes.db "VACUUM INTO ..."` snapshot retained seven days on a separate volume, and document restore.

### 2. [high] Agent input limits and quota invite disk exhaustion
Section 8.3 accepts 100 KB Markdown, but conversion to Tiptap JSON can exceed the 1 MB body cap in 6.1; its quota counts notes, not bytes, so one agent can write up to 1.4 GB/day. Change 8.3 to validate the converted body against 6.1, reject oversize with a tool error, and cap bytes per agent per day.

### 3. [medium] Proxy hides client IPs and breaks the Origin check
Section 5 rate-limits by IP, but behind Caddy every request appears to come from Caddy unless the app trusts `X-Forwarded-For`; then 20 failures lock out every user. The Origin check also needs a fixed value. Change 5 and 12 to require trusted-proxy configuration, derive the client IP from `X-Forwarded-For`, and compare Origin with `https://${NOTES_HOST}`.

### 4. [medium] Autosave versioning is undefined
Section 6.3 requires each save to send "the note's last known version number", but 6.1 defines no version field and no response supplies one. "Keep mine" has no force-overwrite request, so conflicts either loop or lose work. Change 6.1 to add an integer `version` incremented on save, and 6.3 to define a forced save returning the new version.

### 5. [medium] Session ids are stored in clear and never expire absolutely
Section 5 stores raw random session ids in SQLite and renews them indefinitely on use. Any database copy, including the manual backup in 12.1, grants 30-day account access; a stolen cookie can be kept alive forever. Change 5 to store only SHA-256 of a 32-byte id, add an absolute 90-day expiry, and rotate the id at sign-in.

### 6. [low] Trash auto-purge is over-engineering with no backups
Section 6.4 adds a Trash view, restore rules, and a daily job that permanently deletes notes after 30 days, for fewer than 10 users and no backups. That is extra code and an irreversible deletion path for little value. Change 6.4 to keep Trash until the user empties it and drop the scheduled purge.

VERDICT: The design is small and coherent, but it is not ready to build until backups, input limits, versioning, and reverse-proxy handling are made explicit.

END-OF-REVIEW
