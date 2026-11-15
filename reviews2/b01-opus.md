### 1. [high] Images tied to one note break copy-paste between notes

§6.5 ties each image to one note, but copying content between notes copies `/api/images/<id>`; editing or deleting the original then deletes an image the copy shows. Change §6.5: images belong to the user and are deleted only when no note of theirs (Trash included) references them and they are over 24 hours old. §6.2 must reject foreign image ids.

### 2. [medium] Folder and tag changes cause false 409s

§6.1 bumps `version` on folder and tag changes, but §6.3 only serialises body saves. Adding a tag while an autosave is in flight, or moving the note in another tab, makes the next body save get a 409 against the user's own change. Change §6.1: `version` counts only title and body changes; folder, tag and Trash operations neither check nor bump it.

### 3. [medium] `db copy` silently leaves out every image

§9 `db copy` and README item 1 copy only the SQLite file, but images are separate files on `/data` (§4), so the only manual copy offered restores notes with broken images. Change §9: `db copy <dir>` writes the database copy plus the images directory into `<dir>`, and README item 1 copies that directory with `docker compose cp`.

### 4. [medium] "Trust the Compose network" cannot be configured as written

§5 restricts `trustProxy` to the Compose network, but Compose assigns that subnet dynamically. A wrong guess makes every client appear as Caddy's IP, so 20 failures from anyone block sign-in for everyone. Change §5: because only Caddy reaches `app` (§4), set `trustProxy` to exactly one hop (last `X-Forwarded-For` entry), or pin the subnet in `docker-compose.yml` (§12).

### 5. [low] The CSP will silently break Tiptap styling

§11 does not set `style-src`. Tiptap injects a `<style>` element by default and ProseMirror sets `style` attributes (table column widths), which a strict `default-src 'self'` blocks without any visible error. Change §11: either allow `style-src 'self' 'unsafe-inline'` (scripts stay strict), or require Tiptap's `injectCSS: false` with its CSS bundled, and test tables under the real CSP.

VERDICT: NOT READY — the image-ownership and `version` rules shape the database schema and should be fixed before any code is written; the other three are one-line edits.
END-OF-REVIEW
