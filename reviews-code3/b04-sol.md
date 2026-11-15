### 1. [high] Cross-tab account changes bypass mutation isolation
Where: src/web/api.ts:27
Leave Alice's Empty Trash confirmation open in tab A; sign out and sign in as Bob in tab B, then confirm in A. DELETE /trash uses Bob's shared cookie and permanently deletes Bob's notes. Tab-local epochs also let Alice's queued uploads enter Bob's account. Bind mutations to the initiating account and invalidate work across tabs; the upload test only calls cancelUploads within one tab.

VERDICT: DO NOT SHIP — Cross-tab account changes can transfer private uploads and permanently delete another account's notes.
END-OF-REVIEW
