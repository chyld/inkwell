### 1. [high] Manual recovery and upgrades can lose the database
Sections 4 and 12 enable WAL but promise a command that copies the database file. A live copy can omit committed WAL data or be inconsistent; automatic migrations also lack a recovery path. Specify a tested SQLite online-backup command, require a manual snapshot before upgrades, and document restoring it with the previous app version after migration failure.

### 2. [high] Autosave does not protect unsaved edits
Section 6.3 relies on timers, blur and page-hidden events without defining navigation or failed-save recovery. Switching notes or closing a tab can discard edits before a request completes. Require internal navigation to await acknowledgement, preserve unacknowledged drafts locally for recovery, and show “Saved” only after server acknowledgement; define retry behavior and an unsaved-changes warning.

### 3. [medium] Version checks need atomic write semantics
Section 6.3 allows a check-then-write implementation where concurrent saves both pass and silently overwrite each other. Specify an initial version, an atomic conditional update that increments it, and the returned version. Serialize saves per editor and bind responses to their submitted revision. Define “keep mine” as another conditional save against the conflict version shown to the user.

### 4. [medium] Agent limits do not bound disk consumption
Section 8.3 permits 1,440 notes per day per agent indefinitely. The per-request limits in section 11 cannot prevent a valid token from filling the shared database volume and stopping saves for everyone. Add a configurable per-user storage quota covering browser and agent writes, a free-space reserve, and explicit rejection behavior that preserves existing notes.

### 5. [medium] MCP acceptance criteria reject required protocol operations
Section 13.4 requires every operation other than note creation to fail, but MCP clients need initialization and tool discovery to use create_note. Amend sections 8.2 and 13.4 to explicitly allow required protocol lifecycle and discovery methods while exposing only create_note as an application tool. Require an integration test using the README's actual MCP client configuration.

### 6. [medium] Literal full-text search is underspecified
Section 7.3 says input is passed as data, but binding a SQL parameter does not stop FTS5 from interpreting that parameter as query syntax. Ordinary punctuation can cause errors, and operators can change search meaning. Specify literal tokenization and FTS escaping, then construct the final-token prefix expression server-side; add acceptance cases for quotes, punctuation, operators and empty input.

VERDICT: The architecture is proportionate for fewer than 10 users, but recovery, reliable saving, storage limits and protocol details need concrete requirements before implementation.
END-OF-REVIEW
