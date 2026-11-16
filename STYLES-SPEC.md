# Text styles: specification (draft 2)

An addition to the notes app described in `SPEC.md` and `FONTS-SPEC.md`. Where
this document is silent, those and `DEVIATIONS.md` apply. Where they disagree,
this document wins, because the owner decided it later.

The beta team's advice on the design is in `reviews-styles/`. Draft 2 answers
their 14 reviews of draft 1 in `reviews-styles-spec/`.

## 1. Summary

A style is a named bundle of text formatting: font, size, bold, italic,
underline, strikethrough, text colour and highlight. A user creates styles,
sees them all on a page at `/styles`, and applies one to text in any note with
one choice from a menu. Each user has their own private styles.

## 2. Owner decisions (final; reviewers should not reopen these)

1. A style has a name and defines all eight settings: font family, font size,
   bold, italic, underline, strikethrough, text colour and highlight. There is
   no "leave this setting alone".
2. **Stamp, not linked.** Applying a style sets those eight things on the text
   at that moment. The text keeps no record of the style. Editing or deleting
   a style later changes no note.
3. Each user has their own styles. One user's styles are invisible to every
   other user.
4. There is a page at `/styles` showing all the user's styles and their
   settings as a grid of cards.
5. Styles can be reused in any of the user's notes.

## 3. Out of scope

- Linked styles, and any way to find or update text that a style was applied to.
- Styles that set only some of the eight settings.
- Paragraph-level styles (headings, lists, alignment, spacing).
- Reordering styles, keyboard shortcuts for styles, sharing, import, export.
- Styles for agents: the `create_note` tool and the Markdown converter are
  unchanged.
- **Any change to the note schema.** A note stores only the marks it stores
  today, with the attributes, exclusions and accepted values it has today.

## 4. What a style is

| Field | Values |
|---|---|
| `id` | A UUID the server assigns. Never changes. |
| `name` | Stored trimmed, with its capitalisation kept. 1 to 50 Unicode code points; no control characters (Unicode category Cc). |
| `font` | A font catalogue id, or `null` for the default font (Inter). |
| `size` | A whole number from 8 to 96. |
| `bold`, `italic`, `underline`, `strike` | `true` or `false`. |
| `textColor` | One of the eight text colour names, or `null` for the normal text colour. |
| `highlight` | One of the eight highlight names, or `null` for none. |

- The colour names and the size range are the constants in
  `src/shared/schema.ts`, and the font id check is the one in
  `src/shared/fonts.ts`; styles use those same constants and checks, so a
  style can never hold a value a note could not.
- **Name key.** Two names are the same when their trimmed, lower-cased forms
  (JavaScript `toLowerCase()`, the rule folders already use) are equal. A
  user's styles have unique name keys. Lists are ordered by name key, then id.
- A user has at most 50 styles.

## 5. Applying a style

"Matching the style" below means the eight marks. Appearance that comes from
the block or from a link (a heading's own weight, a link's underline) is not
part of it and stays.

### 5.1 With a selection

Every piece of selected text ends up with exactly the style's marks:

- `font`: the `fontFamily` mark with that id, or no `fontFamily` mark when the
  style says `null`.
- `size`: the `fontSize` mark with that size, except that text whose block
  default equals the size gets no `fontSize` mark. The block default is
  `defaultSizeOf` in `src/shared/schema.ts`: the heading's own size in a
  heading, 16 in every other block. It is decided per piece of text, by the
  block that piece is in.
- `bold`, `italic`, `underline`, `strike`: the mark is present when `true` and
  absent when `false`.
- `textColor`, `highlight`: the mark with that colour, or absent when `null`.

Rules:

- It is done as one transaction: for each affected mark type the existing
  mark is removed from the text and the style's value, if any, added, so text
  that had a different font, size or colour ends with one value, not two.
- It covers exactly the selected ranges. A selection of table cells affects
  only those cells.
- Text that is inline code or in a code block is left exactly as it is. Link
  marks, and the note's structure, are untouched.
- The step is its own entry in the undo history (the history is closed before
  it), so one Undo reverses the style and nothing else, even right after
  typing.
- If the result would hold more than 50 distinct fonts, counted on the note
  as it would be afterwards, nothing is applied and the existing notice "A
  note can use at most 50 fonts." shows.
- Afterwards the text is ordinary formatted text. Every toolbar control works
  on it as usual.

### 5.2 With no selection

Choosing a style sets the formatting for what is typed next, and never changes
existing text. The marks for the next typed text become: the marks currently
in effect at the cursor (the stored marks if there are any, otherwise the
marks at the cursor), with the eight style mark types taken out and the
style's marks put in, the size by the block rule above. Other marks, such as
a link, stay. This is not an undo entry of its own.

The 50-font check applies here too: if the style's font is not already in the
note and the note has 50 fonts, nothing happens and the notice shows.

### 5.3 When the menu is disabled

The Styles button is disabled when the cursor is in inline code or a code
block, and when a selection contains no text that can take marks.

## 6. API

All routes are under `/api/styles`, require a session, and follow the existing
rules: on a change the Origin is checked first (403), then the session and
`X-Notes-User` (401). Every answer from these routes, errors and those early
refusals included, has `Cache-Control: private, no-store`.

| Route | Result |
|---|---|
| `GET /` | The user's styles in order, each with all the fields of section 4. |
| `POST /` | Create from `name` and the eight settings. 201 with the style. |
| `PUT /:id` | Replace `name` and the eight settings. 200 with the style. |
| `DELETE /:id` | Delete the user's style with that id. 200 `{ "ok": true }`. |

- The name and all eight settings are required on create and on replace. A
  missing, extra or invalid field is 400 with a message naming the field.
- `font` must be `null` or an id in the font catalogue snapshot, retired
  families included. The user's font collection is not consulted, as it is
  not for notes; so a style can be saved from text whose font has left the
  collection, and stays editable afterwards.
- 409 `name_taken` ("You already have a style with that name.") when another
  of the user's styles has the same name key. Renaming a style to a different
  capitalisation of its own name is allowed.
- 409 `styles_full` ("You can keep at most 50 styles. Delete one to add
  another.") on the 51st.
- The name check, the count check and the write happen in one `BEGIN
  IMMEDIATE` transaction, backed by a unique index on user and name key, so
  parallel requests can never leave two styles with one name or more than 50.
- Every route sees only the signed-in user's styles. `PUT` to an id that does
  not exist or is another user's is 404. `DELETE` of such an id deletes
  nothing and still answers 200.
- Deleting a user deletes their styles. `notes data copy` includes them.
- Two tabs editing the same style: the last save wins. No versioning.

## 7. The style form

One dialog is used everywhere a style is created or edited. Its controls hold
plain values until Save; they are not the toolbar's controls, which act on the
editor, though they look and behave the same.

- **Name**: a text field.
- **Font**: a menu with "Inter" first (meaning `null`), then the user's font
  collection, each family name drawn in its own font through the existing
  preview loader, as in the editor's font menu. If the form's current font is
  not in the collection (it was removed or retired, or came from "Save
  selection as style…"), it is listed too, so the form never holds a value
  its menu lacks. A link "Browse fonts…" goes to `/fonts`.
- **Size**: − / number / +, 8 to 96. A typed whole number in range takes
  effect as it is typed; anything else puts the last good value back when the
  field loses focus. Save always uses the value shown.
- **Bold, Italic, Underline, Strikethrough**: four toggle buttons.
- **Text colour**: the eight swatches and "None".
- **Highlight**: the eight swatches and "None".
- **Preview**: the sentence "The quick brown fox jumps over the lazy dog"
  drawn with the current settings at their real size, updating as they
  change. It wraps, and its box is at most 160 px tall and scrolls beyond
  that, so a 96 px style does not push the buttons off a phone screen.
- **Save** and **Cancel**. On an error the dialog stays open: `name_taken`
  and a bad name show under Name; `styles_full` and anything else show on one
  line above the buttons.

A new style starts as Inter, 16, nothing on, no colours. Keyboard and
accessibility behaviour matches the app's other dialogs and menus.

## 8. In the editor

- The toolbar gains a **Styles** menu button as its first item, before the
  font menu. The button always reads "Styles": text does not remember a style,
  so there is no current style to show.
- The menu lists the user's styles in order, each name drawn as a sample
  (section 10) with the size capped at 20 px. Choosing one applies it
  (section 5).
- Below the list, after a separator: **Save selection as style…** and
  **Manage styles…** (goes to `/styles`, saving the note first as any
  navigation does).
- With no styles, the menu shows "No styles yet" above those two entries.
- **Save selection as style…** opens the form filled in from one piece of
  text: with a selection, the first text in it in document order, whichever
  way the selection was dragged; with no selection, the formatting in effect
  at the cursor (the same marks as 5.2 starts from). From that text come its
  font or Inter, its size (its `fontSize` mark, otherwise its block's
  default), which of the four toggles are on, and its colours. The name is
  empty. Saving creates the style and does not change the note. The entry
  follows the rule of 5.3.
- The menu's keyboard behaviour matches the font menu.

## 9. The `/styles` page

- Address `/styles` (and `/styles/`), a route in the web app that behaves as
  `/fonts` does: a "Styles" entry in the sidebar, marked as current while the
  page shows; opening it saves and closes the open note; choosing anything
  else in the sidebar leaves it; a direct visit puts `/` beneath it in
  history, so Back leads to the notes with no note open; reload stays; signed
  out, the sign-in page shows first; the tab title is "Styles – Notes". On a
  wide screen it takes the place of the note list and editor; on a phone it
  is one screen with a Back control.
- **Header**: "Styles", the count "8 of 50" (announced to screen readers when
  it changes), and a **New style** button that opens the form. At 50 the
  button stays focusable, is marked `aria-disabled`, does nothing, and the
  text "You can keep at most 50 styles. Delete one to add another." shows
  beside it.
- **Grid of cards**, in order, with `role="list"` and each card a
  `role="listitem"`. Each card shows:
  - the style's name as a sample (section 10) with the size capped at 28 px;
    a long name is cut with an ellipsis;
  - chips, in this order: the font's family name ("Inter" when `null`),
    always; the real size as "22 px", always; "Bold", "Italic", "Underline",
    "Strikethrough", each only when on; the text colour as a dot of that
    colour and its name with a capital, only when set; the highlight as a
    swatch of that colour and its name followed by "highlight", only when set;
  - buttons **Edit** and **Delete**, with the accessible names "Edit <name>"
    and "Delete <name>".
- **Delete** asks first, with the app's existing confirm dialog: title
  "Delete “<name>”?", message "Text you already styled keeps its formatting.",
  confirm button "Delete".
- **Empty state**: the heading "No styles yet"; the line "A style is a saved
  set of text formatting you can apply with one click."; the **New style**
  button; and the line "You can also select text in a note and choose Save
  selection as style."
- Changes appear at once and survive a reload. Another user sees none of them.
- At 390 px wide the grid is one column and nothing scrolls sideways.

## 10. Drawing a sample in a style

A sample is a piece of text drawn with a style's settings outside the editor:
a style name on a card or in the menu, or the form's preview sentence.

- **Markup.** A sample is built from the same elements the editor produces,
  nested: `span[data-font]`, `span[data-font-size]`, `span[data-text-color]`,
  `mark[data-highlight]`, and `strong`, `em`, `u`, `s`. It sits in a container
  that gives those elements the rules they have in a note. Nothing uses an
  inline style.
- **Size caps.** Where a cap applies, the sample's `data-font-size` carries
  the smaller of the style's size and the cap. The form's preview uses the
  real size.
- **Fonts.** Samples are arbitrary text, so they need a font's real files,
  not the name-only preview files of `FONTS-SPEC.md` section 5.1. They use
  the note-face mechanism of `FONTS-SPEC.md` section 8.3 (`/api/fonts/faces/:id`,
  `nf-<id>` faces registered without `load()`, the generated `[data-font]`
  rule), through one app-wide loader shared with open notes:
  - at most 6 `/faces` requests are in flight in total, across the open note
    and all samples; requests for the same id are joined;
  - fonts asked for by samples do not count toward a note's own limit of 50;
  - an id is asked for once each time a card page, a menu or the form is
    opened or its font changes; a failed id is tried again the next time, not
    before; a 429 pauses the loader until the time given;
  - until a font is ready, and if it fails, the sample shows in the fallback
    font; everything registered is removed at sign-out, as today.
- A style's font that can no longer be loaded (retired and evicted, or Google
  unreachable) leaves the style fully usable: it can be edited and applied,
  and text shows in the fallback font, as in notes.
- Colours come from the existing theme tokens, so text colour and highlight
  look right in light and dark.

## 11. Security requirements

- One user cannot read, change, delete or learn anything about another's
  styles.
- Style names are shown only as escaped text. A name never reaches CSS, an
  attribute that is parsed as code, or a URL.
- The CSP is unchanged. No inline styles are stored or produced.
- The API carries names and settings only in request and response bodies,
  which are never logged; logs follow the existing rule (method, path,
  status, duration).

## 12. Acceptance criteria

Each has an automated test that runs under `npm test` with no network access.

1. Creating a style stores and returns what was sent, with the name trimmed;
   the list is ordered by name key, non-ASCII names included.
2. Refused with the stated answer: a missing or extra field; a name that is
   empty after trimming, longer than 50 code points, or has a control
   character; a size outside 8 to 96 or not a whole number; an unknown colour,
   highlight or font id; a duplicate name in another capitalisation; two
   parallel creates of one name (one 201, one 409); the 51st style, and ten
   parallel creates at 49 (exactly one succeeds). Renaming a style to another
   capitalisation of its own name succeeds.
3. A style may hold a retired font and a font outside the user's collection;
   it can be created, edited and applied, and its sample falls back when the
   faces cannot be loaded.
4. Another user's `GET` does not include the style; their `PUT` is 404; their
   `DELETE` is 200 and the style is unchanged. Deleting a user removes their
   styles.
5. Applying a style to a selection with mixed formatting leaves every piece
   of text with exactly the style's marks: each of font, size, colour and
   highlight present once or absent as the style says; marks the style lacks
   are gone; links are kept. Applied straight after typing, one Undo restores
   the formatting and keeps the typing.
6. Size rule: a style of size 16 leaves no `fontSize` mark in a paragraph, a
   list, a quote and a table cell, and sets one in a heading; a style whose
   size equals a heading's own leaves none there. A heading keeps its weight
   when the style has `bold: false`.
7. Inline code and a code block inside the selection are unchanged. With two
   diagonal table cells selected, the other cells are unchanged. The button
   is disabled with the cursor in code and with a selection of code only.
8. With no selection inside formatted text, choosing a style changes no
   existing text (the note's content is identical), and the next typed text
   has exactly the style's marks plus any link it was typed into.
9. The 51st distinct font is refused with the notice, with and without a
   selection; a style that replaces fonts so that the result has 50 or fewer
   is applied.
10. Editing or deleting a style changes no note: a note styled earlier is
    identical on the server afterwards.
11. "Save selection as style…" fills the form from the first selected text,
    for a forward and a backward selection and at a boundary between two
    formats; from the cursor's formatting with no selection; from plain text
    (Inter, the block's size, nothing on); and from text whose font is not in
    the collection, which the form lists and saves. Saving does not change
    the note.
12. The form: every control sets its field; a typed size takes effect without
    Enter and a bad one is restored; the preview's markup carries the current
    settings; `name_taken` shows under Name and `styles_full` above the
    buttons, with the dialog still open.
13. The Styles menu: first in the toolbar; styles in order, with a 96 px
    style's sample carrying size 20; the two entries below; "No styles yet"
    when empty; "Manage styles…" saves the note and goes to `/styles`.
14. `/styles`: for a style with everything set and one with nothing set, the
    cards show exactly the stated chips, and a 96 px style's sample carries
    size 28; the count; the state of New style at 50 with its text; the empty
    state's lines; the delete dialog's title and message; button names;
    changes survive a remount of the app.
15. `/styles` routing: the sidebar entry and its current mark, a direct
    visit, the trailing slash, reload, Back to the notes, signed out then
    sign-in, the tab title, and the open note saved and closed.
16. Samples ask `/faces` through the shared loader: never more than 6 in
    flight together with an open note's requests; one request for a font used
    by several styles; a note with 50 fonts still gets its fonts and the
    styles theirs; a failed font shows the fallback and is asked for again at
    the next opening.
17. The note schema is unchanged: its nodes, marks, mark attributes, the
    exclusion of marks in code, and a fixture of accepted and rejected notes
    behave as before; a note carrying any style field is rejected. The agent
    tool and Markdown converter are unchanged. The CSP header has its exact
    present value.
18. On every styles route: a change with a wrong or missing Origin is 403;
    with a good Origin and no session, or a missing or mismatched
    `X-Notes-User`, 401; and answers of every status (200, 201, 400, 401,
    403, 404, 409) are `no-store`.
19. A style named with HTML and CSS metacharacters shows as plain text on the
    card, in the menu and in the delete dialog, and after creating, failing
    to create, editing and deleting such a style the logs contain neither its
    name nor its settings.

Checked by hand, once, and reported: in a real browser, create three styles
(one with a collection font, one with colours, one plain), apply them in a
note with and without a selection, undo, reload, and view `/styles`, in light
and dark at desktop and phone widths.
