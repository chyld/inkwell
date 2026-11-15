# Notes app: specification

Status: draft 1, for review. Nothing is built yet.

Items marked **(assumed)** were not decided by the owner; they are the author's
defaults and are listed again under "Open questions".

## 1. Summary

A private, self-hosted, web-based note-taking app for fewer than 10 people.
Each person has their own notes; nobody can see anyone else's. Notes are
written in a rich-text editor (Tiptap) and organised with folders and tags,
with full-text search. An AI agent can add notes to one user's account through
an MCP server, and can do nothing else. The owner deploys it to a Debian VPS
with Docker Compose by following the README.

## 2. Decided requirements

| Topic | Decision |
|---|---|
| Editor | Tiptap |
| Scale | Fewer than 10 users |
| Sharing | None. A note belongs to exactly one user |
| Co-editing | None |
| User management | Command-line tool on the server only |
| Agent management | Command-line tool on the server only; each user can have agents |
| Agent access | MCP server on the same server as the app; create notes only |
| Organisation | Folders, tags, full-text search |
| Hosting | Debian VPS, Docker Compose |
| HTTPS | Required; free DuckDNS hostname (the owner has no domain) |
| Backups | None |
| Deployment | Done by the owner from the README |

## 3. Out of scope

Sharing, live co-editing, public sign-up, password reset by email, images and
file attachments, export/import, version history, mobile or desktop apps,
offline use, automatic backups, an admin web page.

## 4. Stack **(assumed; recommended by 10-11 of 14 beta agents)**

- Front end: React, Vite, TypeScript, Tiptap.
- Back end: Node.js, TypeScript, Fastify. One process serves the built front
  end, the JSON API under `/api`, and the MCP endpoint at `/mcp`.
- Database: SQLite (WAL mode) in a single file on a Docker volume. Full-text
  search with SQLite FTS5.
- MCP: the official MCP TypeScript SDK, Streamable HTTP transport, stateless.
- HTTPS: Caddy as reverse proxy with automatic Let's Encrypt certificates.
- Containers: `app` and `caddy`. Only Caddy publishes ports (80 and 443).

## 5. Users and sign-in

- Accounts are created only by the CLI (section 9). There is no sign-up page.
- A user has a username (3-32 characters, `a-z 0-9 - _`, unique, stored
  lower-case) and a password (minimum 12 characters).
- Passwords are hashed with Argon2id.
- Sign-in creates a server-side session stored in SQLite. The browser holds
  only a random session id in a cookie that is `HttpOnly`, `Secure`,
  `SameSite=Lax`, path `/`. Sessions last 30 days, renewed on use
  **(assumed)**.
- Sign-out deletes the session. Disabling or deleting a user, or changing
  their password, deletes all of that user's sessions.
- Sign-in is rate limited: 5 failed attempts per username per 15 minutes and
  20 per IP address per 15 minutes. Failures return one generic message.
- State-changing API requests must carry an `Origin` header that matches the
  app's own origin; otherwise they are rejected (CSRF protection).
- A user cannot change their own password in the web app; the CLI does it
  **(assumed)**.

## 6. Notes

### 6.1 A note has

- A title (plain text, up to 200 characters; empty shows as "Untitled").
- A body: the Tiptap document, stored as JSON. Maximum size 1 MB.
- Plain text extracted from the body on every save, used only for search.
- At most one folder (none means "unfiled").
- Zero or more tags.
- Created and updated timestamps (UTC).
- An origin: the user, or the name of the agent that created it.

### 6.2 Editor

Tiptap with: paragraphs, headings 1-3, bold, italic, strikethrough, inline
code, code blocks, block quotes, bullet lists, numbered lists, task lists,
horizontal rule, links (`http`, `https`, `mailto` only), undo/redo. No images,
no tables **(assumed)**.

### 6.3 Saving

- Autosave 1 second after the last keystroke and when the editor loses focus
  or the page is hidden. A visible "Saved" / "Saving…" / "Not saved" state.
- Each save sends the note's last known version number. If the server's
  version is newer (the note was changed in another tab or device), the save
  is rejected and the user is asked to choose: keep mine or load theirs.
  No merging.
- The server validates the body against the allowed Tiptap schema and rejects
  anything else.

### 6.4 Deleting **(assumed)**

- Deleting a note moves it to Trash. Trash is a view, not a folder.
- From Trash a note can be restored (to its old folder if it still exists,
  otherwise unfiled) or deleted permanently.
- Notes in Trash for more than 30 days are deleted permanently by a daily job.
- Notes in Trash do not appear in search or in tag and folder views.

## 7. Folders, tags, search

### 7.1 Folders

- Folders belong to one user and can be nested, to a maximum depth of 5.
- Names are 1-100 characters and unique among siblings.
- Operations: create, rename, move (not into itself or its descendants),
  delete. Only an empty folder (no notes, no subfolders) can be deleted
  **(assumed)**.
- Every user has an **Inbox** folder, created with the account. It cannot be
  renamed, moved or deleted. Agent-created notes land there.
- Sidebar views: All notes, Inbox, the folder tree, Unfiled, Tags, Trash.

### 7.2 Tags

- Free-form labels per user: 1-50 characters, stored lower-case, no commas.
- A tag is created the first time it is used and disappears when no note
  (outside Trash) uses it.
- A note can have up to 20 tags.
- Operations: add to or remove from a note, with autocomplete from the user's
  existing tags; rename a tag everywhere; click a tag to list its notes.

### 7.3 Search

- One search box. Searches title, body text and tag names of the signed-in
  user's notes only.
- SQLite FTS5 with the `unicode61` tokenizer, diacritics removed, prefix
  matching on the last word typed. User input is always passed as data, never
  spliced into the FTS query syntax.
- Results are ranked by relevance (title matches weighted higher), show a
  short highlighted snippet, and can be narrowed to a folder or a tag.
- Results appear as the user types (debounced 200 ms).

## 8. Agents and the MCP server

### 8.1 Agent identity

- An agent belongs to exactly one user and has a name (1-50 characters,
  unique per user). It is created by the CLI, which prints its token once.
- The token is 32 random bytes, shown as `nta_` plus base64url. Only its
  SHA-256 hash is stored. Tokens do not expire but can be revoked by the CLI.
- An agent token is accepted only at `/mcp`. It is never accepted by `/api`,
  and a browser session is never accepted by `/mcp`.

### 8.2 Endpoint

- `POST https://<host>/mcp`, MCP Streamable HTTP, stateless (no server-side
  MCP sessions, no SSE stream needed).
- Authentication: `Authorization: Bearer <token>`. Missing, unknown or revoked
  tokens get HTTP 401.
- The server advertises exactly one tool and no resources or prompts.

### 8.3 The one tool: `create_note`

Input:

| Field | Type | Rules |
|---|---|---|
| `title` | string | required, 1-200 characters |
| `content` | string | required, Markdown, up to 100 KB |
| `tags` | string[] | optional, up to 10, same rules as section 7.2 |

Behaviour:

- Creates a note owned by the agent's user, in that user's Inbox, with origin
  set to the agent's name. The web app shows "by <agent name>" on the note.
- Markdown is converted on the server to the same Tiptap schema as section
  6.2. Anything outside that schema is dropped or kept as plain text: raw
  HTML is treated as text, images become their alt text, links with other
  schemes become plain text.
- Returns the new note's id and a short confirmation. It returns no content
  from any other note.
- Rate limit: 60 notes per hour per agent; over the limit returns a tool
  error **(assumed)**.
- There is no tool, and no hidden parameter, to read, list, search, update,
  move or delete anything. An agent cannot choose the folder.

## 9. Command-line tool

Run on the VPS as `docker compose exec app notes <command>`.

| Command | Effect |
|---|---|
| `user add <username>` | Create a user and their Inbox. Prompts for a password twice, or `--generate` prints a random one once |
| `user list` | Username, created date, enabled/disabled, note count, agent count |
| `user passwd <username>` | Set a new password; ends that user's sessions |
| `user disable <username>` / `user enable <username>` | Block or allow sign-in; disabling also blocks that user's agents |
| `user delete <username>` | Delete the user and all their notes, folders, tags and agents, after typing the username to confirm |
| `agent add <username> <agent-name>` | Create an agent; prints the token once, with a ready-to-paste MCP client config |
| `agent list [<username>]` | Agent name, owner, created date, last used, notes created, revoked or not |
| `agent revoke <username> <agent-name>` | Token stops working immediately; its notes stay |

The CLI talks to the SQLite file directly. It has no network interface.

## 10. Web interface

- Sign-in page.
- Main screen in three parts: sidebar (views from 7.1, folder tree, tags),
  note list (title, snippet, updated time, tags, agent badge; sorted by
  updated time, newest first), editor.
- New note button and keyboard shortcut; the new note goes in the folder
  currently being viewed.
- Move a note to a folder by a menu and by drag and drop.
- Usable on a phone-width screen: the three parts become stacked screens.
- Light and dark theme following the system setting.
- No third-party scripts, fonts or analytics; everything is served by the app.

## 11. Security requirements

- Every API query is scoped by the signed-in user's id on the server; ids
  supplied by the client are never trusted on their own. A request for
  another user's note returns 404.
- Content Security Policy that forbids inline scripts and third-party
  origins; `X-Content-Type-Options: nosniff`; `Referrer-Policy: same-origin`;
  HSTS (set by Caddy); `frame-ancestors 'none'`.
- Note bodies are rendered only through Tiptap with the fixed schema; no raw
  HTML from a note is ever inserted into the page.
- Request body limit 2 MB for the API, 200 KB for `/mcp`.
- The `app` container runs as a non-root user and is not reachable from
  outside except through Caddy.
- Logs never contain passwords, tokens, session ids or note content.
- Secrets (none are required beyond the DuckDNS hostname) are kept in `.env`,
  which is not committed.

## 12. Deployment

- `docker-compose.yml` with `app` and `caddy`, and named volumes for the
  database and for Caddy's certificates.
- Configuration in `.env`: `NOTES_HOST` (for example `myname.duckdns.org`).
- The owner creates the DuckDNS name and points it at the VPS's IP address
  once; a static IP is assumed, so no DuckDNS updater runs **(assumed)**.
- Certificates are obtained by Caddy over port 80/443 (no DuckDNS token is
  needed by the app).
- Database migrations run automatically when the `app` container starts.
- `GET /healthz` returns 200 for the Compose health check.

### README must cover

1. What the app is, and that there are no backups (with the one command that
   copies the database file by hand).
2. Prerequisites: Debian version, opening ports 80 and 443, installing Docker.
3. Creating the DuckDNS name and pointing it at the VPS.
4. Getting the code onto the VPS, writing `.env`, starting it.
5. Creating the first user; creating an agent; connecting an MCP client, with
   a worked example.
6. Updating to a new version; stopping; viewing logs.
7. Troubleshooting: certificate not issued, port already in use, forgotten
   password.

## 13. Acceptance criteria

1. Following only the README on a fresh Debian VPS produces a working site at
   `https://<name>.duckdns.org` with a trusted certificate.
2. Two users cannot see, search, or fetch each other's notes, folders or tags,
   including by guessing ids.
3. A note with every supported formatting type survives save, reload and
   search.
4. An agent token can create a note that appears in its owner's Inbox with
   the agent's name, and every other MCP or API operation attempted with that
   token fails.
5. A revoked token and a disabled user's token both get 401.
6. Search finds a note by a word in its title, its body and its tag, and
   never returns a note in Trash or another user's note.
7. Automated tests cover items 2-6 and run with one command.

## 14. Open questions for the owner

1. Stack in section 4: accept?
2. Trash with 30-day clean-up (6.4), or delete immediately?
3. Folder delete only when empty (7.1), or delete with contents?
4. Should users be able to change their own password in the web app (5)?
5. Session length of 30 days (5)?
6. Tables and images stay out of the editor (6.2)?
7. Agent limit of 60 notes per hour, and may agents set tags (8.3)?
8. Is the VPS's IP address static (12)?
