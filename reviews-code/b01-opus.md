# Code review b01 (focus: user isolation and authorization)

Scope checked: every route in `src/server/api.ts` and `src/server/images.ts`, every
data-access method in `src/server/store.ts` they reach, the `/mcp` auth path in
`src/server/mcp.ts`, the schema's image-id extraction, and `test/isolation.test.ts`.
Every read and write takes `userId` from the session (or the agent row), and every
note, folder, parent-folder and image id is resolved with `... AND user_id = ?` before
anything changes (`ownNote`, `ownFolder`, `getImage`, `assertImagesOwned`). Another
user's id returns the same 404 as a missing id. I found no isolation hole.

### 1. [medium] Concurrent sign-in attempts get around the failed-sign-in limit
Where: src/server/api.ts:44
`isBlocked` is checked before `await store.checkCredentials` (async Argon2, about
100 ms), and `recordFailure` runs only after it. If someone sends 500 concurrent
`POST /api/session` requests for one username and IP, all 500 pass `isBlocked`
before any failure is recorded. The SPEC 5 limits then do nothing against parallel
guessing. Fix: record the attempt before the await and remove it on success, or
refuse a key while an attempt is in flight.

VERDICT: SHIP AFTER FIXES. Isolation holds everywhere I checked, but the sign-in limiter has to count attempts that are still in flight, or anyone can run a parallel password-guessing attack.
END-OF-REVIEW
