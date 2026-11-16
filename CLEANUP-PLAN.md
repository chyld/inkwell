# Clean-up plan (after the architecture review)

Sixteen reviews in `reviews-arch/` all reached the verdict "needs trimming".
The owner chose the full clean-up, in three passes, each checked with the full
test suite and a real-browser check of anything visual. Behaviour must not
change except where a line below says so. Read the cited reviews for file and
line references; verify each claim in the code before acting on it, and skip
(and report) any that turns out to be wrong.

Do not touch what the reviewers said to keep: the migrations and transaction
discipline, strict note validation, the saver and drafts logic, the server-side
font fetcher, stylesheet parser and URL guard, the token system, and the small
pure modules (route, grid, imageResize, menuPlacement).

## Pass 1: stop the wasted work

1. **Saves** (b01 #1, b15 #2 #4, b02 #1, b10 #4, b12 #3): the save path reads
   only what it needs, passes known values to the search index, checks image
   ownership in one query, sets tags with set-based statements, and does not
   read back what it wrote. The browser stops fetching `/me` after every save:
   the account menu fetches it when opened (keep the refreshes that follow an
   image upload or a delete only if the menu is open).
2. **Per-request cost** (b01 #3, b04 #3 #4, b12 #2): prepared statements are
   created once and reused; the session check is one query that selects only
   the fields used (no password hash on the request); session and
   `X-Notes-User` checks run before the body is parsed.
3. **Typing** (b06 #1, b14 #2, b10 #3, b11 #6, b06 #3): the editor stops
   re-rendering everything on every transaction; toolbar state is read through
   selectors and computed in one pass over the selection; the document is not
   scanned for fonts or written to local storage on every keystroke (debounce
   the draft write with care: a draft must still exist if the tab is closed
   mid-typing, so flush on `visibilitychange`/`pagehide` as the saver does).
4. **Font store** (b15 #3, b04 #1, b05 #1, b08 #5): recording a font does
   work proportional to that font, with full scans only when eviction is
   needed and at start-up. Font files are streamed, not read whole and
   synchronously (b04 #2, b12 #4, b08 #6).
5. **Smaller runtime items**: preview completions re-render only what shows
   them (b05 #3, b08 #4); Empty Trash does not download the whole Trash when
   there are no local drafts (b02 #5); image dragging does not force a layout
   read per pointer move (b06 #4); scoped image clean-up (b15 #5).

## Pass 2: shrink and sweep

1. **Download** (b02 #6, b10 #6, b11 #1 #2 #3, b03 #1 #5, b05 #2, b08 #1):
   the browser gets a compact font list with only the fields it uses; the
   editor, `/fonts` and `/styles` load on demand; `schema.ts` is split so
   constants and the validator do not pull in the editor; the raised size
   warning is removed; the web type check runs in the build. FONTS-SPEC 4.1's
   "one file" rule is kept in spirit: one committed snapshot, with the browser
   form generated from it.
2. **Leftovers** (b15 #6, b02 #2, b10 #5, b06 #5, b14 #3, j1 #4, b01 #6,
   b12 #5 #6, b05 #4): delete the pill-wrap measurement and its tests, the
   sidebar setting, dead exports and test-only members, unreachable handlers;
   rename `Sidebar.tsx` to what it holds.
3. **Stylesheet** (b09 #2 #3 #5, b13 #1 #2 #3 #4 #5): remove the two global
   element rules and the overrides that fight them; one shell for the Fonts
   and Styles pages; one definition of toolbar buttons; the phone block without
   its unneeded `!important`. Splitting the file into layers (b13 #6) and
   generating the size table (b09 #4) are optional: do them only if simple.
4. **What ships** (b03 #2, b11 #4 #5, b04 #6): move `lucide-react` to
   devDependencies, remove the unused MCP adapter, and slim the image's
   `node_modules`. Docker is not available to you: change the files, and the
   lead will build and measure the image.
5. **Three open issues the owner wants fixed here**: (a) colour fonts: accept
   and ignore the extra rule Google sends for colour-capable families
   (DEVIATIONS 31) so those 20 families download; (b) with an image selected,
   clicking the empty space to the right of a short line deselects it; (c)
   text labels on a pressed toolbar button reach 4.5:1 on the slate bar.
6. **Phone toolbar**: at phone width the toolbar is ONE row that scrolls
   sideways inside itself (the page still never scrolls sideways), with a
   visible hint that there is more, instead of wrapping to three rows.

## Pass 3: restructure

1. **Menus** (b14 #1 #4 #6, b06 #2): one shared popover/roving-focus core for
   the font, colour, styles and block menus; one placement system; one size
   stepper.
2. **Editor file** (b14 #5): the toolbar, tag editor and paste transforms move
   out of `NoteEditor.tsx`.
3. **App shell** (b02 #3 #4, b10 #1 #2): one navigation state instead of three
   overlapping ones; the Styles page uses the shared styles store.
4. **Data layer** (b01 #2 #4 #5, b15 #1, b03 #4, b12 #1): split `store.ts` by
   job (identity, notes and search, images, data copy) behind the same public
   behaviour; one place for name and title cleaning; `app.ts` becomes pure
   wiring with no import cycles.
5. **Font loaders** (b08 #2 #3, b03 #3): one request queue shared by the
   preview and face loaders (one limit of 6, one 429 pause); one session class.
6. **Tests** (j1 #1 #5 #6, j2): one shared stylesheet reader; drop pixel and
   colour pins and tombstones for retired schemes, keeping the token, contrast
   and behaviour checks; one signed-in test backend; weak password-hash
   settings in tests with one test pinned to production strength.
7. **Documents** (j1 #2 #3, j2 #6, b03 #6): README describes the app as it is;
   `DEVIATIONS.md` is cut to what is current (superseded rows become one
   line); the lead commits the spec files and takes the review folders out of
   version control.

## Reporting

After each pass: lines added and removed, test totals, what was measured
(statements per save, requests per save, renders per keystroke, bundle sizes),
every item skipped or done differently and why.
