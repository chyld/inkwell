### 1. [medium] Pending image uploads still bypass the page-close safeguard
Where: src/web/App.tsx:189

Start a slow image upload, then close or reload before it completes. `beforeunload` checks only `activeSaver.hasUnconfirmed()`, which remains false until the response inserts the image, so no leave warning appears and the image is never added. The new test merely destroys an editor while remaining on the page. Include pending uploads in the unload condition and test that path.

VERDICT: SHIP AFTER FIXES, because RESPONSE row 17 remains incomplete for actual browser close/reload during an upload.
END-OF-REVIEW