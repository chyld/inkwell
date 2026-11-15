### 1. [high] Clearing the user guard lets stale actions enter another account
Where: src/web/App.tsx:20
After Bob signs in in another tab, type in Alice's stale editor and immediately click New note in All notes. The flush gets wrong_user, clearing expectedUser; newNote still resumes without a header, creates a note for Bob, then refreshMe opens Bob's account in Alice's tab. The isolated header tests miss this. Bind requests to the initiating user and cancel continuations when authentication changes; test this App-level sequence.

VERDICT: DO NOT SHIP — A stale tab can still write to and open another user's account despite the cross-tab guard.
END-OF-REVIEW
