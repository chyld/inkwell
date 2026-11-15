# Code re-review b08: round-2 fix commit and SPEC 8 focus area

Scope checked: commits `ad7410b` and `b45f617`, `src/server/mcp.ts`, `src/server/markdown.ts`, `src/shared/schema.ts`, `src/server/store.ts`, `src/server/api.ts`, `src/server/db.ts`, `src/server/images.ts`, `src/cli/notes.ts`, and tests in `test/mcp.test.ts`, `test/markdown.test.ts`, `test/sessions.test.ts`, `test/images.test.ts`, `test/db.test.ts`, `test/cli.test.ts`, `test/logs.test.ts`, `test/roundtrip.test.ts`.

Verified:
- **Last two commits (`b45f617`, `ad7410b`) & SPEC 8**: Nothing weakened `/mcp`, agent tokens, the Markdown converter, or the agent rate limit (`b45f617` strengthened `markdown.ts` with `MAX_TABLE_CELLS` and `schema.ts` with `Object.hasOwn`; `ad7410b` left them untouched). `/mcp` enforces `Origin` 403, `POST`-only 405, Bearer-only 401, 1 MiB body limit, allowed JSON-RPC methods, and stateless JSON responses; `createAgentNote` checks revocation, disabled user, `agent_calls` rate limit, quota, FTS5, and tags inside one `BEGIN IMMEDIATE` transaction.
- **R8 (`not a defect`)**: Correct. While disabled, `createSessionIfUnchanged` (`src/server/store.ts:313-319`) rejects session creation and `setDisabled` deletes all existing sessions; only after re-enabling with the same password can a session be created, which matches the account's live state.
- **Rewritten lock test (R2)**: `test/images.test.ts:240-273` genuinely proves what matters without blocking live writes: `dataCopy` writes a marker in `copy-locks`, closes the race with an empty `BEGIN IMMEDIATE; COMMIT`, and mid-copy `cleanupImages()` checks `copyInProgress()` inside its `BEGIN IMMEDIATE` transaction (postponing deletion so the snapshot's image survives), while a concurrent write with `busy_timeout = 0` succeeds.
- **Round-2 server fixes (R1, R3–R5, R10)**: All verified in code and tests (`IMAGE_CSP` before 304, retry after 1 s on missing image files, `fsyncPath` on file then directory, `MigrationError` on `BEGIN IMMEDIATE` failure, `deletedIds` returned by `DELETE /api/trash`), with no regressions found.

Findings: none.

VERDICT: SHIP — No defects or regressions were found in the round-2 fix commit or the `/mcp`, agent token, Markdown converter, and agent rate-limit paths, and both the R8 verdict and the rewritten `data copy` clean-up test check out.
END-OF-REVIEW
