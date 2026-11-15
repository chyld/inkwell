# Review of SPEC.md (draft 2) — b12-glm

### 1. [high] Image srcs are not bound to the owning note

§6.2 checks only an image src's form; §6.5 binds each image to one note, GCs it on that note's saves, and deletes it with that note. Pasting between notes embeds a foreign image that the source note's GC or deletion silently destroys. Fix in §6.2: reject srcs whose image row belongs to another note (or user); define cross-note paste.

### 2. [medium] The image upload route is undefined

§6.5 never defines the upload route (§11 mentions only its 11 MB body limit), and its database row needs a note id, while a brand-new note may not exist server-side until first saved. Specify: POST /api/images, multipart, authenticated; uploads bind to an existing note id; and state that "New note" creates the server row immediately, before any paste.

### 3. [medium] The session cookie has no Max-Age

§2 fixes session lifetime at 30 idle days / 90 absolute, but §5 gives no cookie expiry: a browser-session cookie would end every session at browser close, contradicting §2, and a short one strands valid rows until the next sweep. Add to §5: persistent cookie, Max-Age 90 days, matching the absolute cap.

### 4. [low] Search queries leak into URLs, logs and history

§7.3 never says how the debounced query is sent. Built as GET, typed text sits in the URL — Caddy/Fastify access logs and browser history — at odds with §11's log hygiene. Specify POST /api/search with a JSON body (still Origin-checked per §5), or exclude query strings from every log.

### 5. [low] The CLI cannot run while `app` is crash-looping

§9 runs every command via `docker compose exec app`, which needs a running container. §12 makes a failed migration exit non-zero while Compose restarts it, so `app` crash-loops and no CLI command — `user passwd`, `db copy` — can run. Add to §9/README item 6: fall back to `docker compose run --rm app notes <command>`.

VERDICT: NOT READY — the image lifecycle (findings 1–2) is undefined enough to guarantee rework and silent breakage, and needs only a few sentences in §6.2/§6.5 before building.

END-OF-REVIEW