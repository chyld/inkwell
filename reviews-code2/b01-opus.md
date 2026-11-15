# Code re-review b01 (opus): user isolation and authorization

Scope: SPEC 11 isolation across every `/api` route, `/mcp` and the shared
store, plus RESPONSE.md rows in that area (#2, #7, #20; #14 checked as well).

Verified as correct:
- #7 is fixed. `getImage` is scoped to `id AND user_id` and runs before the
  ETag check (`src/server/images.ts:112-118`), so only the owner can get a 304.
  Anyone else gets 404, and a request with no session gets 401. The test fails
  on the old code, because it asserts `no-cache` and rejects `immutable`/`max-age`.
- #2 is fixed. `createSessionIfUnchanged` re-reads the user inside a
  `BEGIN IMMEDIATE` transaction and compares the hash and the disabled flag.
  The CLI's password and disable changes delete sessions in their own
  transactions, so either ordering ends with no live session. Both tests spy on
  `crypto.argon2` through a property lookup, so the delay works and the tests
  fail without the fix.
- #20 is fixed. `n.user_id = ?` is still applied, and the unfiled filter is
  added before `LIMIT 50`. The test would fail on the old code.
- #14 "not a defect" is correct. The only way to set `parent_id`/`folder_id` is
  through `ownFolder`, which is scoped to the user, and both columns have FKs.
- Every note, folder, tag, search, image and agent query in `store.ts` filters
  on the user's id, or reaches rows only through an id that was already checked
  to belong to that user. Another user's ids give the same 404/400 as ids that
  do not exist. The fix commit introduced no new path across users.

### 1. [low] An image 304 carries the page CSP, which overwrites the cached image's sandbox CSP
Where: src/server/images.ts:118
The 304 returns before `IMAGE_CSP` is set, so the `onSend` hook
(`src/server/app.ts:73`) adds `PAGE_CSP`. Browsers merge a 304's headers into
the stored response (RFC 9111 §4.3.4). After the owner's first revalidation,
the cached image therefore carries the page CSP instead of SPEC 6.5's
`default-src 'none'; sandbox`, and opening it directly loses the sandbox.
Fix: set `IMAGE_CSP` together with the ETag, before the 304 return. Assert it
in the test.

VERDICT: SHIP. Isolation holds on every route and in every data-access function, the items in this area are really fixed with tests that fail without the fixes, and the one leftover is a one-line header fix.
END-OF-REVIEW
