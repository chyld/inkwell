# Text styles: specification (draft 1)

An addition to the notes app described in `SPEC.md` and `FONTS-SPEC.md`. Where
this document is silent, those and `DEVIATIONS.md` apply. Where they disagree,
this document wins, because the owner decided it later.

The beta team's advice on the design is in `reviews-styles/`.

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
  today. A test asserts that the schema's node and mark lists are unchanged.

## 4. What a style is

| Field | Values |
|---|---|
| `id` | A UUID the server assigns. Never changes. |
| `name` | 1 to 50 characters after trimming; no control characters. Unique among that user's styles, ignoring case. |
| `font` | A font catalogue id, or `null` for the default font (Inter). |
| `size` | A whole number from 8 to 96. |
| `bold`, `italic`, `underline`, `strike` | `true` or `false`. |
| `textColor` | One of the eight text colour names, or `null` for the normal text colour. |
| `highlight` | One of the eight highlight names, or `null` for none. |

- The colour names, the size range and the font id rule are the ones in
  `src/shared/schema.ts`; styles use the same constants and checks, so a style
  can never hold a value a note could not.
- A user has at most 50 styles.
- Styles are listed in alphabetical order by name, ignoring case, everywhere.

## 5. Applying a style

Applying a style to a selection makes every part of the selected text match
the style exactly, in one step that one Undo reverses:

- `font`: sets the `fontFamily` mark, or removes it when the style says `null`.
- `size`: sets the size by the same rule as the size control: the `fontSize`
  mark is set, or removed where the size equals that block's default (16 in a
  paragraph or list, the heading's own size in a heading).
- `bold`, `italic`, `underline`, `strike`: the mark is added when `true` and
  removed when `false`.
- `textColor`, `highlight`: set, or removed when `null`.

Rules:

- Links, and the structure of the note (paragraphs, headings, lists, tables),
  are untouched.
- Inline code and code blocks inside the selection are skipped, because those
  marks cannot exist there. If the whole selection is code, the menu is
  disabled.
- With no selection, choosing a style sets the formatting for what is typed
  next, the same way the font, size and colour controls behave with no
  selection.
- If the style's font would be the note's 51st distinct font, nothing is
  applied and the existing notice "A note can use at most 50 fonts." shows.
- After applying, the text is ordinary formatted text. Every toolbar control
  works on it as usual.

## 6. API

All routes are under `/api/styles`, require a session, and follow the existing
rules (Origin check on changes, `X-Notes-User` on every request). Every answer
has `Cache-Control: private, no-store`.

| Route | Result |
|---|---|
| `GET /` | The user's styles in alphabetical order, each with all the fields of section 4. |
| `POST /` | Create from `name` and the eight settings. 201 with the style. |
| `PUT /:id` | Replace `name` and the eight settings. 200 with the style. |
| `DELETE /:id` | Delete. 200 whether or not it existed. |

- All eight settings and the name are required on create and on replace. A
  missing, extra or invalid field is 400 with a message naming the field.
- 409 `name_taken` ("You already have a style with that name.") when another
  of the user's styles has that name, ignoring case. Renaming a style to a
  different capitalisation of its own name is allowed.
- 409 `styles_full` ("You can keep at most 50 styles. Delete one to add
  another.") on the 51st, checked in the same transaction as the insert.
- `font` on create and replace must be `null` or a catalogue id that is either
  in the user's font collection or already this style's font. So a style keeps
  working, and stays editable, after its font leaves the collection or is
  retired. Any other id is 400.
- A style id that does not exist or belongs to another user is 404 on `PUT`.
- Deleting a user deletes their styles. `notes data copy` includes them (they
  are in the database).
- Two tabs editing the same style: the last save wins. No versioning.

## 7. The style form

One form is used everywhere a style is created or edited. It is a dialog with:

- **Name**: a text field.
- **Font**: a menu with "Inter" first (meaning `null`), then the user's font
  collection, each drawn in its own font; plus the style's current font if it
  is no longer in the collection. A link "Browse fonts…" goes to `/fonts`.
- **Size**: the same − / number / + control as the toolbar, 8 to 96.
- **Bold, Italic, Underline, Strikethrough**: four toggle buttons.
- **Text colour**: the eight swatches and "None".
- **Highlight**: the eight swatches and "None".
- **Preview**: the sentence "The quick brown fox jumps over the lazy dog" drawn
  with the current settings, updating as they change.
- **Save** and **Cancel**. Server errors (name taken, full) show inside the
  dialog beside the field they concern, and the dialog stays open.

A new style starts as Inter, 16, nothing on, no colours. Keyboard and
accessibility behaviour matches the app's other dialogs and menus.

## 8. In the editor

- The toolbar gains a **Styles** menu button as its first item, before the
  font menu. The button always reads "Styles": text does not remember a style,
  so there is no current style to show.
- The menu lists the user's styles, each name drawn with that style's
  settings. In the menu the size is capped at 20 px so rows stay compact; the
  other settings show as they are. Choosing one applies it (section 5).
- Below the list: **Save selection as style…** and **Manage styles…** (goes to
  `/styles`, saving the note first as any navigation does).
- With no styles, the menu shows "No styles yet" above those two entries.
- **Save selection as style…** opens the form filled in from the formatting at
  the start of the selection (or at the cursor): its font or Inter, its
  effective size, which of the four toggles are on, and its colours. The name
  is empty. Saving creates the style; it does not change the note. Disabled
  when the selection starts in code.
- The menu's keyboard behaviour matches the font menu.

## 9. The `/styles` page

- Address `/styles` (and `/styles/`), a route in the web app handled like
  `/fonts`: a "Styles" entry in the sidebar, direct visit, reload, Back to the
  notes, sign-in first when signed out, tab title "Styles – Notes". On a wide
  screen it takes the place of the note list and editor; on a phone it is one
  screen with a Back control.
- **Header**: "Styles", the count "8 of 50", and a **New style** button that
  opens the form. At 50 the button is disabled with the reason as its tooltip.
- **Grid of cards**, alphabetical. Each card shows:
  - the style's name drawn with the style's settings. The size is capped at
    28 px on the card so cards stay a similar height; long names are cut with
    an ellipsis;
  - chips for every setting: the font name, the size as "22 px", one chip for
    each of Bold, Italic, Underline and Strikethrough that is on, the text
    colour with a dot of that colour and its name, and the highlight the same
    way. A setting that is off or `null` has no chip, except the font, which
    always shows (as "Inter" when `null`);
  - **Edit** (opens the form) and **Delete**.
- **Delete** asks first: "Delete "Warning"? Text you already styled keeps its
  formatting." with Delete and Cancel.
- **Empty state**: "No styles yet", a line explaining what a style is, the
  **New style** button, and a hint that a style can also be saved from
  selected text in a note.
- Changes appear at once and survive a reload. Another user sees none of them.
- At 390 px wide the grid is one column and nothing scrolls sideways.

## 10. Drawing text in a style's font

Style names on cards, in the menu and in the form's preview are arbitrary
text, so they need the real font, not the name-only preview files of
`FONTS-SPEC.md` section 5.1.

- They use the note-face loader of `FONTS-SPEC.md` section 8.3: the same
  `/api/fonts/faces/:id` request, the same `nf-<id>` faces, at most 6 requests
  at a time, fallback font until ready, and a failure leaves the fallback.
- Colours come from the existing theme tokens, so text colour and highlight
  look right in light and dark.

## 11. Security requirements

- One user cannot read, change, delete or learn anything about another's
  styles.
- Style names are shown only as escaped text and never reach CSS or HTML
  attributes that are parsed as code.
- The CSP is unchanged. No inline styles are stored anywhere; a style's look
  is produced with the same classes, data attributes and generated font rules
  that notes use.
- Logs contain style ids in request paths and nothing else: no names, no
  settings.

## 12. Acceptance criteria

Each has an automated test that runs under `npm test` with no network access.

1. Creating a style with each setting stores and returns exactly what was
   sent; the list is alphabetical ignoring case.
2. Refused with the stated answer: a missing or extra field; a name that is
   empty, too long or has a control character; a size outside 8 to 96 or not a
   whole number; an unknown colour, highlight or font id; a font not in the
   collection (unless it is already the style's font); a duplicate name
   ignoring case; the 51st style, including ten parallel creates at 49.
3. A style whose font left the collection or was retired can still be edited
   and applied.
4. Another user cannot list, change or delete a style (404 or an empty list),
   and deleting a user removes their styles.
5. Applying a style to a selection that had different formatting leaves every
   part with exactly the style's eight settings: marks the style lacks are
   removed, links are kept, and one Undo restores the earlier state.
6. Applying inside a heading and a paragraph follows the size rule of section
   5; code inside the selection is unchanged; the menu is disabled in code.
7. With no selection, the next typed text has the style's formatting.
8. Applying a style whose font would be the 51st in the note changes nothing
   and shows the notice.
9. Editing or deleting a style changes no note: a note styled earlier is
   byte-for-byte the same on the server afterwards.
10. "Save selection as style…" fills the form from the selection's formatting,
    including text with no marks (Inter, the block's size, nothing on), and
    saving does not change the note.
11. The form: every control sets its field; the preview carries the current
    settings; a name-taken answer shows in the dialog and keeps it open.
12. `/styles`: cards show the stated chips for a style with everything set and
    one with nothing set; the count and the disabled New button at 50; the
    empty state; the delete confirmation text; changes survive a reload.
13. `/styles` routing: the sidebar entry, a direct visit, the trailing slash,
    reload, Back, signed out then sign-in, and the tab title.
14. Style names on cards and in the menu request `/faces` for their fonts
    through the shared loader, never more than 6 at once, and show the
    fallback when a font fails.
15. The note schema's node and mark lists are unchanged, the agent tool and
    Markdown converter are unchanged, and the CSP header has its exact present
    value.
16. Every styles route without a session or without `X-Notes-User` is 401, a
    change with a wrong Origin is 403, and every answer is `no-store`.

Checked by hand, once, and reported: in a real browser, create three styles
(one with a collection font, one with colours, one plain), apply them in a
note, reload, and view `/styles`, in light and dark at desktop and phone
widths.
