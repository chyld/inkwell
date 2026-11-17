# Bug fix list 2: leftovers found by the review of the fixes

Three reviewers checked commits bf8b023..57e1b88 (the fixes for BUGFIX-LIST.md). Their reviews are in
`reviews-fixes/` (b01-opus, b04-sol, b08-gemini). These are their findings, merged. Items marked (confirmed) were
checked in the code by the lead; the others are the reviewers' traces. Verify each before fixing; if one is wrong,
say so and why instead of changing code.

## Worth fixing

1. (confirmed) **The lazy-chunk error screen is invisible on phones for Fonts and Styles.** `ScreenError.tsx:30`
   renders `.editor-pane.empty.screen-error`, but at 760px or less `styles.css` (~2273-2288) shows only `.fonts-page`
   / `.styles-page` in those screen states. Message and Reload button are hidden. (Original item 2.)
2. **Several images dropped at the end of a paragraph still land in reverse order.** `components/images.tsx:67-86`:
   the image is a block, so `insertContentAt` puts it after `</p>`, beyond `pos`; the mapping leaves `pos` unchanged
   and each later image lands before the previous one. The test only covers a boundary between paragraphs.
   (Original item 21.)
3. (confirmed) **Two tabs on one note: a tab that does not own the stored draft writes no draft at all, yet the app
   says its changes are "kept on this device".** `saver.ts:146` and the dispose/pagehide paths; messages at
   `App.tsx:234` and `saver.ts:229`. Tab A holds the draft after a conflict; tab B goes offline, the user types and
   leaves the note; B's edits are gone. Either keep B's work (for example a draft per owner) or make the messages
   true. Prefer keeping the work. (Original item 8.)

## Minor

4. (confirmed) **A new note can be listed in a tag view.** `App.tsx:369-370`: the insert tests the captured `ctx` and
   runs before `superseded(nav)`. Click New in All notes, switch to a tag before the POST returns. Two reviewers.
   (Original item 20.)
5. **Wrong address after cancelling a Back navigation from the rail.** `App.tsx:326-328`: open B then A, edit A with
   a slow save, press Back, then All notes before the save ends. `startNav()` cancels B's select, `changeView()` keeps
   A but does not put A's address back. (Original item 4.)
6. **A new session joins a font request that reset invalidated.** `fonts/runtime.ts:195` (ensure at 140-143, epoch
   check 177, FontSession 244): reset keeps the old `pending` entry; after sign-out and sign-in, the same family
   joins it, resolves false and stays on the fallback until the note is reopened. (Original item 11.)
7. **Empty Trash brings back a draft for a note it just deleted.** `App.tsx:493` with `trash.ts:28`: drafts are
   removed, then `setSelected(null)` unmounts the editor and the new `dispose()` (`saver.ts:313`) writes the pending
   draft again. Close the editor before removing the drafts. (Original item 9.)
8. **StyleForm opened from the Styles menu loses focus on close.** `StylesMenu.tsx:128`: `close(false)` before
   `setForm(...)`, so the modal records a menu item that is then unmounted. `folders.tsx` does it the right way.
   (Original item 16.)
9. **Shift+Tab in a folder menu, then Escape, closes the whole Folders panel.** `folders.tsx:184-210`: focus returns
   to the Actions button inside `menuRef`, the menu stays open, and Escape reaches `Rail.tsx:63`. (Original item 17.)

## Also

10. Original items 2, 5 and 6 (the missing-chunk screen and the two "unsaveable note" edits) were not reviewed by
    anyone for correctness beyond the phone problem above. Re-read your own fixes for those three with a reviewer's
    eye and report what you find.
