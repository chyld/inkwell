# Fonts: specification (draft 2)

An addition to the notes app described in `SPEC.md`. Where this document is
silent, `SPEC.md` and `DEVIATIONS.md` apply. Where they disagree, this
document wins, because the owner decided it later.

Draft 2 answers the 14 reviews of draft 1 in `reviews-fonts-spec/`. The Google
Fonts facts in section 5.1 were checked with live requests on 2026-11-15.

## 1. Summary

A signed-in user opens `/fonts`, browses the Google Fonts catalogue, and adds
fonts to a private collection of at most 50. In the note editor a font menu
lists that collection, and the user applies a font to selected text. Font
files reach the browser only from the notes server, which fetches them from
Google on first need and keeps a copy.

## 2. Owner decisions (final; reviewers should not reopen these)

1. There is a page at `/fonts` for browsing Google Fonts: a search box, a
   category filter, and a grid in which every font's name is drawn in that font.
2. Previews load progressively as the user scrolls.
3. Each user has a private collection. One user's collection is invisible to
   every other user.
4. A collection holds at most 50 fonts.
5. Fonts are used on text in notes.
6. Browsers never contact Google. The server fetches and serves the files.
7. The catalogue is a snapshot shipped with the app. The running app needs no
   Google account or key.
8. A font applies to selected text. There is no whole-note default font.
9. Latin text only in this version; regular and bold, upright and italic.

## 3. Out of scope

- A default font per note, per folder or per user.
- Weight, width or other variable-font controls beyond regular and bold.
- Scripts other than Latin and Latin Extended (Vietnamese, Cyrillic, Greek,
  math and symbol slices are not fetched). Other characters in text that
  carries a font show in the fallback font.
- Uploading font files. Fonts from sources other than the catalogue.
- Custom preview text on `/fonts`.
- Fonts for agents: the `create_note` tool and the Markdown converter are
  unchanged, and Markdown gains no font syntax.
- Refreshing the catalogue while the app runs.
- Any change to the Content-Security-Policy. It stays exactly as it is.

## 4. The catalogue

### 4.1 Snapshot

- One file, `src/shared/font-catalogue.json`, is committed to the repository.
  The server, the web app and the tests all read this same file, so the editor
  and the server always agree on which ids exist. The builder makes whatever
  build changes that needs (the file must end up in the Docker image and in
  the web bundle).
- Each entry has:
  - `id`: the family name lower-cased, each run of characters outside `a-z0-9`
    replaced by one hyphen, leading and trailing hyphens removed; for example
    `titan-one`. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`, is at most 64
    characters, and is unique.
  - `family`: the exact Google family name, for example `Titan One`.
  - `category`: `serif`, `sans-serif`, `display`, `handwriting` or
    `monospace`.
  - `regular`: the upright weight used as the regular face: 400 when the
    family has it, otherwise the family's upright weight nearest 400 (the
    lower one on a tie). Buda, which has only 300, gets 300.
  - `bold`: true when the family has upright 700.
  - `italic`: true when the family has an italic at the `regular` weight.
  - `boldItalic`: true when it has italic 700.
  - `retired`: true when Google no longer lists the family.
- A family is left out when it has no `latin` subset or no upright style.
- The snapshot is append-only. An `id` never changes meaning and is never
  removed; a family Google drops is marked `retired`, and one that returns is
  un-retired. Section 8.5 says what a retired family means for users.

### 4.2 Generating it

- `npm run fonts:catalogue` regenerates the snapshot on a developer machine.
  The app and the container never run it. It merges into the existing file
  under the append-only rule, prints what was added, retired and un-retired,
  and fails, naming the families, if two would share an `id` or an `id` would
  be empty or longer than 64 characters.
- Source: the public listing at `https://fonts.google.com/metadata/fonts`
  (JSON; the script tolerates a leading `)]}'` line). On 2026-11-15 it listed
  1,961 families, 1,840 with a `latin` subset. Per family the script uses
  `family`, `category` (mapped from `Serif`, `Sans Serif`, `Display`,
  `Handwriting`, `Monospace`), `subsets`, and the keys of `fonts` (`"400"`,
  `"400i"`, `"700"`, …) to derive the four face fields.
- The listing is undocumented. If its shape is not what the script expects,
  the script fails without writing anything.

## 5. Font files on the server

### 5.1 What is fetched

There are two kinds of file, and they are never interchangeable.

**Preview file.** One small WOFF2 holding only the characters of the family's
own name. Request:

`https://fonts.googleapis.com/css2?family=<F>:wght@<regular>&text=<F>`

with `<F>` the family name URL-encoded. The answer has one `@font-face` block
whose URL looks like `https://fonts.gstatic.com/l/font?kit=…`. Used only to
draw the name on `/fonts` and in the editor's font menu.

**Note faces.** Request the faces the catalogue entry says exist, as sorted
tuples (upright first, then by weight), for example for a family with all four:

`https://fonts.googleapis.com/css2?family=<F>:ital,wght@0,400;0,700;1,400;1,700`

When the family has no italic the form is `family=<F>:wght@400;700` (or just
the one weight). The answer has one block per face per script slice, each
preceded by a comment naming the slice (`/* latin */`, `/* latin-ext */`,
`/* cyrillic */`, …). The server keeps only the blocks labelled exactly
`latin` or `latin-ext`. For a variable family several faces can share one
file; that is expected.

Checked facts the builder can rely on, and must capture as test fixtures from
the live service: every block carries `font-family`; Google sends WOFF2 with
`unicode-range` slices only to a modern-browser `User-Agent` and TrueType
otherwise; a request for a single face the family lacks is HTTP 400 with an
HTML body; in a multi-face request, faces the family lacks are left out of an
HTTP 200 answer.

Rules for every fetch:

- The server builds every upstream URL itself from a catalogue entry. No part
  of a client request is ever used as a URL, host, path or `text=` value. Note
  text is never sent to Google.
- Stylesheets come only from `https://fonts.googleapis.com/css2`. A font file
  URL taken from a stylesheet is parsed with a URL parser and must be `https`,
  host exactly `fonts.gstatic.com`, default port, no user or password.
  Anything else fails the fetch. Redirects are not followed: any 3xx fails.
- Requests carry one fixed modern-browser `User-Agent`, written in the code,
  and no cookies or other identifying headers.
- Any status but 200 fails the fetch.
- The stylesheet is parsed, never passed on. Grammar accepted: comments and
  `@font-face` blocks only. In a block: `font-family` (must equal the
  requested family), `font-style` (`normal` or `italic`), `font-weight` (one
  integer, or two for a variable range), `src` (exactly one
  `url(…) format('woff2')`), `unicode-range` (required for note faces,
  optional for a preview), and `font-stretch` and `font-display`, which are
  accepted and ignored. Any other rule or descriptor fails the fetch. A note
  face answer with no `latin` block fails. The server stores the weight,
  style and range from the answer, not from the request.
- A stylesheet is at most 256 KB and a font file at most 2 MB, counted on the
  decoded body and enforced while reading. A font file must begin with the
  WOFF2 signature `wOF2`. Each upstream request times out after 10 seconds,
  including reading the body.
- One operation (a preview, or all the note faces of one family) is one
  stylesheet request plus one request per distinct file. It has an overall
  deadline of 30 seconds and is all-or-nothing: on any failure nothing from
  it is recorded.
- At most 4 upstream requests run at once, server-wide. At most 64 operations
  wait; beyond that the answer is 503 `font_busy`. Simultaneous requests for
  the same family and kind share one operation.
- After a failed operation, the same family and kind is not tried again for
  60 seconds; requests in that window get the failure answer without an
  upstream request. Preview failures do not block note faces, and vice versa.

### 5.2 Storage

- Files live under `/data/fonts/`, named by the SHA-256 of their content.
  Downloads are written under `/data/tmp` and renamed into place.
- Tables record, per family, its preview file and its note faces (weight or
  weight range, style, `unicode-range`, file hash), with the time fetched and
  the time last used. "Last used" is updated when `/faces` or `/preview`
  serves the family, at most once an hour per family.
- The font store is shared by all users and does not count toward anyone's
  1 GB storage limit.
- **Cap.** `NOTES_FONT_CACHE_MB` (default 500, a whole number of at least 50)
  caps the bytes of distinct files in the store. The size of an operation is
  known only after download, so the check is made when it is recorded.
- **Eviction.** When recording would exceed the cap, the server removes the
  note faces of families that are in no collection and are not retired, least
  recently used first, until it fits. Preview files are never removed (the
  whole catalogue's previews are about 10 MB). If it still does not fit, the
  operation fails with 507 `font_store_full` ("The font store is full.").
- **Consistency.** Recording an operation, eviction, and deleting files run
  one at a time. A file is deleted only when no row refers to it. Files of an
  operation in progress are not evictable.
- **Reconciliation.** At start-up the server drops rows whose file is missing
  and deletes files no row refers to, as it does for images. While running, a
  row whose file turns out to be missing is dropped and the family fetched
  again.
- The font store is a cache. `notes data copy` copies the collections (they
  are in the database) and leaves `/data/fonts/` out; after a restore the
  start-up reconciliation clears the stale rows and files are fetched again on
  demand. The one exception is a retired family, which Google may no longer
  serve: after a restore its text shows in the fallback font.

## 6. API

All routes are under `/api/fonts`, require a session, and follow the existing
rules (Origin check on changes, `X-Notes-User` on every request) with one
exception: `GET /api/fonts/file/:hash` is exempt from `X-Notes-User`, as
`GET /api/images/:id` is, because the browser's font loader cannot send it.

| Route | Result |
|---|---|
| `GET /collection` | The user's collection in the order added: an array of ids. |
| `PUT /collection/:id` | Add. 201, or 200 if already present. |
| `DELETE /collection/:id` | Remove. 200 whether or not it was present. |
| `GET /preview/:id` | `{ file }`: the hash of the preview file, fetched first if needed. |
| `GET /faces/:id` | `{ faces: [{ weight, style, unicodeRange, file }] }`, fetched first if needed. `weight` is `"400"` or a range such as `"400 700"`. |
| `GET /file/:hash` | The WOFF2 bytes. |

- There is no catalogue route: the web app has the snapshot built in.
- `:id` must be a catalogue id; anything else is 404 with no upstream request.
  `:hash` must be 64 lower-case hex characters naming a recorded file;
  anything else is 404.
- `PUT /collection/:id` works in this order: 404 for an unknown id; 409
  `retired` ("This font is no longer available from Google Fonts.") for a
  retired family not already in the collection; then, in one transaction, 409
  `collection_full` ("You can keep at most 50 fonts. Remove one to add
  another.") if the user has 50, otherwise the row is inserted; then the note
  faces are fetched if the store lacks them. If that fetch fails the row is
  removed again and the fetch error returned. Parallel adds can never leave
  more than 50 rows.
- Fetch errors, the same on `PUT /collection`, `GET /preview` and
  `GET /faces`: 502 `font_unavailable` ("This font could not be downloaded.
  Try again later."), 503 `font_busy`, 507 `font_store_full`.
- Rate limit: each user may make 1,200 requests per minute that are not
  answered from the store (requests that join an operation in progress and
  requests that fail both count). Beyond that: 429 `font_rate_limited` with
  `Retry-After` in whole seconds. Requests answered from the store are not
  limited.
- `GET /file/:hash` answers `Content-Type: font/woff2`,
  `X-Content-Type-Options: nosniff` and
  `Cache-Control: private, max-age=31536000, immutable`. Unlike an image, a
  font file is public, identical for every user, and named by its content, so
  a browser may reuse its copy without asking again; the session requirement
  exists only so the server is not an open proxy.
- Deleting a user deletes their collection rows.

## 7. The `/fonts` page

- Address `/fonts`, a new route in the web app handled like `/n/<id>`:
  reachable from a "Fonts" entry in the sidebar, by direct visit and by
  reload; a direct visit puts `/` beneath it in history so Back leads to the
  notes; signed out, the sign-in page shows and `/fonts` opens after sign-in.
  The page has a visible way back to the notes. The tab title is
  "Fonts – Notes".
- **Controls**: a search box (case-insensitive match anywhere in the family
  name); a category `<select>` (All, Serif, Sans serif, Display, Handwriting,
  Monospace); and a count "N of T", where T is the number of non-retired
  families and N the number matching the search and category. The count is
  announced to screen readers when it changes.
- **Collection row**: the user's fonts as chips in the order added, each name
  in its own font, each with a button "Remove <family>", and "12 of 50".
- **Grid**: the matching families in alphabetical order. A card shows the
  family name in its own font and a button "Add <family>"; a font in the
  collection shows as selected and its button is "Remove <family>". Changes
  take effect at once and survive a reload. Retired families do not appear in
  the grid.
- **Progressive loading**:
  - The grid is virtualised by rows. The rows rendered are those intersecting
    the viewport extended by one viewport height above and below; nothing else
    is in the page. A card that has keyboard focus stays rendered. The list
    exposes its full size to assistive technology (`aria-setsize` and
    `aria-posinset` on cards).
  - A rendered card shows its name at once in the fallback font, never blank.
  - Each rendered card without a loaded preview is a candidate. At most 6
    candidates are loading at a time, where loading means the whole sequence:
    the `/preview/:id` request, then the font file. A card that leaves the
    rendered rows before its turn is dropped from the queue; one already
    loading is allowed to finish. So jumping to the end loads the end, not
    everything on the way.
  - When the font is ready the name switches to it. A failure leaves the
    fallback and the card becomes a candidate again the next time it is
    rendered. A 429 pauses all loading until the time given.
  - Loaded previews stay registered while the page is open, up to 400; beyond
    that the least recently rendered are released, and load again (from the
    browser's cache) when rendered next.
  - The row arithmetic and the loading queue are written so tests can drive
    them with a stated viewport and a stand-in font loader.
- Preview faces are registered under private names (`preview-<id>`), never the
  real family name, so a preview can never draw note text.
- Errors from adding appear as the app's existing notice.
- At 390 px wide the grid is one column and nothing scrolls sideways. Every
  control works by keyboard and has an accessible name.
- **Licences.** A line at the foot reads "Fonts are from Google Fonts. Each is
  published under an open licence (SIL Open Font License, Apache License or
  Ubuntu Font Licence)", with links to the three licence texts, which ship
  with the app as static pages. Each card has a link "About <family>" to
  `https://fonts.google.com/specimen/<Family+Name>`, opening in a new tab,
  where the font's own licence and copyright are shown. Font files are served
  exactly as received. (Section 12, point 1.)

## 8. Fonts in notes

### 8.1 Schema

- One new mark, `fontFamily`, with one required attribute `font` holding a
  catalogue `id`. It is defined the same way as the colour marks and renders
  as `<span data-font="titan-one">`: no inline style, no class, no family name.
- It combines with bold, italic, strikethrough, link, text colour and
  highlight. It cannot exist inside inline code or a code block, and the menu
  is disabled there. A piece of text has at most one font.
- `parseHTML` accepts only a `data-font` attribute whose value is an id in the
  snapshot, retired families included. Pasted HTML with `font-family` styles,
  `<font face>` or an unknown `data-font` gets no mark.
- The server validator explicitly rejects a `fontFamily` mark when `font` is
  missing, not a string, or not an id in the snapshot; when it has any other
  attribute; when the text also carries inline code or sits in a code block;
  or when the same text has two font marks. It also rejects a note that uses
  more than 50 distinct fonts. It does not consult the user's collection, so
  a note stays saveable after its font leaves the collection or is retired.
- Existing notes need no migration. Search text and list snippets are plain
  text and ignore the mark. Drafts and the conflict path carry the document
  with its marks unchanged.

### 8.2 Editor

- The toolbar gains a font menu button showing the font at the cursor, or
  "Font". The menu lists the user's collection in the order added, each name
  drawn in its own font (the preview face), then "Default font" (removes the
  mark; always present, even with an empty collection) and "Browse fonts…"
  (goes to `/fonts`, saving the note first as any navigation does).
- If the text at the cursor uses a font that is not in the collection, the
  button still names it.
- With an empty collection the menu shows "No fonts yet" above those two
  entries.
- Keyboard behaviour and accessibility match the colour menus.

### 8.3 Rendering

- The editor keeps the set of font ids in the document it is showing, and
  recomputes it whenever the document changes by any route: opening a note,
  typing, paste, undo and redo, restoring a draft, and either choice in a
  conflict. For each id not yet registered it asks `/api/fonts/faces/:id`, at
  most 6 at a time.
- Each face is registered as
  `new FontFace("nf-<id>", "url(/api/fonts/file/<hash>)", { weight, style, unicodeRange, display: "swap" })`
  and added to `document.fonts` without calling `load()`, so the browser
  downloads only the files the text on screen needs, and text is never
  invisible while a font loads.
- Text with the mark is styled by rules the app writes into one `<style>`
  element it owns: `[data-font="<id>"] { font-family: "nf-<id>", <fallback> }`.
  The id is used only after it has matched the id pattern. The fallback is
  the generic family for the category: `serif`, `sans-serif`, `monospace`,
  `cursive` for handwriting, and the app's normal text font for display.
- A font that cannot be loaded (any error from `/faces`) leaves the text in
  the fallback with no message, and is tried again the next time a note that
  uses it is opened, never in a loop.
- Bold and italic text uses the family's own bold and italic faces when they
  exist; otherwise the browser synthesises them.
- Registered faces and rules are removed at sign-out.

### 8.4 Removing a font

Removing a font from the collection changes no note. It leaves the menu; notes
that use it keep rendering it, and unless it is retired it can be added again.

### 8.5 Retired families

A retired family is hidden from the grid and cannot be newly added. One
already in a collection stays there, still works in the menu, and can be
removed. Notes that use it stay valid and keep rendering it for as long as
its files are in the store; they are not evicted (section 5.2).

## 9. Deployment

- The app container needs outbound HTTPS to `fonts.googleapis.com` and
  `fonts.gstatic.com`. Without it, fonts already in the store keep working and
  new ones fail with the "could not be downloaded" message; nothing else is
  affected.
- New setting `NOTES_FONT_CACHE_MB` in `.env.example`, `docker-compose.yml`
  and the configuration code, validated like the other numeric settings. This
  amends `DEVIATIONS.md` row 10, which lists the settings.
- `README.md` gains a short Fonts section: what the page does, the outbound
  access it needs, the store and its setting, that `data copy` leaves the font
  files out and what that means for retired fonts, and how to regenerate the
  catalogue.
- `DEVIATIONS.md` records that this feature follows `FONTS-SPEC.md`.

## 10. Security requirements

- The CSP is unchanged, and a test asserts its exact value.
- No request parameter reaches an upstream URL or a file path. Ids are checked
  against the snapshot and hashes against the tables before any use.
- The font routes need a session, so the server is not an open proxy.
- One user cannot read, change or learn anything about another's collection.
- A font id reaches CSS only after matching the id pattern; the family name
  never reaches CSS, and reaches HTML only as text.
- Upstream responses are untrusted: the host rule, size caps, the stylesheet
  grammar and the WOFF2 signature check all apply before anything is stored.
- Logs: font ids appear in request paths, as note ids already do. Nothing
  else about fonts is logged: no family names, no collection contents.

## 11. Acceptance criteria

Each has an automated test that runs under `npm test` with no network access.
The upstream fetcher is replaceable and tests use responses recorded from the
live service (static, variable, upright-only and non-400 families, and a
`text=` preview). Web tests run in the existing DOM simulator with a stated
viewport and stand-ins for `IntersectionObserver` or scroll position and for
`FontFace`; they assert requests made, faces registered, rules written and
attributes present, not pixels.

1. `/fonts` search and category narrow the grid and "N of T" is right;
   retired families are absent.
2. With a stated viewport, only rows within one viewport of it are rendered
   and only their cards load; never more than 6 load at once; jumping to the
   end loads no skipped card; a card dropped from the queue loads when
   rendered again.
3. Adding a font puts it in the collection row and the editor's menu; it is
   still there after a reload; another user does not see it.
4. The 51st add is refused with the stated message and makes no upstream
   request; ten parallel adds at 49 leave exactly 50; removing one allows an
   add. A failed download leaves the collection unchanged.
5. Applying a font to selected text, saving and reloading keeps `data-font`;
   the face is registered with the stated arguments and the rule is written;
   "Default font" removes only the font, keeping bold, colour and highlight,
   and is offered with an empty collection.
6. A note whose font was removed from the collection opens, registers the
   font, and saves.
7. The server refuses a save for each case listed in 8.1, including the 51st
   distinct font.
8. Pasted HTML with `font-family` styles or a `data-font` that is not a
   snapshot id produces no mark; a valid one (retired included) is kept.
9. An unknown or crafted id (`../x`, a URL, upper case, 65 characters) or
   hash gives 404 with no upstream request.
10. Recorded real answers are accepted. Rejected, with nothing stored: an
    unknown rule or descriptor; a `font-family` that is not the one requested;
    a file URL on another host, including `fonts.gstatic.com.evil.example` and
    `fonts.gstatic.com@evil.example`; a redirect; a non-200 status; a file
    without the WOFF2 signature; an oversized stylesheet or file; a note face
    answer with no `latin` block. Only `latin` and `latin-ext` blocks are kept.
11. Ten simultaneous requests for one uncached family make one stylesheet
    request and one request per distinct file. No more than 4 upstream
    requests run at once; the 65th waiting operation gets 503.
12. When Google is unreachable, stored fonts still serve, adding a new font
    gives the stated message, a repeat within 60 seconds makes no upstream
    request, and notes open with the fallback font.
13. Over the cap, note faces of unreferenced, non-retired families are removed
    least recently used first; previews, collection fonts and retired families
    are kept; a file shared by two families survives while either remains; an
    operation that still does not fit gets 507.
14. With populated font tables and an empty `/data/fonts/` (as after a
    restore), start-up clears the rows and previews and faces are fetched
    again; collections are intact.
15. `GET /api/fonts/file/:hash` without a session is 401 and with one has the
    stated headers; every other font route without `X-Notes-User` is 401; a
    change with a wrong Origin is 403; the 1,201st uncached request in a
    minute is 429 with `Retry-After`; adding a retired family is 409.
16. A document change by draft restore, conflict choice, paste or undo
    registers the fonts it brings.
17. The agent tool and the Markdown converter cannot produce a `fontFamily`
    mark.
18. `notes data copy` leaves `/data/fonts/` out and includes the collections;
    deleting a user removes their collection.
19. The snapshot is valid: unique ids matching the pattern, known categories,
    face fields present. The generator, run on a recorded listing, applies the
    append-only, retire and un-retire rules and fails on an id collision.

Checked by hand, once, with network access, and reported: the catalogue script
runs against the live listing; in a real browser the page scrolls the whole
catalogue smoothly with previews appearing; one static and one variable font
are added and render in a note, regular, bold and italic, in light and dark,
at desktop and phone widths.

## 12. Points for the owner

1. **Licences.** Reviewers disagreed on whether naming the three licences and
   shipping their texts is enough, or whether each font's own copyright line
   must be shipped too. Google's public listing does not include licence or
   copyright per font, so this draft links each card to the font's Google page
   instead of storing them. This is a practical reading for a private app with
   fewer than 10 users, not legal advice.
2. **Fonts with no bold or italic.** Many display fonts have one style. Bold
   or italic text in such a font is synthesised by the browser, which can look
   rough.
