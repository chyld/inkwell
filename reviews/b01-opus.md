# Review of SPEC.md (draft 1)

### 1. [high] Per-IP sign-in limit will see only Caddy's IP
Behind Caddy (§4), the app sees every request coming from Caddy's container IP. So the 20-per-IP limit in §5 becomes one global limit, and a single attacker can lock everyone out. Add to §5: "Fastify `trustProxy` is set to trust only the Caddy container, and the client IP comes from `X-Forwarded-For`."

### 2. [high] The manual backup command can produce a corrupt copy
In WAL mode, a plain `cp` of the database file (§12, README item 1) misses the `-wal` file and can be inconsistent. Migrations run automatically and there are no backups. Specify `sqlite3 notes.db ".backup /data/backup.db"` (or `VACUUM INTO`) in the README. Also require the app to save a `VACUUM INTO` snapshot before each migration.

### 3. [medium] Bearer-token MCP will not work with every client
§8.2 accepts only a static `Authorization: Bearer` token. Many remote-MCP clients (claude.ai connectors, some desktop apps) expect OAuth or cannot set headers. Have §8.2 and README item 5 name the supported clients (for example Claude Code, or `mcp-remote` for Desktop). Also add: "GET and DELETE on `/mcp` return 405."

### 4. [medium] Saving when the page is hidden breaks for large notes
§6.3 saves when the page is hidden. Requests sent during unload need `fetch` `keepalive` or `sendBeacon`, both capped near 64 KB, so 1 MB bodies silently fail. Change §6.3: save on `visibilitychange` with `keepalive` only when the payload is under 60 KB. Otherwise show a `beforeunload` warning while the note is unsaved.

### 5. [medium] Tags, folders and Trash do not fit together
Under §7.2 a tag disappears when only trashed notes use it, so restoring (§6.4) loses tags. §7.1 doesn't say whether trashed notes block folder delete. Renaming onto an existing tag is undefined. Specify: trashed notes keep their tag links, trashed notes do not block folder delete, and rename onto an existing tag merges the two.

### 6. [low] Too much machinery for fewer than 10 users
The daily Trash purge job, drag and drop, nested folders 5 deep, and a separate Inbox alongside Unfiled all add code and tests that few users will need. Cut these from §6.4, §7.1 and §10: keep Trash with manual "Empty Trash", move notes by menu only, allow depth 2, and send agent notes to Unfiled with a badge.

VERDICT: A clear, well-scoped spec that is close to buildable, but the proxy-IP rate limiting and the unsafe backup instructions must be fixed before anyone builds or deploys it.
END-OF-REVIEW
