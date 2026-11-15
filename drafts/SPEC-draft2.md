# Notes app: specification

Status: draft 2, for review. Nothing is built yet. Draft 1 is kept in
`drafts/SPEC-draft1.md`; its 14 reviews are in `reviews/`.

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

## 3. Out of scope

Sharing, live co-editing, public sign-up, password reset by email, password
change in the web app, export/import, version history, mobile or desktop apps,
offline use, backups, an admin web page, drag and drop, renaming tags, OAuth
for MCP (so claude.ai web connectors are not supported), file attachments
other than images.

## 4. Stack and layout

- Front end: React, Vite, TypeScript, Tiptap.
- Back end: Node.js, TypeScript, Fastify. One process serves the built front
  end, the JSON API under `/api`, and the MCP endpoint at `/mcp`.
- Database: one SQLite file, WAL mode, `busy_timeout` 5 seconds, foreign keys
  on. Full-text search with SQLite FTS5.
- Images: files on the same Docker volume as the database, not inside SQLite.
- MCP: the official MCP TypeScript SDK, Streamable HTTP transport, stateless.
- HTTPS: Caddy as reverse proxy with automatic Let's Encrypt certificates.
- Containers: `app` and `caddy`. Only Caddy publishes ports (80 and 443).
- One codebase and one image. The web server, the CLI (section 9) and the MCP
  endpoint all use the same data-access module and the same note-schema
  module (section 6.2); none of them re-implements the other's logic.

## 5. Users and sign-in

- Accounts are created only by the CLI. There is no sign-up page.
- Username: 3-32 characters, `a-z 0-9 - _`, unique, stored lower-case.
  Password: minimum 12 characters, hashed with Argon2id.
- Sign-in creates a new session with a fresh random 32-byte id (any earlier
  session id in the request is ignored). The database stores only the
  SHA-256 hash of the id. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`,
  path `/`.
- A session ends after 30 days without use, and 90 days after sign-in
  regardless. Expired rows are removed when the app starts and at sign-in.
- Sign-out deletes the session. Disabling or deleting a user, or changing
  their password, deletes all of that user's sessions.
- Rate limiting of failed sign-ins, counted in memory:
  - 5 per (username, client IP) pair per 15 minutes;
  - 20 per client IP per 15 minutes.
  There is no limit keyed on username alone, so nobody can lock another
  person out. Failures return one generic message.
- Client IP: Caddy sets `X-Forwarded-For` (overwriting anything the client
  sent). Fastify trusts that header only from the Compose network
  (`trustProxy` restricted to it).
- CSRF: every state-changing `/api` request must carry an `Origin` header
  equal to `https://<NOTES_HOST>` (a configured value, never derived from the
  request's `Host`); otherwise it is rejected.

## 6. Notes

### 6.1 A note has

- A title (plain text, up to 200 characters; empty shows as "Untitled").
- A body: the Tiptap document, stored as JSON. Maximum 1 MB.
- Plain text extracted from the body on every save, used only for search.
- A `version` integer: 1 when created, plus 1 on every successful change to
  the title, body, folder or tags.
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
A body that fails validation is rejected with HTTP 400.

### 6.3 Saving

- The editor autosaves 1 second after the last change. The header shows
  "Saving…", "Saved" (only after the server confirms) or "Not saved".
- A save sends the title, body and the `version` the client last received.
  The server applies it in one transaction only if that version is still
  current (`UPDATE … WHERE id = ? AND user_id = ? AND version = ?`), and
  returns the new version. Otherwise it returns HTTP 409 with the current
  version.
- At most one save per note is in flight. Changes made meanwhile are sent
  as one further save when the first returns.
- Until the server confirms it, the unsaved title and body are kept in the
  browser's `localStorage` under the note id. On opening a note with a
  leftover local copy, the app offers to restore or discard it. `localStorage`
  failures are tolerated.
- Switching notes or signing out first waits for the pending save. Closing or
  reloading the tab with unconfirmed changes triggers the browser's
  "leave site?" warning. No save is attempted during page unload.
- A failed save (network or server error) is retried with back-off: 2, 5,
  then every 15 seconds, while "Not saved" is shown.
- On 409 the user chooses: **keep mine** (the client saves again using the
  version from the 409 response) or **load theirs** (the client discards its
  copy and reloads). No merging.

### 6.4 Trash

- Deleting a note sets its trashed timestamp. Trash is a view, not a folder.
- A note in Trash keeps its folder and tags, but is hidden from search and
  from every folder, tag and "All notes" view, and cannot be edited.
- From Trash a note can be restored (to its folder if that still exists,
  otherwise unfiled) or deleted permanently. "Empty Trash" deletes all of the
  user's trashed notes permanently after a confirmation.
- Nothing is ever removed from Trash automatically.

### 6.5 Images

- Added by upload button, paste, or drop of a file onto the editor.
- Accepted: PNG, JPEG, GIF, WebP, up to 10 MB each. The type is decided by the
  file's leading bytes on the server, not by its name or declared type. SVG
  is refused.
- Stored as files named by a random id under a per-user directory on the data
  volume, with a database row: id, owner, note, type, size, created.
- Served only at `GET /api/images/<id>`, only to the owner's session
  (otherwise 404), with the stored `Content-Type`,
  `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, and private caching.
- An image belongs to one note. It is deleted when that note is permanently
  deleted. When a note is saved, images of that note that the saved body no
  longer references, and that were uploaded more than 24 hours ago, are
  deleted. (Undoing the removal of an image after that point shows a broken
  image; this is accepted.)
- Images count toward the user's storage limit (section 6.6).

### 6.6 Storage limit

- Each user has a limit, default 1 GB (`NOTES_USER_QUOTA_MB`), on the total
  of note body bytes plus image bytes, including notes in Trash.
- A browser save, image upload or agent note that would exceed it is rejected
  with a clear message (HTTP 413, or an MCP tool error); nothing is partly
  written. Existing notes stay readable and can be deleted.

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
  user's notes outside Trash.
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
- Each result carries a plain-text snippet plus the character ranges to
  highlight; the server never returns HTML.
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
  (no server-side MCP sessions and no SSE stream). `GET` and `DELETE` return
  405.
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
- If the converted body exceeds 1 MB, or the user's storage limit would be
  exceeded, or any field breaks a rule, the tool returns an error and nothing
  is created (no note, no tags).
- Rate limit: 60 successful calls per hour per agent
  (`NOTES_AGENT_RATE_PER_HOUR`), counted from the database so it survives a
  restart; over the limit returns a tool error.
- Returns the new note's id and a one-line confirmation, and nothing else.
- There is no tool, parameter or method to read, list, search, update, move
  or delete anything, and the agent cannot choose the folder.

### 8.4 Supported clients

The README gives a tested, copy-paste configuration for each of Claude Code,
Codex, Grok and Muse, each sending the token as a bearer header to the
`/mcp` URL. During the build each one is checked end to end against the local
deployment. If one of them cannot send a static bearer header to a remote
MCP server, that is reported to the owner rather than worked around silently.

## 9. Command-line tool

Run on the VPS as `docker compose exec app notes <command>`. It is part of the
app image, uses the shared data-access module, opens the SQLite file directly
with the same `busy_timeout`, and is safe to use while the app is running.

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
| `db copy <path>` | Write a consistent copy of the database to `<path>` using `VACUUM INTO`. Manual, never scheduled |

## 10. Web interface

- Sign-in page.
- Main screen in three parts: sidebar (views from 7.1, folder tree, tags),
  note list (title, snippet, updated time, tags, agent badge; newest update
  first; loaded 50 at a time), editor with a formatting toolbar.
- New note button and keyboard shortcut; the note goes in the folder being
  viewed, or is unfiled when the view is not a folder.
- A storage-used indicator and the signed-in username, with sign out.
- On a phone-width screen the three parts become stacked screens.
- Light and dark theme following the system setting.
- No third-party scripts, fonts or analytics; everything is served by the app.

## 11. Security requirements

- Every read and every write is scoped by the signed-in user's id on the
  server. Every id a request refers to (note, folder, parent folder, image)
  is checked to belong to that user before anything is changed. Another
  user's id behaves exactly like one that does not exist (404).
- Headers on every page: a Content Security Policy forbidding inline scripts
  and third-party origins (`img-src 'self'`), `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, and HSTS
  (set by Caddy).
- Note bodies are rendered only through Tiptap with the fixed schema; no HTML
  from a note or a search result is ever inserted into the page.
- Body limits: 2 MB for `/api`, 11 MB for the image upload route only, 1 MB
  for `/mcp`.
- The `app` container runs as a non-root user and is reachable only through
  Caddy.
- Logs never contain passwords, tokens, session ids or note content.
- `.env` holds only non-secret settings and is not committed.

## 12. Deployment

- Deliverables: `Dockerfile`, `docker-compose.yml`, `Caddyfile`,
  `.env.example`, `README.md`.
- Services `app` and `caddy`, both `restart: unless-stopped`. Named volumes:
  `notes-data` (database and images, mounted at `/data`) and Caddy's data and
  config volumes.
- The image creates `/data` owned by the non-root app user before switching
  to that user, so a new named volume is writable on first start.
- `.env`: `NOTES_HOST` (required), `NOTES_USER_QUOTA_MB` (default 1024),
  `NOTES_AGENT_RATE_PER_HOUR` (default 60). Compose passes `NOTES_HOST` to
  both services; the Caddyfile uses `{$NOTES_HOST}` as its site address.
- With `NOTES_HOST=localhost`, Caddy serves its own locally trusted
  certificate, which is how the app is tested before deployment.
- On the VPS, Caddy obtains the certificate over ports 80/443. No DuckDNS
  token is needed. `duckdns.org` is on the Public Suffix List, so Let's
  Encrypt's limits apply to this hostname alone.
- Starting the app: open the database, and if migrations are pending, first
  write one snapshot `/data/pre-upgrade.db` (`VACUUM INTO`, replacing any
  earlier one), then apply them in a transaction. If a migration fails the
  process exits non-zero with a clear log line, leaving the database as it
  was. This snapshot is an upgrade safety net, not a backup schedule.
- `GET /healthz` returns 200 only once migrations have finished and a
  database query succeeds; it is the Compose health check for `app`, and
  `caddy` waits for it.

### README must cover

1. What the app is, and that there are no backups: losing the VPS disk loses
   every note. The manual copy command (`db copy`, then `docker compose cp`).
2. Prerequisites: Debian version, opening ports 80 and 443, installing Docker.
3. Checking that `chyld-notes.duckdns.org` resolves to the VPS.
4. Getting the code onto the VPS, writing `.env`, starting it.
5. Creating the first user; creating an agent; connecting each of the four
   clients in section 8.4, with a worked example.
6. Updating to a new version, and rolling back to the previous version with
   `pre-upgrade.db` if the update fails; stopping; viewing logs.
7. Testing on a local machine with `NOTES_HOST=localhost`.
8. Troubleshooting: certificate not issued, port already in use, forgotten
   password, hostname no longer resolving, storage limit reached.

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
   cookie is refused by `/mcp`. The test uses a real MCP client from the SDK.
5. A revoked token and a disabled user's token get 401.
6. Search finds a note by a word in its title, body and tag; never returns a
   trashed note or another user's note; and does not error on input such as
   `C++`, `"`, `(`, `a:b`, `*`, `AND` or an empty string.
7. Two saves from the same starting version: one succeeds, one gets 409, and
   both "keep mine" and "load theirs" end in a consistent state.
8. Agent Markdown containing raw HTML, a `javascript:` link and an image
   yields a note with none of them active. An over-size or over-quota call
   creates nothing.
9. Sign-in limits count separate client addresses separately behind the
   proxy, and a forged `X-Forwarded-For` from outside does not change that.
10. An uploaded file that is not a real PNG, JPEG, GIF or WebP is refused,
    and an image is never served to another user.
11. Automated tests cover items 2-10 and run with one command.
