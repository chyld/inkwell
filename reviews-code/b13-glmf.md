### 1. [low] `data copy` can crash mid-copy in a race with the image clean-up
Where: src/server/store.ts:936-940

`dataCopy` takes the image list from the VACUUM copy, then per image does `existsSync` + `copyFileSync`. A concurrent `cleanupImages` (24-hour timer in main.ts:44, or a `DELETE /api/trash` from another session) can delete row and file between the two calls, so `copyFileSync` throws ENOENT and the CLI exits non-zero, leaving a partial target directory that a retry with the same `<dir>` then refuses (409). Nothing on the server is damaged. Fix: copy to a temp name and rename, or catch ENOENT per file and skip.

VERDICT: SHIP — search and FTS5 query building/index maintenance match SPEC 7.3 exactly (including hostile inputs like `"`, `(`, `*`, `C++`, verified against real FTS5 behavior), the CLI implements section 9 faithfully, and the only defect found is this minor, non-destructive race in `data copy`.
END-OF-REVIEW
