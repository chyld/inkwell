### 1. [medium] A second tab's sign-in sends a stale tab's writes into the other account
Where: src/web/api.ts:24
The auth and upload epochs live in one tab's memory; the server sees only the shared cookie. Alice leaves a tab open. In a second tab, Alice is signed out and Bob signs in. Alice's old tab gets no 401: her queued uploads, and any "New note" made in All notes plus its edits, are saved to Bob's account. Fix: send the expected user id and reject a mismatch with 401.

VERDICT: SHIP AFTER FIXES — The R6, R7 and R9 fixes are complete within a tab, and their tests fail without them. R8's "not a defect" verdict is correct. The rewritten lock test still proves that a clean-up during a copy keeps the copy's images. Every API route and store function is scoped by user, but a stale second tab can still write into another user's account.
END-OF-REVIEW
