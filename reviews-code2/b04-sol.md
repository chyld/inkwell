### 1. [high] Queued uploads cross accounts after sign-out
Where: src/web/components/images.tsx:67
Drop two images as Alice, stall the first beyond the three-second sign-out wait, sign out, then sign in as Bob before releasing it. The batch continues after unmount and posts the second file with Bob's cookie, storing Alice's image under Bob's ownership. The destroyed-editor check happens after POST; the upload tests use single files. Cancel batches on sign-out/unmount and check cancellation before each upload.

### 2. [medium] An old 401 hides a newer live session
Where: src/web/api.ts:42
Let Alice's expired session produce two 401 responses; deliver one to show Sign in, then sign in as Bob before delivering the other. The unconditional unauthorizedHandler clears Bob's UI without deleting his cookie or session. Reloading exposes Bob's notes despite the sign-in screen. Saver disposal cannot suppress this earlier API side effect. Bind requests to an authentication generation and ignore obsolete authentication failures.

VERDICT: DO NOT SHIP — Pending browser work can transfer images between accounts and hide an active session behind the sign-in screen.
END-OF-REVIEW
