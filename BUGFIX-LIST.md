# Bug review findings to fix

From the bug review in `reviews-bugs/` (13 reviews). Verify each in the code
first; if a claim is wrong, say why and skip it. Every fix gets a regression
test that fails without it. Behaviour outside these items must not change.

## Reported by several reviewers

1. **Another user's styles show after sign-out** (10 reviewers; b01, b04 #1,
   b05 #1, b06 #1, b08 #1, b10 #2, b11 #1, b13 #1, b14 #2, b15 #1).
   `stylesStore.ts` keeps its list for the life of the page. Clear it at
   sign-out, on session loss and at sign-in; ignore answers that belong to an
   earlier session; never keep a stale list when a refresh fails for a new user.
2. **A lazily loaded chunk that fails to load blanks the whole app** (7; b02
   #3, b04 #3, b06 #4, b09 #3, b10 #1, b11 #3, b15 #2). Add an error boundary
   around the lazy screens with a clear message and a working Reload, keeping
   the address and any pending draft; handle `vite:preloadError`; and the
   server answers a missing `/assets/…` file with 404, not `index.html`, and
   never marks a miss immutable.
3. **Tags are silently lost** when several are pasted or entered quickly (5;
   b02 #4, b04 #2, b09 #2, b11 #2, b14 #1). One change builds the whole new
   list and sends one request; changes made while a request is in flight are
   applied to the latest list, in order.
4. **Navigation that finishes late overrides a later one** (3; b04 #4, b06 #5,
   b10 #3). Each navigation carries a sequence number and a superseded one
   stops after every wait, so the screen always matches the address.

## Notes that become unsaveable (b02 #1, #2)

5. "Row above" on a table's header row, or pasting header cells into a lower
   row, leaves header cells below row one, which the server refuses on every
   save. Keep the document valid: header cells below the first row become
   plain cells (in the editor, as a rule applied to every change).
6. Pasting a link from a web page that carries `class` or a `target` other
   than `_blank` produces a link the server refuses. Strip those when the link
   is read from pasted HTML.
   For both: add a test that every document the editor can produce from these
   actions passes `validateBody`.

## Drafts and unsaved work

7. **Continuous typing leaves no recent draft** (b05 #3): since pass 1 the
   draft is written with the first change and with each send. Write it at
   least every 2 seconds while there are unsaved changes, without bringing
   back a write per keystroke.
8. **Another tab's save destroys this tab's draft** (b06 #2): two tabs on one
   note share one draft key. A tab only overwrites or deletes a draft it wrote.
9. **Empty Trash drops edits in a conflicted note that is still open**
   (b06 #3): every path that disposes a saver first persists its pending draft.

## Fonts

10. **A broken upstream can fill the disk** (b05 #2): bound the number of
    files (for example 16) and their total size (for example 8 MB) for one
    operation while downloading, before anything is kept.
11. **Requests in flight at sign-out still register faces** (b08 #2): an epoch
    increased by `reset()`; stale completions are dropped.
12. **Failed previews retry at once** when the rendered set changes (b08 #3).
13. **Font size and font menu touch unselected table cells** (b08 #4): walk
    `selection.ranges`, as `styleApply.ts` does.
14. **The 429 pause can stall** if its timer fires early (b08 #5): reschedule
    while still paused.
15. **A failed collection fetch shows "No fonts yet"** (b13 #2): show a notice
    and keep the previous list.

## Interface

16. **Dialogs lose keyboard focus** (b09 #1): focus the dialog on open, keep
    Tab inside it, return focus to what opened it on close.
17. **The folder actions menu ignores Escape** (b09 #4): Escape closes it and
    returns focus; arrow keys move between its items.
18. **Holding the New note shortcut, or double-clicking New, creates several
    notes** (b10 #4): ignore key repeat and guard while one is being created.
19. **A failed folders or tags fetch is dropped silently** (b11 #4): show a
    notice and retry.
20. **A new note is listed in a tag view it does not belong to** (b11 #5).
21. **Several images dropped at once land in reverse order** (b02 #5).

## Documents

22. **README section 8 uses the username `me`**, which the app refuses as too
    short (b03): use a valid name.
