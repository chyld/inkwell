### 1. [high] Images tied to one note are deleted while still in use

Section 6.5 ties an image to one note and deletes it when that note's body stops referencing it. Copy an image into another note and it is deleted under that note, leaving it broken. Change: images belong to the user; delete images older than 24 hours that no body of that user references (Trash included), checked at startup and after each save.

### 2. [medium] Folder deletion contradicts the owner's decision

Section 2 says a folder can be deleted "Only when empty". Section 7.1 allows deletion when it holds Trash notes, which then become unfiled. Change 7.1 to: "A folder can be deleted only if it has no subfolders and no notes at all, Trash included." If the Trash exception is wanted, record it as a changed decision in section 2.

### 3. [medium] Rollback promise does not match the snapshot rule

Section 12 writes `pre-upgrade.db` only when migrations are pending, but README item 6 promises rollback with it. An update without migrations leaves an older snapshot, so rollback loses later notes, and no previous image is kept. Change: snapshot whenever the app version differs from the last start, and tag each image with its version before rebuilding.

### 4. [medium] Acceptance tests miss most decided rules

Section 13 requires automated tests only for items 2-10. Nothing tests session expiry (30 idle days, 90 days), the 60/hour agent limit, the 1 GB quota, folder rules, Trash, the Origin check, the migration-failure path, or the section 9 CLI. Change: add criteria 12-14 covering these and extend criterion 11 to include them.

### 5. [medium] Sign-out and note switching can block indefinitely

Section 6.3 says switching notes or signing out "first waits for the pending save", while failed saves retry every 15 seconds with no end. With the server or network down, the user cannot leave the note or sign out. Change: after the first failure, switching and signing out proceed, the local copy is kept, and a warning says unsaved changes remain on this device.

VERDICT: NOT READY — the image lifecycle and rollback rules would lose user data in ordinary use, and the acceptance criteria leave most decided rules untested.
END-OF-REVIEW
