# Review of SPEC.md (draft 2)

### 1. [medium] Session cookie lifetime unspecified (§5)
The cookie lists HttpOnly, Secure, SameSite, path — but no Max-Age. Without one it is a session cookie, cleared when the browser closes, contradicting §2's 90-day sessions. Specify `Max-Age` of 90 days, refreshed at sign-in.

### 2. [medium] NOTES_HOST format unspecified (§12, §5)
NOTES_HOST is compared against the Origin header for CSRF and used as Caddy's site address. A value with a scheme, port or trailing slash silently breaks sign-in for everyone. Require a bare hostname, validate it at startup, and show the exact format in `.env.example`.

### 3. [medium] Uploading an image into a new, unsaved note is undefined (§6.5, §6.3)
An image row references a note id, but a pasted image can arrive before the note exists. State that choosing "New note" creates the note on the server immediately, so uploads always have an owner.

### 4. [medium] Orphaned images can persist forever (§6.5)
Unreferenced images are deleted only when the note is next saved. A note never saved again keeps its orphan images, invisibly consuming the 1 GB quota with no cleanup path. Add a trigger, e.g. an orphan sweep when the note is opened.

### 5. [low] Server-computed highlight character ranges (§7.3)
Returning per-result character ranges is extra server complexity for under 10 users. Return a plain-text snippet only and highlight the query terms client-side; drop the ranges from the spec.

VERDICT: READY TO BUILD — the four medium items are clarifications to fold into the spec before or during implementation, not design problems.
END-OF-REVIEW
