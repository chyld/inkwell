# Review of SPEC.md (notes app)

### 1. [high] No backups, and the manual-copy fallback is unsafe on a live WAL database

Sections 2 ("Backups | None"), 12 (README item 1) and 6.4. Copying a live SQLite file in WAL mode with `cp` can produce a corrupt backup, and the 30-day trash purge plus destructive `user delete` make data loss permanent. Change 2 and 12: require `sqlite3 <db> ".backup ..."` (or VACUUM INTO) for the manual copy, and add a nightly retained copy (e.g. 7 days) in the app container.

### 2. [high] Normative section 8.3 contradicts open question 14.7 on agent tags

Section 8.3 defines `tags` as a valid optional `create_note` input, yet section 14 question 7 still asks "may agents set tags". The agent API contract is undecided while written as decided. Change: resolve all eight section-14 questions before building, fold answers into sections 5–8 and 12, bump the status line from "draft 1", and delete the `tags` row from 8.3 if refused.

### 3. [medium] Two parallel Tiptap-schema pipelines that must match forever

Section 6.3 requires server-side validation of Tiptap JSON; section 8.3 adds a separate Markdown→Tiptap converter. If they drift, agent notes render differently or are rejected. Change: specify one shared schema module used by both paths, and extend acceptance criterion 13.3 to require an agent-created note containing every supported construct to survive render, reload and search.

### 4. [medium] CLI reimplements app logic against the same database file

Section 9 ("The CLI talks to the SQLite file directly") implies the CLI duplicates Argon2id hashing, Inbox creation, session invalidation and cascade deletes independently of the app. Silent drift between the two corrupts data. Change section 9: state explicitly that the CLI is the same codebase/image importing the app's shared data-access module, never a parallel implementation.

### 5. [medium] Autosave plus version conflicts will nag users in normal use

Section 6.3: 1-second autosave with strict version checks means two open tabs (same user, same note) trigger constant "keep mine or load theirs" prompts, and "Not saved" recovery is unspecified. Change 6.3: allow last-writer-wins between tabs of the same session (conflict prompt only across sessions/devices) and require unsent edits to persist in browser storage until acknowledged.

### 6. [low] Over-scoped UI for fewer than 10 users

Sections 7.1 (folders nested to depth 5), 10 (drag-and-drop, two themes, mobile stacking) and 6.4 (daily trash-purge job) add large build/test cost for a tiny user base. Change: cap nesting at one level, drop drag-and-drop in favour of the move menu, and drop the daily purge job (manual empty-trash; durability then comes from finding 1).

VERDICT: Security model and scoping are mostly sound, but the spec is not buildable as-is — resolve the section-14 contradictions, fix the backup story, and collapse the duplicated Tiptap and CLI logic first.

END-OF-REVIEW
