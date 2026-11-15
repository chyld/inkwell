### 1. [high] Sessions are never actually expired

§5 says expired rows are deleted only at startup and sign-in, and never says the per-request check rejects a session idle 30 days or older than 90 days, so a stolen or forgotten cookie keeps working until a restart. Add to §5: every authenticated `/api` request rejects and deletes rows past either limit, and refreshes `last_used` at most hourly.

### 2. [high] Version bumps turn folder and tag edits into fake conflicts

§6.1 increments `version` on folder and tag changes, but §7/§10 make those outside the editor, so moving or tagging a note turns the next autosave into a 409 where "load theirs" discards unsaved text; Trash state, which §6.4 makes uneditable, does not bump it at all. Specify: `version` tracks title, body and Trash only.

### 3. [medium] A new note has no id for images or local storage

§10 never says when a note row is created; §6.5 uploads and §6.3's `localStorage` key both need a note id, so image paste into a new note is undefined. State in §10 that "New note" creates the row immediately (empty, version 1), that §6.5 uploads need one, and when unreferenced images are reclaimed.

### 4. [medium] The HTTP API is unspecified

§4 names `/api` and §11 mentions request ids, but no endpoint, payload or response shape is given anywhere, so the SPA contract, the 409 flow and §13's tests are left to invention. Add a table to §4 listing method, path, request and response for auth, notes, folders, tags, search and images.

### 5. [medium] Four MCP client integrations are more than this app needs

§8.4 requires building and end-to-end checking four third-party clients, Grok and Muse included, and §9 prints four configs; each client is a separate, brittle failure mode for an app with under 10 users. Reduce §8.4 to Claude Code verified end to end, with the others' configs marked untested, and have §9 print only that one.

VERDICT: NOT READY — session expiry, version/conflict semantics, note creation and the API surface must be pinned down before building.

END-OF-REVIEW
