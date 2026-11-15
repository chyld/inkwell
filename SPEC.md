# Notes app: specification

Status: draft 3. Nothing is built yet. Earlier drafts are in `drafts/`; their
reviews are in `reviews/` (draft 1, 14 reviews) and `reviews2/` (draft 2, 15
reviews).

## 1. Summary

A private, self-hosted, web-based note-taking app for fewer than 10 people.
Each person has their own notes; nobody can see anyone else's. Notes are
written in a rich-text editor (Tiptap) and organised with multi-level folders
and tags, with full-text search. An AI agent can add notes to one user's
account through an MCP server, and can do nothing else. The owner deploys it
to a Debian VPS with Docker Compose by following the README.

## 2. Owner decisions (final; reviewers should not reopen these)

| Topic | Decision |
|---|---|
| Editor | Tiptap, including tables and images |
| Scale | Fewer than 10 users |
| Sharing, co-editing | None. A note belongs to exactly one user |
| User and agent management | Command-line tool on the server only |
| Password changes | Command-line tool only; not in the web app |
| Agent access | MCP server in the same deployment; create notes only; title, content and tags |
| Agent clients | Claude Code, Codex, Grok, Muse, each using a static bearer token |
| Organisation | Multi-level folders, tags, full-text search |
| Deleting a note | Goes to Trash; Trash is emptied by hand; no scheduled clean-up |
| Deleting a folder | Only when empty |
| Sessions | End after 30 idle days, and after 90 days regardless |
| Limits | 60 notes per hour per agent; 1 GB of storage per user |
| Stack | TypeScript, React, Tiptap, Fastify, SQLite, Caddy (section 4) |
| Hosting | Debian VPS at a fixed IP address, Docker Compose |
| HTTPS | `chyld-notes.duckdns.org`, already pointed at the VPS |
| Backups | None, automatic or scheduled |
| Deployment | Done by the owner from the README |

Two points added by the author that the owner has not yet confirmed:

- A single database snapshot is taken just before an update changes the
  database (section 12), so a failed update can be rolled back.
- A folder whose only notes are in Trash counts as empty (section 7.1).

## 3. Out of scope

Sharing, live co-editing, public sign-up, password reset by email, password
change in the web app, export/import, version history, mobile or desktop apps,
offline use, backups, an admin web page, drag and drop of notes between
folders, renaming tags, OAuth for MCP (so claude.ai web connectors are not
supported), file attachments other than images.

## 4. Stack and layout

- Front end: React, Vite, TypeScript, Tiptap.
- Back end: Node.js, TypeScript, Fastify. One process serves the built front
  end, the JSON API under `/api`, and the MCP endpoint at `/mcp`.
- Database: one SQLite file, WAL mode, `busy_timeout` 5 seconds, foreign keys
  on. Full-text search with SQLite FTS5. Every write that checks a limit and
  then changes data runs in one `BEGIN IMMEDIATE` transaction.
- Ids of users, notes, folders, images and agents are random UUIDs.
- Images: files on the same Docker volume as the database, not inside SQLite.
- MCP: the official MCP TypeScript SDK, Streamable HTTP transport, stateless.
- HTTPS: Caddy as reverse proxy with automatic Let's Encrypt certificates.
- Containers: `app` and `caddy`. Only Caddy publishes ports (80 and 443).
- One codebase and one image. The web server, the CLI (section 9) and the MCP
  endpoint all use the same data-access module and the same note-schema
  module (section 6.2); none of them re-implements the other's logic.

### 4.1 API outline

All under `/api`, JSON, session cookie required except sign-in. Errors are
`{ "error": { "code", "message" } }`.

| Area | Routes |
|---|---|
| Session | `POST /session` (sign in), `DELETE /session` (sign out), `GET /me` (username, storage used and limit) |
| Notes | `GET /notes?view=&folder=&tag=&cursor=` (list, 50 per page), `POST /notes` (create empty note, returns id and version 1), `GET /notes/:id`, `PUT /notes/:id` (title, body, version), `PATCH /notes/:id` (folder, tags), `POST /notes/:id/trash`, `POST /notes/:id/restore`, `DELETE /notes/:id` (permanent, Trash only), `DELETE /trash` (empty Trash) |
| Folders | `GET /folders` (tree), `POST /folders`, `PATCH /folders/:id` (rename, move), `DELETE /folders/:id` |
| Tags | `GET /tags` (names with counts) |
| Search | `POST /search` (query, optional folder or tag) |
| Images | `POST /images` (multipart, one file), `GET /images/:id` |

## 5. Users and sign-in

- Accounts are created only by the CLI. There is no sign-up page.
- Username: 3-32 characters, `a-z 0-9 - _`, unique. Input is lower-cased
  before every use, including rate-limit keys.
- Password: minimum 12 characters, hashed with Argon2id (version 1.3, 64 MiB
  memory, 3 iterations, parallelism 1, 16-byte random salt, 32-byte output),
  stored in the standard encoded form.
- Sign-in creates a new session with a fresh random 32-byte id (any earlier
  session id in the request is ignored). The database stores only the
  SHA-256 hash of the id, with `created_at` and `last_used`. The cookie is
  `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, `Max-Age` 90 days.
- Every authenticated request checks the session: if `last_used` is more than
  30 days ago or `created_at` more than 90 days ago, the row is deleted and
  the request gets 401. Otherwise `last_used` is refreshed, at most once an
  hour. Expired rows are also removed when the app starts.
- Sign-out deletes the session. Disabling or deleting a user, or changing
  their password, deletes all of that user's sessions.
- Rate limiting of failed sign-ins, counted in memory:
  - 5 per (username, client IP) pair per 15 minutes;
  - 20 per client IP per 15 minutes.
  There is no limit keyed on username alone, so nobody can lock another
  person out. Failures return one generic message.
- Client IP: the Compose network has a fixed subnet (section 12). The
  Caddyfile sets `header_up X-Forwarded-For {remote_host}`, so the header
  holds exactly the address Caddy saw. Fastify's `trustProxy` is set to that
  subnet only.
- CSRF: every state-changing `/api` request must carry an `Origin` header
  equal to `https://<NOTES_HOST>` (a configured value, never derived from the
  request's `Host`); otherwise it is rejected.

## 6. Notes

### 6.1 A note has

- A title (plain text, up to 200 characters; empty shows as "Untitled").
- A body: the Tiptap document, stored as JSON. Maximum 1 MB.
- Plain text extracted from the body on every save, used only for search.
- A `version` integer: 1 when created, plus 1 on every successful change to
  the title or body. Folder, tag and Trash changes neither check nor change
  it; for those, the last request wins.
- At most one folder (none means "unfiled").
- Zero or more tags.
- Created, updated and (if in Trash) trashed timestamps, UTC.
- An origin: the user, or the name of the agent that created it.

### 6.2 Editor and the note schema

One shared schema module defines what a note body may contain. It is used by
the editor, by server-side validation of every save, and by the agent
Markdown converter (section 8.3). It allows:

- paragraphs, headings 1-3, bold, italic, strikethrough, inline code, code
  blocks, block quotes, bullet lists, numbered lists, task lists, horizontal
  rule, hard break;
- links with `http`, `https` or `mailto` only;
- tables with an optional header row; add and remove rows and columns; no
  merged cells;
- images, only with a `src` of the form `/api/images/<id>` (section 6.5). No
  external image URLs, no `data:` URLs.

Validation runs on the server without a browser (ProseMirror's model, via
`@tiptap/pm/model`, plus explicit checks of link schemes and image sources).
Every image a body references must be an existing image owned by the same
user. A body that fails validation is rejected with HTTP 400.

### 6.3 Creating and saving

- "New note" immediately creates an empty note on the server (`POST /notes`)
  in the folder being viewed, and opens it. The editor never holds a note
  that has no id.
- The editor autosaves 1 second after the last change. The header shows
  "Saving…", "Saved" (only after the server confirms) or "Not saved".
- A save sends the title, body and the `version` the client last received.
  The server applies it in one transaction only if the note belongs to the
  user, is not in Trash, and that version is still current, and returns the
  new version. A stale version returns HTTP 409 with the current version.
- At most one save per note is in flight. Changes made meanwhile are sent
  as one further save when the first returns.
- On 409 the user chooses: **keep mine** (the client saves again using the
  version from the 409 response) or **load theirs** (the client discards its
  copy and reloads). No merging.
- Failures:
  - network error or 5xx: retried after 2, 5, then every 15 seconds;
  - 413 (storage limit), 400, 404: not retried; a specific message is shown;
  - 401: not retried; the app shows the sign-in page.
  In every case "Not saved" is shown and the local draft (below) is kept.
- Local drafts: until the server confirms a save, the title, body and the
  `version` they were based on are kept in `localStorage` under
  `draft:<user id>:<note id>`. Opening a note that has a draft offers to
  restore or discard it; restoring saves with the stored base version, so a
  change made elsewhere produces the normal 409 choice. `localStorage`
  failures are tolerated.
- Draft privacy: signing out removes that user's drafts; if any are unsaved
  the user is first asked to confirm discarding them. Signing in removes
  drafts belonging to any other user id.
- Switching notes or signing out waits up to 3 seconds for a pending save and
  then proceeds, with a notice if changes remain only on this device.
  Closing or reloading the tab with unconfirmed changes triggers the
  browser's "leave site?" warning. No save is attempted during page unload.

### 6.4 Trash

- Deleting a note sets its trashed timestamp. Trash is a view, not a folder.
- A note in Trash keeps its folder and tags, but is hidden from search and
  from every folder, tag and "All notes" view, and cannot be edited.
- From Trash a note can be restored (to its folder if that still exists,
  otherwise unfiled) or deleted permanently. "Empty Trash" deletes all of the
  user's trashed notes permanently after a confirmation.
- Nothing is ever removed from Trash automatically.

### 6.5 Images

- Added by upload button, paste, or dropping a file onto the editor. Each is
  uploaded with `POST /api/images`, which returns the id and `src`.
- An image belongs to a user, not to one note, so content copied between that
  user's notes keeps working.
- Accepted: PNG, JPEG, GIF, WebP, up to 10 MB each. The server decides the
  type by fully decoding the file with an image library, not from its name or
  declared type, and refuses anything that fails to decode, is larger than
  10,000 pixels on a side, or is another format (including SVG). The original
  bytes are stored unchanged.
- Storage: the upload is written to a temporary file; then one transaction
  checks the storage limit and inserts the row (id, owner, type, size,
  created); then the file is renamed into a per-user directory under its id.
  If any step fails the temporary file is removed and nothing is recorded.
- Served only at `GET /api/images/<id>`, only to the owner's session
  (otherwise 404), with the stored `Content-Type`,
  `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, and private caching.
- Which notes use which images is recorded in a link table, rewritten in the
  same transaction as each save.
- Clean-up: an image is deleted when it is more than 24 hours old and no note
  of its owner, Trash included, references it. This check runs when the app
  starts, once every 24 hours while it runs (an in-process timer), and after
  a permanent delete or Empty Trash. The row is deleted first, then the file.
- On start the app also removes leftover temporary files, files with no row,
  and rows with no file.
- Images count toward the user's storage limit (section 6.6).

### 6.6 Storage limit

- Each user has a limit, default 1 GB (`NOTES_USER_QUOTA_MB`), on the total
  of note body sizes (UTF-8 bytes of the stored JSON) plus image file sizes,
  including notes in Trash.
- The check and the write happen in the same transaction. A browser save,
  image upload or agent note that would exceed the limit is rejected (HTTP
  413, or an MCP tool error) and nothing is written. Existing notes stay
  readable and can be trashed and deleted.

## 7. Folders, tags, search

### 7.1 Folders

- Folders belong to one user and nest to a maximum depth of 10.
- Names are 1-100 characters and unique among siblings (compared without
  regard to case).
- Operations: create, rename, move (not into itself or its descendants, and
  not past the depth limit), delete.
- A folder can be deleted only if it has no subfolders and no notes outside
  Trash. Trashed notes inside it become unfiled.
- Every user has an **Inbox** folder, created with the account. It cannot be
  renamed, moved or deleted, and cannot have subfolders. Agent notes land
  there.
- A note is moved with a "Move to…" menu that shows the folder tree.
- Sidebar views: All notes, Inbox, the folder tree, Unfiled, Tags, Trash.

### 7.2 Tags

- Free-form labels per user: 1-50 characters, stored lower-case, no commas,
  leading and trailing spaces removed.
- A tag row is created the first time it is used and deleted when no note at
  all (including Trash) uses it. The tag list and autocomplete show only tags
  used by at least one note outside Trash.
- A note can have up to 20 tags.
- Operations: add to or remove from a note, with autocomplete; click a tag to
  list its notes. Tags cannot be renamed.

### 7.3 Search

- One search box. Searches title, body text and tag names of the signed-in
  user's notes outside Trash. Sent as `POST /api/search` so the text never
  appears in a URL or a log.
- The FTS5 index (`unicode61` tokenizer, diacritics removed) has one row per
  note with title, body text and tag names. It is updated in the same
  transaction as every change to a note's title, body, tags or Trash state,
  including notes created by agents.
- Building the query: the server splits the input on whitespace, drops empty
  pieces, wraps each piece in double quotes with any `"` inside doubled, and
  appends `*` after the closing quote of the last piece. The result is bound
  as the `MATCH` parameter. Input with no usable piece returns no results
  without querying. No user input can act as FTS5 syntax or cause an error.
- Results are ranked with `bm25`, title weighted higher, limited to 50, and
  can be narrowed to a folder (with its subfolders) or a tag.
- Each result carries a plain-text snippet; the browser highlights the
  search words in it. The server never returns HTML.
- Results appear as the user types (debounced 200 ms).

## 8. Agents and the MCP server

### 8.1 Agent identity

- An agent belongs to exactly one user and has a name (1-50 characters,
  unique per user). It is created by the CLI, which prints its token once.
- The token is 32 random bytes, shown as `nta_` plus base64url. Only its
  SHA-256 hash is stored. Tokens do not expire; they are revoked by the CLI.
- `/mcp` and `/api` use separate authentication code. An agent token is
  accepted only at `/mcp`; a session cookie is accepted only at `/api`. Both
  directions are covered by tests.

### 8.2 Endpoint

- `POST https://<host>/mcp`: MCP Streamable HTTP, stateless, JSON responses
  (no server-side MCP sessions and no SSE stream). Every other HTTP method
  returns 405.
- Authentication: `Authorization: Bearer <token>`. A missing, unknown or
  revoked token, or the token of a disabled user, gets HTTP 401.
- Any request to `/mcp` that carries an `Origin` header is rejected with 403,
  and no CORS headers are ever sent, so a web page cannot call it.
- Request body limit 1 MB.
- Permitted MCP methods: `initialize`, `notifications/initialized`, `ping`,
  `tools/list`, and `tools/call` for `create_note`. The server advertises the
  `tools` capability only: no resources, prompts, sampling or other tools.
  Any other method or tool name returns the standard MCP error.

### 8.3 The one tool: `create_note`

| Field | Type | Rules |
|---|---|---|
| `title` | string | required, 1-200 characters |
| `content` | string | required, Markdown, up to 100,000 bytes of UTF-8 |
| `tags` | string[] | optional, up to 10, same rules as section 7.2 |

- Creates a note owned by the agent's user, in that user's Inbox, version 1,
  with origin set to the agent's name. The web app shows "by <agent name>".
- Markdown (CommonMark plus GFM tables, task lists and strikethrough) is
  converted on the server, without a browser, into the schema of section 6.2,
  and the result must pass the same validation as a browser save. Raw HTML is
  kept as literal text. Images become their alt text. Links with other
  schemes become plain text. Heading levels 4-6 become level 3.
- The rate check, the storage check and the creation of the note, its tags
  and its search row happen in one transaction. If the converted body exceeds
  1 MB, a limit would be exceeded, or any field breaks a rule, the tool
  returns an error and nothing is created.
- Rate limit: 60 successful calls per hour per agent
  (`NOTES_AGENT_RATE_PER_HOUR`), counted from the database so it survives a
  restart.
- Returns the new note's id and a one-line confirmation, and nothing else.
- There is no tool, parameter or method to read, list, search, update, move
  or delete anything, and the agent cannot choose the folder.

### 8.4 Supported clients

- The automated tests use the MCP SDK's own client.
- Claude Code, Codex, Grok and Muse are command-line tools that run on the
  user's machine and are configured with the `/mcp` URL and the bearer token.
  Before hand-over each is checked by hand, once, against the local
  deployment, and the working configuration goes in the README.
- If a client cannot be made to work with a static bearer token, that is
  reported to the owner rather than worked around silently, and its README
  entry says so.

## 9. Command-line tool

Run on the VPS as `docker compose exec app notes <command>`, or, when the app
container is not running, `docker compose run --rm app notes <command>`. It
is part of the app image, uses the shared data-access module, opens the SQLite
file directly with the same `busy_timeout`, and is safe to use while the app
is running.

| Command | Effect |
|---|---|
| `user add <username>` | Create a user and their Inbox. Prompts for a password twice, or `--generate` prints a random one once |
| `user list` | Username, created date, enabled or disabled, note count, storage used, agent count |
| `user passwd <username>` | Set a new password; ends that user's sessions |
| `user disable <username>` / `user enable <username>` | Block or allow sign-in; a disabled user's sessions end and their agents get 401 |
| `user delete <username>` | Delete the user and all their notes, folders, tags, images and agents, after typing the username to confirm |
| `agent add <username> <agent-name>` | Create an agent; prints the token once, with the client configurations from section 8.4 filled in |
| `agent list [<username>]` | Agent name, owner, created date, last used, notes created, revoked or not |
| `agent revoke <username> <agent-name>` | Token stops working at once; its notes stay |
| `data copy <dir>` | Write a consistent copy of the database (`VACUUM INTO`) and of the image files into the new directory `<dir>`. Manual, never scheduled |

## 10. Web interface

- Sign-in page.
- Main screen in three parts: sidebar (views from 7.1, folder tree, tags),
  note list (title, snippet, updated time, tags, agent badge; newest update
  first; loaded 50 at a time), editor with a formatting toolbar.
- New note button and keyboard shortcut (section 6.3); the note is unfiled
  when the current view is not a folder.
- A storage-used indicator and the signed-in username, with sign out.
- On a phone-width screen the three parts become stacked screens.
- Light and dark theme following the system setting.
- No third-party scripts, fonts or analytics; everything is served by the app.

## 11. Security requirements

- Every read and every write is scoped by the signed-in user's id on the
  server. Every id a request refers to (note, folder, parent folder, image)
  is checked to belong to that user before anything is changed. Another
  user's id behaves exactly like one that does not exist (404).
- Headers on every page: a Content Security Policy with `default-src 'self'`,
  `script-src 'self'`, `img-src 'self'`, `style-src 'self' 'unsafe-inline'`
  (the editor sets inline styles), `frame-ancestors 'none'`; plus
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, and HSTS
  (set by Caddy).
- Note bodies are rendered only through Tiptap with the fixed schema; no HTML
  from a note or a search result is ever inserted into the page.
- Body limits: 2 MB for `/api`, 11 MB for the image upload route only, 1 MB
  for `/mcp`.
- The `app` container runs as a non-root user and is reachable only through
  Caddy.
- Logging: request logs record method, path without query string, status and
  duration only. `Authorization`, `Cookie` and `Set-Cookie` are redacted in
  both the app's and Caddy's logs, and bodies are never logged. A test
  asserts that a token and a session id used in requests do not appear in the
  log output.
- `.env` holds only non-secret settings and is not committed.

## 12. Deployment

- Deliverables: `Dockerfile`, `docker-compose.yml`, `Caddyfile`,
  `.env.example`, `README.md`.
- Services `app` and `caddy`, both `restart: unless-stopped`, on one Compose
  network with a fixed subnet. Named volumes: `notes-data` (database and
  images, mounted at `/data`) and Caddy's data and config volumes.
- The image creates `/data` owned by the non-root app user before switching
  to that user, so a new named volume is writable on first start.
- `.env`: `NOTES_HOST` (required), `NOTES_USER_QUOTA_MB` (default 1024),
  `NOTES_AGENT_RATE_PER_HOUR` (default 60). `NOTES_HOST` must be a bare
  hostname (no scheme, port or slash); the app refuses to start otherwise,
  with a message showing the expected form. Compose passes it to both
  services; the Caddyfile uses `{$NOTES_HOST}` as its site address.
- With `NOTES_HOST=localhost`, Caddy serves a certificate from its own local
  authority. The README explains how to copy that authority's root
  certificate out of the Caddy volume and make the browser and the agent
  clients trust it. Certificate checking is never switched off.
- On the VPS, Caddy obtains the certificate over ports 80/443. No DuckDNS
  token is needed. `duckdns.org` is on the Public Suffix List, so Let's
  Encrypt's limits apply to this hostname alone.
- Starting the app: open the database. If migrations are pending, first write
  a snapshot with `VACUUM INTO` to a temporary file on `/data`, then rename
  it to `/data/pre-upgrade.db` (replacing any earlier one), then apply the
  migrations in a transaction. If a migration fails the process exits
  non-zero with a clear log line, leaving the database as it was. This
  snapshot is an upgrade safety net, not a backup schedule; it does not
  include images.
- `GET /healthz` returns 200 only once migrations have finished and a
  database query succeeds; it is the Compose health check for `app`, and
  `caddy` waits for it.

### README must cover

1. What the app is, and that there are no backups: losing the VPS disk loses
   every note. The manual copy (`data copy`, then `docker compose cp`).
2. Prerequisites: Debian version, opening ports 80 and 443, installing Docker.
3. Checking that `chyld-notes.duckdns.org` resolves to the VPS.
4. Getting the code onto the VPS, writing `.env`, starting it.
5. Creating the first user; creating an agent; connecting each of the four
   clients in section 8.4, with a worked example.
6. Updating to a new version. Rolling back a failed update: stop both
   services, put `pre-upgrade.db` in place of the database, delete the
   database's `-wal` and `-shm` files, check out the previous version and
   start it; with a warning that notes changed after the snapshot are lost.
7. Stopping, starting, viewing logs.
8. Testing on a local machine with `NOTES_HOST=localhost`, including trusting
   the local certificate.
9. Troubleshooting: certificate not issued, port already in use, forgotten
   password, hostname no longer resolving, storage limit reached, app not
   starting after an update.

## 13. Acceptance criteria

1. Following only the README on a fresh Debian VPS produces a working site at
   `https://chyld-notes.duckdns.org` with a trusted certificate. (Checked by
   the owner; everything below is checked locally and by automated tests.)
2. A user cannot read, search, change, move, tag or delete another user's
   notes, folders, tags or images, including by sending their ids.
3. A note containing every supported element, including a table and an
   image, survives save, reload and search. The same holds for an
   agent-created note containing every Markdown element.
4. With an agent token, the MCP handshake, `tools/list` and `create_note`
   succeed and the note appears in the owner's Inbox with the agent's name;
   any other tool or method fails; the token is refused by `/api`; a session
   cookie is refused by `/mcp`. The test uses the MCP SDK client.
5. A revoked token and a disabled user's token get 401.
6. Search finds a note by a word in its title, body and tag; never returns a
   trashed note or another user's note; and does not error on input such as
   `C++`, `"`, `(`, `a:b`, `*`, `AND` or an empty string.
7. Two saves from the same starting version: one succeeds, one gets 409, and
   both "keep mine" and "load theirs" end in a consistent state. Changing a
   note's tags or folder while it is being edited causes no 409.
8. Agent Markdown containing raw HTML, a `javascript:` link and an image
   yields a note with none of them active. An over-size, over-quota or
   over-rate call creates nothing.
9. Sign-in limits count separate client addresses separately behind the
   proxy, and a forged `X-Forwarded-For` from outside does not change that.
10. A file that is not a decodable PNG, JPEG, GIF or WebP is refused; an
    image is never served to another user; an image used in two notes
    survives the permanent deletion of one of them; an unreferenced image
    older than 24 hours is removed by the clean-up.
11. A session is refused after 30 idle days and after 90 days (tested with a
    controllable clock), and after sign-out, password change or disabling.
12. A state-changing request with a missing or foreign `Origin` is rejected.
13. Folder rules (depth, sibling names, moving into a descendant, deleting a
    non-empty folder, Inbox protection) and Trash rules (hidden from views
    and search, restore, Empty Trash) hold.
14. The storage limit rejects a save, an upload and an agent note that would
    exceed it, leaving nothing partly written.
15. Each CLI command in section 9 works against a running app; a failing
    migration leaves the database unchanged and the snapshot in place.
16. No token or session id appears in the logs.
17. Automated tests cover items 2-16 and run with one command.
