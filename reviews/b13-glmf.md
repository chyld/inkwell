### 1. [high] Hand-copied backup can be corrupt
With WAL mode (§4), copying the SQLite file while the app runs can capture an inconsistent database missing WAL content. §12 README item 1 tells the owner to copy the file by hand. Change §12 to specify `sqlite3 notes.db ".backup '/path/backup.db'"` or `VACUUM INTO`, or stopping the `app` container first.

### 2. [high] CLI writes can collide with the running app
§9 has the CLI write to the SQLite file directly while the `app` container serves traffic; WAL allows only one writer, so concurrent writes fail with SQLITE_BUSY. Change §9 to require a busy timeout with retry in the CLI and the app, and note that `user add` etc. may briefly wait behind writes.

### 3. [medium] Username rate limit enables lockout denial of service
§5 allows 5 failed attempts per username per 15 minutes, so anyone can permanently lock a victim out by typing wrong passwords. Change §5 to scope the lockout to the IP+username pair, or raise the per-username threshold and rely mainly on the per-IP limit.

### 4. [medium] Two schema paths can drift
§6.3 validates Tiptap JSON against an allowed schema and §8.3 converts Markdown into "the same schema", but nothing requires one shared definition. Divergence makes agent notes unopenable or unsearchable. Change §8.3 to state both paths use one shared schema module, reindexed into FTS (§7.3) identically.

### 5. [medium] Let's Encrypt issuance on duckdns.org may be rate-limited
§12 assumes HTTP-01 via Caddy works, but duckdns.org is one registered domain shared by all users, subject to Let's Encrypt's 50-certificates-per-week limit, so issuance can fail unpredictably. Change §12 to add a fallback: DuckDNS DNS-01 with a token, or document retry timing in README item 7.

### 6. [low] Conflict UI is over-engineered for under 10 users
§6.3's optimistic locking with a "keep mine or load theirs" choice is significant UI work for a single-user-per-note app where two simultaneous editors are rare. Change §6.3 to last-write-wins with a non-blocking "changed elsewhere" banner, matching the app's modest scale.

VERDICT: A well-scoped, security-conscious spec whose main risks are operational SQLite handling and certificate issuance, both fixable with small wording changes.
END-OF-REVIEW
