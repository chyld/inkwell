### 1. [low] A concurrent image upload makes `data copy` fail wholesale with misleading advice
Where: src/server/images.ts:96-100

The upload commits its `images` row (`insertImageRow`) and only then renames the file into place. If `docker compose exec app notes data copy` runs while an upload sits in that window, the copy's snapshot already contains the row but `existsSync(dest)` is false, so the whole copy aborts with "image file(s) are missing … Restart the app once" — though nothing is broken and the file appears a moment later. Verified: no lock covers commit→rename, and the copy's reader reads the last committed state. Fail-safe (nothing partial, retry works). Fix: re-check the `missing` list after the first pass, or link the still-in-tmp file for rows newer than the snapshot.

VERDICT: SHIP — every focus-area row in RESPONSE.md verifies as really and completely fixed with tests that genuinely fail without the fix (sign-in reservations, unchanged-password session guard, synchronous=FULL, snapshot under the write lock, data-copy locking/missing-file behaviour, Caddy log filter — valid against Caddy's documented filter encoder — and server-side Unfiled narrowing before the 50-limit), the "not a defect" verdicts hold, the CLI matches SPEC 9 and the README/Dockerfile/compose match SPEC 12; the only residual defect is the minor, fail-safe copy race above.
END-OF-REVIEW
