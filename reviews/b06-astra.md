### 1. [high] Manual database copy can lose committed notes

Section 12 promises a command that copies the database file, but section 4 enables WAL: copying only the live main file can omit committed transactions. With no backups, automatic migrations compound the risk. Replace that instruction with SQLite's online backup command; require a verified manual snapshot before upgrades and document restoration after migration failure.

### 2. [high] Autosave does not guarantee preservation of edits

Section 6.3 leaves concurrent saves, conflict overrides and page closure unspecified. A debounced save can disappear on navigation, and non-atomic version checks can silently overwrite edits. Require atomic version comparison/increment, one in-flight save per note, retention of subsequent edits until acknowledged, explicit version-checked conflict resolution, and a navigation warning while edits remain unsaved; hidden-page delivery must be best effort.

### 3. [medium] Create-only agents can exhaust shared storage

Section 8.3 limits request frequency but permits indefinite accumulation: one agent can submit roughly 144 MB of Markdown daily before JSON and index overhead. Exhausting the shared disk can stop every user's saves. Add a configurable per-user storage quota covering all agents, enforce it atomically on writes, and return clear quota errors without partially creating notes or tags.

### 4. [medium] Proxy handling can break sign-in rate limits

Sections 5 and 12 require per-IP throttling behind Caddy without defining the trusted client-IP source. Fastify could count every user as Caddy or trust spoofed forwarding headers. Specify Caddy's forwarding-header handling and restrict Fastify proxy trust to the actual proxy connection; add acceptance checks for independent client limits and forged forwarded addresses.

### 5. [medium] MCP acceptance rejects required protocol operations

Section 13.4 says every other MCP operation with an agent token fails, contradicting section 8's interoperable MCP server: clients need initialization and tool discovery before calling create_note. Rewrite 13.4 to permit required protocol lifecycle and discovery operations while forbidding additional application capabilities. Require a named client's complete initialize, list-tools and create-note flow in acceptance testing.

### 6. [medium] Trash and tag disappearance have conflicting lifecycles

Section 7.2 says a tag disappears when no non-Trash note uses it, while section 6.4 permits restoration. Deleting that tag's record or associations would silently strip restored notes of their labels. Specify that disappearance only hides unused tags from active views and autocomplete; retain associations for restoration, define rename behavior across Trash, and garbage-collect only genuinely unreferenced tags.

VERDICT: The architecture suits fewer than ten users, but data preservation, resource limits and protocol/deployment ambiguities need resolution before implementation.
END-OF-REVIEW
