### 1. [medium] An unclaimed local draft is overwritten and then deleted
Where: src/web/components/NoteEditor.tsx:168

Open a note that has a stored draft: the banner offers Restore or Discard. Typing in the title or body calls NoteSaver.change(), which overwrites `draft:<user>:<note>` with the server-derived content (saver.ts:87); a second later the autosave confirms and deletes the key. Reload before choosing and the unsaved draft is gone. Fix: leave the stored draft untouched until the user answers.

### 2. [medium] Search in the Unfiled view silently drops matches
Where: src/web/App.tsx:96

In the Unfiled view loadList sends no folder filter and then keeps only results whose `folderId` is null. The server returns at most 50 matches overall (store.ts:796), so when 50 or more matching notes sit in folders, a matching unfiled note is missing and the list says "No notes match your search". Fix: narrow server-side, e.g. `folderId: null` meaning unfiled.

### 3. [low] Attribute allow-list reads the prototype chain, so a bad body gives 500
Where: src/shared/schema.ts:166

`checkAttrs` reads `allowed[k]` from a plain object, so inherited names pass the allow-list. A save whose body has `attrs: {"valueOf":1}` (or `hasOwnProperty`, `isPrototypeOf`) calls `Object.prototype.valueOf` with `this` undefined, throwing a TypeError outside `validateBody`'s try block; the API answers 500 and logs a stack instead of the required 400. Fix: `Object.hasOwn(allowed, k)` or null-prototype maps.

### 4. [low] A revoked agent's name cannot be reused, contrary to the README
Where: src/server/store.ts:328

README section 4 says that if a token is lost, "revoke the agent and add a new one". `addAgent` rejects any existing row with that name, revoked or not, so `notes agent revoke alice "Claude Code"` then `notes agent add alice "Claude Code"` fails with 409 and the operator must invent a name. Fix: let a revoked name be reused (replace the row, or drop it from the unique index), or correct the README.

VERDICT: SHIP AFTER FIXES — the search/FTS query building and the CLI match SPEC 7.3 and 9 closely, but the silent draft loss and the unfiled search gap should be fixed before hand-over.
END-OF-REVIEW
