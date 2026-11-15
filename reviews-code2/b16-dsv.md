### 1. [medium] Caddy's error logs still bypass the new log filter
Where: Caddyfile:25

`log` configures only the site's access log. Caddy's runtime logs, including `http.log.error` entries when the proxy fails (a 502 while `app` restarts), go to the default logger unfiltered with the request object attached: `request.uri` keeps its query string and the other fields are not deleted. `docker compose logs caddy` then breaks SPEC 11 and README:341. Fix: add the same `format filter` under a global `log` block.

### 2. [medium] Trash hides, and Empty Trash destroys, a stored draft
Where: src/web/components/NoteEditor.tsx:310

With the draft banner open the trash button stays enabled (`locked` at line 155 is not applied). `trash()` flushes only the in-memory saver, so a stored draft does not stop it: the note moves to Trash, the banner vanishes (line 134 skips trashed notes), and Empty Trash (App.tsx:249) deletes the note and those changes without a mention or draft removal. Fix: treat a stored draft as unconfirmed, and warn in Empty Trash.

### 3. [low] Empty Trash does not free storage as the README promises
Where: README.md:476

`cleanupImages` (store.ts:887) deletes only images older than 24 hours (`IMAGE_GRACE_MS`); `emptyTrash` merely calls it. After Empty Trash an image uploaded today still counts in `usage()`, so a user at the limit keeps getting 413s although this line says the space is freed. Fix: say images go within 24 hours, or run a cleanup without the grace after an explicit permanent delete.

VERDICT: SHIP AFTER FIXES — search (including the server-side unfiled narrowing), the CLI and the Compose/README deployment path check out and the named tests are genuine, but Caddy error logs still expose request URIs and a stored draft can be destroyed by Empty Trash.
END-OF-REVIEW
