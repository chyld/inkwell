### 1. [high] Per-username login lockout and proxy IP blind spot
In section 5, limiting 5 failed logins per username enables remote DoS, while Caddy (sections 4, 12) hides client IPs so all users share the 20/IP bucket. Change section 5 to limit by `(IP, username)` instead of username alone, and require Caddy to forward client IPs with Fastify `trustProxy` restricted to Caddy's internal address.

### 2. [high] FTS5 search rules contradict prefix matching and crash on punctuation
Section 7.3 requires prefix matching while forbidding splicing input into FTS syntax. Passing raw input to `MATCH ?` still parses FTS5 operators, crashing on `C++` or unmatched quotes and blocking safe `*` prefixing. Change section 7.3 to tokenize input, double-quote each token (escaping quotes), and append `*` outside the final quoted token before binding.

### 3. [high] Server-side Tiptap validation and Markdown conversion lack a DOM-free spec
Sections 6.3 and 8.3 require validating Tiptap JSON and compiling agent Markdown into Tiptap JSON on the server, without specifying how a browser editor schema runs in Node or enforces heading and URL-scheme rules. Change sections 6.3 and 8.3 to require `@tiptap/pm/model` validation with explicit URL checks and a DOM-free Markdown-to-ProseMirror converter.

### 4. [high] Copying a live SQLite WAL file by hand corrupts backups
Section 4 runs SQLite in WAL mode, yet section 12 tells the README to copy the database file by hand while `app` runs. Copying a live WAL file omits `-wal` frames and risks a torn, unusable backup. Change section 12 to require an online SQLite backup via `sqlite3 .backup` or `VACUUM INTO` instead of a file copy.

### 5. [medium] Trash behavior contradicts empty-folder deletion and tag pruning
Section 6.4 hides trashed notes yet restores them to their old folder, contradicting section 7.1 (delete only empty folders) and section 7.2 (tags disappear when unused outside Trash). Change section 7.1 so folder deletion ignores and unfiles trashed notes, and section 7.2 so trashed notes retain hidden tags until permanent deletion.

### 6. [medium] Over-engineered note lifecycle and incomplete conflict handling
Sections 6.3, 6.4, 7.1, and 10 over-engineer for under 10 users with nested drag-and-drop folders, a 30-day Trash job, and conflict modals that omit "keep mine" version updates and clash with tag/folder edits. Simplify those sections to flat folders, immediate delete with confirmation, and last-write-wins saving.

VERDICT: A solid, well-scoped core architecture, but it needs fixes for login rate-limiting/proxy trust, FTS5 querying, server-side Tiptap handling, WAL backups, Trash contradictions, and feature bloat before implementation.
END-OF-REVIEW
