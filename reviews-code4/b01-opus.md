# Review of 1e0cbdc (round-3 fix pass)

### 1. [medium] A wrong_user 401 clears the header, so the stale tab's next upload goes through as the other user
Where: src/web/App.tsx:25
Alice drops several images in her stale tab. The first POST /images gets wrong_user, and the handler calls setMe(null), which clears expectedUser at once. The batch loop goes on to the next file before React unmounts the editor (`closed` is still false and uploadEpoch is unchanged), so that request is sent without X-Notes-User and the server stores it in Bob's account and quota. Fix: on a 401, keep sending the old user id (clear it only at sign-in or a confirmed sign-out) and call cancelUploads().

VERDICT: SHIP AFTER FIXES. The server check covers every authenticated /api route, including uploads, Empty Trash and sign-out, and the other seven Round 3 fixes hold with genuine tests, but the client stops sending the header on the first refusal, so a multi-file upload can still bypass the check.
END-OF-REVIEW
