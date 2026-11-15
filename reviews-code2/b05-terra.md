### 1. [high] Disable and re-enable can let an old sign-in finish
Where: src/server/store.ts:316
Start a valid sign-in, then disable and re-enable the account while Argon2 is running. The final check sees the original hash and an enabled account, so it creates a session after the disable deleted sessions. The named test leaves the account disabled and misses this sequence. Increment a persistent authentication generation on disable and compare it atomically when creating the session.

VERDICT: SHIP AFTER FIXES — In-flight authentication can survive an account disable and re-enable.
END-OF-REVIEW
