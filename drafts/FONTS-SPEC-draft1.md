# Fonts: specification (draft 1)

An addition to the notes app described in `SPEC.md`. Where this document is
silent, `SPEC.md` and `DEVIATIONS.md` apply. Where the two disagree, section 2
below wins, because the owner decided it later.

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
- Scripts other than Latin and Latin Extended. Other characters in text that
  carries a font show in the fallback font.
- Uploading font files. Fonts from sources other than the catalogue.
- Custom preview text on `/fonts`.
- Fonts for agents: the `create_note` tool and the Markdown converter are
  unchanged, and Markdown gains no font syntax.
- Refreshing the catalogue while the app runs.
- Any change to the Content-Security-Policy. It stays as it is, with
  `font-src 'self'` and `connect-src 'self'`.

## 4. The catalogue

### 4.1 Snapshot

- `src/shared/font-catalogue.json` is committed to the repository and built
  into the image. Each entry has:
  - `id`: the family name lower-cased with each run of characters outside
    `a-z0-9` replaced by one hyphen, for example `titan-one`. It matches
    `^[a-z0-9]+(-[a-z0-9]+)*$`, is at most 64 characters, and is unique.
  - `family`: the exact Google family name, for example `Titan One`.
  - `category`: one of `serif`, `sans-serif`, `display`, `handwriting`,
    `monospace`.
  - `faces`: which of regular 400, bold 700, italic 400 and italic 700 exist
    (as static styles or inside a variable weight range).
  - `licence`: `OFL-1.1`, `Apache-2.0` or `UFL-1.0`.
  - `retired`: true when Google no longer lists the family.
- Families with no Latin subset are left out of the snapshot.
- The snapshot is append-only. An `id` never changes meaning and is never
  removed; a family Google drops is marked `retired`. Retired families are
  hidden on `/fonts`, cannot be added to a collection, and stay valid in notes.

### 4.2 Generating it

- `npm run fonts:catalogue` regenerates the snapshot on a developer machine
  and is never run by the app or the container. It merges into the existing
  file under the append-only rule and prints what was added and retired.
- Source: the Google Fonts Developer API when `GOOGLE_FONTS_API_KEY` is set in
  the developer's environment; otherwise the public listing at
  `https://fonts.google.com/metadata/fonts`. (Open question 1.)
- If two families would produce the same `id`, the script fails and names them.

## 5. Font files on the server

### 5.1 What is fetched

There are two kinds of file, and they are never interchangeable.

- **Preview file**: one small WOFF2 holding only the characters of the
  family's own name, regular 400 (or the nearest weight the family has).
  Requested from `https://fonts.googleapis.com/css2` with `family=<family>`
  and `text=<family>`. Used only to draw the name on `/fonts` and in the
  editor's font menu.
- **Note faces**: the WOFF2 files for the Latin and Latin Extended
  `unicode-range` slices of each face the family has among regular 400, bold
  700, italic 400 and italic 700. Used to render note text.

Rules for every fetch:

- The server builds every upstream URL itself from a catalogue entry. No part
  of a client request is ever used as a URL, host, path or `text=` value. Note
  text is never sent to Google.
- HTTPS only. The stylesheet comes from `fonts.googleapis.com`; font files
  come from `fonts.gstatic.com`. No other host is contacted and no redirect to
  another host is followed.
- Requests carry a fixed modern-browser `User-Agent` so that Google answers
  with WOFF2, and no cookies or other identifying headers.
- The stylesheet is parsed strictly: only `@font-face` blocks, and from each
  only `font-style`, `font-weight`, `unicode-range` and one `https://fonts.gstatic.com/…`
  URL with format `woff2`. Anything else makes the fetch fail. Google's CSS is
  never passed through to a browser.
- A stylesheet is at most 256 KB. A font file is at most 2 MB and must begin
  with the WOFF2 signature `wOF2`. Each request times out after 10 seconds.
- At most 4 upstream requests run at once, server-wide. Concurrent requests
  for the same thing share one upstream fetch.
- A failed fetch is not remembered as a permanent failure: a later request
  tries again, at most once per 60 seconds per family.

### 5.2 Storage

- Files live under `/data/fonts/`, named by the SHA-256 of their content.
  Writes go to a temporary name and are renamed into place.
- A table records, per family, its preview file and its note faces (weight,
  style, `unicode-range`, file hash), with the time fetched and last used.
- The font store is shared by all users and does not count toward anyone's
  1 GB storage limit.
- The store is capped at 500 MB (`NOTES_FONT_CACHE_MB`, default 500). When a
  fetch would exceed the cap, the server first deletes note faces of families
  that are in no collection, least recently used first. Preview files are
  never deleted. If the store is still over the cap, the fetch fails with
  "The font store is full."
- The font store is a cache: everything in it can be fetched again. `notes
  data copy` does not copy `/data/fonts/`; it copies the collections, which
  are in the database. After a restore, files are fetched again on demand.

## 6. API

All routes are under `/api/fonts`, require a session, and follow the existing
rules (Origin check on changes, `X-Notes-User` on every request) with one
exception: `GET /api/fonts/file/:hash` is exempt from `X-Notes-User`, as
`GET /api/images/:id` is, because the browser's font loader cannot send it.

| Route | Result |
|---|---|
| `GET /catalogue` | The snapshot without retired families: `id`, `family`, `category`. Sent with an `ETag`. |
| `GET /collection` | The user's collection, in the order added: `id`, `family`, `category`. |
| `PUT /collection/:id` | Add. Fetches the note faces if the store lacks them, then adds the row. 201, or 200 if already present. |
| `DELETE /collection/:id` | Remove. 200 whether or not it was present. |
| `GET /preview/:id` | `{ file }`: the hash of the preview file, fetched first if needed. |
| `GET /faces/:id` | `{ family, category, faces: [{ weight, style, unicodeRange, file }] }`, fetched first if needed. |
| `GET /file/:hash` | The WOFF2 bytes, `Content-Type: font/woff2`, `Cache-Control: private, max-age=31536000, immutable`. |

- `:id` must be a catalogue id; anything else is 404. `:hash` must be 64 hex
  characters naming a file in the table; anything else is 404.
- `PUT` errors: 404 for an unknown id; 409 `retired` for a retired family; 409
  `collection_full` ("You can keep at most 50 fonts. Remove one to add
  another.") when the user already has 50; 502 `font_unavailable` ("This font
  could not be downloaded. Try again later.") when Google cannot be reached or
  the answer is rejected; 507 `font_store_full`.
- Rate limit: per user, at most 300 requests per minute that need an upstream
  fetch. Beyond that the answer is 429 with `Retry-After`. Requests served
  from the store are not limited.
- Deleting a user deletes their collection rows.

## 7. The `/fonts` page

- Address `/fonts`, served like `/n/<id>`. Signed out, the sign-in page shows
  and `/fonts` opens after sign-in. The sidebar has a "Fonts" entry; the page
  has a way back to the notes. Back and Forward work.
- **Controls**: a search box (case-insensitive match anywhere in the family
  name), a category menu (All, Serif, Sans serif, Display, Handwriting,
  Monospace), and a count such as "390 of 468" (in the collection or not,
  matching the filters, of the catalogue total).
- **Collection row**: the user's fonts as chips, each name in its own font,
  each with a remove button, and "12 of 50" beside them.
- **Grid**: one card per matching family, in catalogue order (alphabetical).
  A card shows the family name in its own font and an add button; a font in
  the collection shows as selected and the button removes it. Adding and
  removing take effect at once and survive a reload.
- **Progressive loading**:
  - The grid is virtualised: only cards on or near the screen exist in the
    page, so the full catalogue scrolls smoothly.
  - A card first shows its name in the fallback font, never as blank space.
    When the card comes within about one screen of view, its preview is
    requested; when the font is ready the name switches to it.
  - At most 6 preview requests are in flight. Requests for cards that have
    scrolled well out of view are cancelled or skipped. Fast scrolling to the
    end must not load every font passed on the way.
  - A preview that fails leaves the name in the fallback font and is retried
    the next time the card comes into view. A 429 pauses loading until the
    time given.
  - Loaded previews stay loaded while the page is open, up to 400 faces; the
    least recently shown are released beyond that.
- Preview faces are registered under private names (for example
  `preview-titan-one`), never the real family name, so a preview can never be
  used to draw note text.
- Errors from adding (full collection, download failed) appear as the app's
  existing notice.
- The page works at phone width and with the keyboard; every control has an
  accessible name; the add button states the font ("Add Titan One").
- A line at the foot says the fonts come from Google Fonts under open
  licences, and each card's tooltip names its licence. The three licence
  texts ship with the app and are linked from that line.

## 8. Fonts in notes

### 8.1 Schema

- One new mark, `fontFamily`, with one attribute `font` holding a catalogue
  `id`. It renders as `<span data-font="titan-one">`: no inline style, no
  class, no family name in the HTML.
- It combines with bold, italic, strikethrough, link, text colour and
  highlight. It cannot be applied inside inline code or code blocks, the same
  as the colour marks, and the menu is disabled there.
- A piece of text has at most one font.
- `parseHTML` accepts only a `data-font` attribute whose value is a catalogue
  id. Pasted HTML with `font-family` styles, `<font face>` or anything else
  gets no mark.
- The server validator accepts the mark only when `font` is a string that is
  an `id` in the catalogue snapshot, retired families included. It does not
  consult the user's collection, so a note stays saveable after its font is
  removed from the collection or retired. (Open question 2.)
- Existing notes need no migration. Search text, snippets, drafts and the
  conflict path carry the mark unchanged.

### 8.2 Editor

- The toolbar gains a font menu button showing the font at the cursor, or
  "Font". The menu lists the user's collection in the order added, each name
  drawn in its own font, then "Default font" (removes the mark) and "Browse
  fonts…" (goes to `/fonts`, saving the note first as any navigation does).
- If the text at the cursor uses a font that is not in the collection, the
  button still names it.
- With an empty collection the menu shows "No fonts yet" and "Browse fonts…".
- Keyboard behaviour and accessibility match the colour menus.

### 8.3 Rendering

- When a note opens, and whenever a font is first used in it, the editor
  collects the font ids in the document, asks `/api/fonts/faces/:id` for each,
  and registers the faces under a private name per family (for example
  `nf-titan-one`) with their weight, style and `unicode-range`, so the browser
  downloads only the files the text needs.
- Text with the mark is styled by a rule the app generates,
  `[data-font="titan-one"] { font-family: "nf-titan-one", <fallback> }`, where
  the fallback is the generic family for the category (`serif`, `sans-serif`,
  `monospace`, `cursive` for handwriting, and the app's own font for display).
- Text shows in the fallback until the font arrives (`font-display: swap`
  behaviour) and stays in the fallback, with no error shown, if it cannot be
  loaded.
- Bold and italic text uses the family's bold and italic faces when they
  exist; otherwise the browser synthesises them.

### 8.4 Removing a font

Removing a font from the collection changes no note. It leaves the menu; notes
that use it keep rendering it, and it can be added again.

## 9. Deployment

- The app container needs outbound HTTPS to `fonts.googleapis.com` and
  `fonts.gstatic.com`. Without it, fonts already in the store keep working and
  new ones fail with the "could not be downloaded" message; nothing else is
  affected.
- New setting `NOTES_FONT_CACHE_MB` (default 500) in `.env.example` and
  `docker-compose.yml`.
- `README.md` gains a short Fonts section: what the page does, the outbound
  access it needs, the cache and its setting, that `data copy` leaves the font
  files out, and how to regenerate the catalogue.
- `DEVIATIONS.md` records that this feature follows `FONTS-SPEC.md`.

## 10. Security requirements

- The CSP is unchanged, and a test asserts it.
- No request parameter reaches an upstream URL or a file path. Ids are checked
  against the catalogue and hashes against the table before any use.
- The font routes need a session, so the server is not an open proxy.
- One user cannot read, change or learn anything about another's collection.
- A font id reaches CSS only after matching the id pattern, and the family
  name never reaches CSS or HTML attributes that are parsed as code.
- Upstream responses are untrusted: size caps, strict stylesheet parsing, the
  WOFF2 signature check, and `X-Content-Type-Options: nosniff` on files.
- App and Caddy logs gain nothing new: no collection contents, no font names.

## 11. Acceptance criteria

Each has an automated test that runs under `npm test` with no network access:
the upstream fetcher is replaceable, and tests use recorded responses.

1. `/fonts` lists the catalogue; search and category narrow it and the count
   is right.
2. Scrolling requests previews only for cards near the screen, never more than
   6 at once, and jumping to the end does not request the cards skipped.
3. Adding a font puts it in the collection row and the editor's menu; it is
   still there after a reload; another user does not see it.
4. The 51st add is refused with the stated message, and removing one allows it.
5. Applying a font to selected text, saving and reloading shows the text with
   `data-font` and the generated rule; "Default font" removes it.
6. A note whose font was removed from the collection still opens, renders the
   font, and saves.
7. The server refuses a save whose `fontFamily` mark has an unknown id, a
   missing or non-string `font`, an extra attribute, or sits inside code.
8. Pasted HTML with `font-family` styles or a `data-font` that is not a
   catalogue id produces no mark.
9. An unknown id or hash gives 404 with no upstream request. A crafted id
   (`../x`, a URL, upper case, 65 characters) gives 404.
10. An upstream stylesheet containing anything but the allowed `@font-face`
    parts, a URL on another host, a file without the WOFF2 signature, or an
    oversized response is rejected and nothing is stored.
11. Ten simultaneous requests for one uncached font make one upstream fetch.
    No more than 4 upstream requests run at once.
12. When Google is unreachable, stored fonts still serve, adding a new font
    gives the stated message, and notes open with the fallback font.
13. Over the cache cap, unreferenced note faces are deleted least recently
    used first, previews and collection fonts are kept, and a fetch that still
    does not fit fails with the stated message.
14. `GET /api/fonts/file/:hash` without a session is 401; every other font
    route without `X-Notes-User` is 401; a change with a wrong Origin is 403.
15. The agent tool and the Markdown converter cannot produce a `fontFamily`
    mark.
16. `notes data copy` leaves `/data/fonts/` out and includes the collections;
    deleting a user removes their collection.

Checked by hand, once, with network access: the catalogue script runs; one
real font is added and renders in a note in light and dark, on desktop and
phone widths.

## 12. Open questions for reviewers

1. **Catalogue source.** Is the keyless public listing an acceptable default
   for the generator script, or should the script require the Developer API
   key (the owner would create one, used only on a developer machine)?
2. **Which ids a note may hold.** This draft accepts any catalogue id. The
   alternative is "a font new to this note must be in the saver's collection;
   one already in the saved note stays valid". Is the stricter rule worth its
   cost?
3. **Face selection.** For variable families, is "the 400 and 700 instances,
   upright and italic, Latin and Latin Extended slices" well enough defined to
   implement against what `css2` really returns, and what should the exact
   `css2` request be?
4. **Limits.** Are 500 MB, 2 MB per file, 4 upstream at once, 300 uncached
   requests per user per minute and 400 loaded preview faces sensible?
5. **Licences.** Is naming the licence per font and shipping the three licence
   texts enough to meet the open licences' terms for serving these files?
