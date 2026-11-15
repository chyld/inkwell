# Round 3 code review: b02-sonnet (focus: sign-in, sessions, rate limit, Origin, proxy, headers, image 304, logging)

No findings. What I checked by reading, with the result:

- R1 (image 304 CSP): `src/server/images.ts:129-133` sets `IMAGE_CSP` before the 304 return. The `onSend` hook in `app.ts` only adds `PAGE_CSP` when none is set, so the sandbox CSP survives. The test asserts the exact 304 header value and would fail without the fix, because `PAGE_CSP` would be sent instead. Other users still get 404 before any 304, because `getImage` is scoped to the user.
- R7 (stale 401): the epoch is captured at request start (`src/web/api.ts:24`) and bumped at sign-in and after confirmed sign-out. Only `api()` calls the handler and all web requests go through it. The test fails without the fix. A 401 under the current epoch still shows the sign-in page.
- R15 (Caddy error log): the global `log default` block deletes the same fields as the site log and strips the query string. The Caddyfile test fails if the block is removed. This only covers 4xx/5xx request errors. TLS handshake lines contain an address, but they are not request logs under SPEC 11.
- R5 (migrate lock): `BEGIN IMMEDIATE` is now wrapped, and the test fails without the wrap (it would throw a raw SqliteError, not `MigrationError`).
- R8 (not a defect): I agree. `createSessionIfUnchanged` re-reads the user in one transaction and compares `disabled` and `password_hash`. A password change, even back to the same password, gives a new salted hash, so it is detected. A delete and re-create gives a new id, so it is detected too. A disable then re-enable with the same password leaves an account that would accept that sign-in anyway.
- Rewritten lock test (R2): it now runs a real permanent delete, which triggers clean-up, inside `afterSnapshot` and asserts the image file is in the copy. Without the marker check inside the clean-up transaction, the file would be unlinked and the copy would fail as "missing", so it still proves what the lock was for. Ordering (marker, then empty write transaction, then snapshot) closes the race.
- Unchanged and still correct: rate limiter (pending reservations, username normalised, keyed per pair and per IP), the Origin hook (configured origin, covers POST/PUT/PATCH/DELETE under `/api` including sign-in and sign-out), `trustProxy` limited to the Compose subnet with Caddy overwriting `X-Forwarded-For`, session expiry and refresh, and the app log fields.

VERDICT: SHIP, because every round-2 fix in my focus area is real and tested, the R8 verdict is right, and I found no regression or remaining defect that a user or the owner could plausibly hit.
END-OF-REVIEW
