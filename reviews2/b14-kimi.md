# Review of SPEC.md draft 2

### 1. [high] X-Forwarded-For handling assumption is wrong for Caddy

Section 5 states Caddy overwrites `X-Forwarded-For`; Caddy's `reverse_proxy` actually *appends* to a client-supplied header, so a forged value survives and defeats the sign-in rate limit (and criterion 13.9's test). Change §5/§12: the Caddyfile must explicitly replace the header (`header_up X-Forwarded-For {client_ip}` style) and Fastify must use only the proxy-appended rightmost entry.

### 2. [medium] Images in a brand-new, never-saved note are undefined

§6.5 requires every image row to reference a note id, but §10/§6.3 never say when a new note exists server-side; an upload during a first edit has no note id. Change §6.3/§10: creating a note via "New note" must create the server row (version 1) before the editor opens and before any image upload, so uploads always have a note id.

### 3. [medium] Tag/folder changes bump version and collide with an open editor

§6.1 increments `version` on folder or tag changes; §6.3 autosaves require matching version. Editing a note while changing its tags (autocomplete, §7.2) forces a spurious 409 and the "keep mine / load theirs" dialog mid-typing. Change §6.3: tag/folder operations should return the new version, and a 409 whose only difference is metadata should update silently rather than prompt.

### 4. [medium] Session idle-expiry mechanics are unspecified

§5 ends sessions after "30 days without use" but never says activity is recorded (a `last_used` column updated per request) or how often. Change §5: state that each authenticated request updates `last_used` (e.g., at most once per minute) and that expiry compares against it; otherwise 30-day idle expiry is unimplementable as written.

### 5. [low] Non-POST methods on `/mcp` under-specified

§8.2 only states GET and DELETE return 405; OPTIONS, HEAD, PUT etc. are unmentioned, leaving behaviour to framework defaults (HEAD auto-maps to GET, CORS preflights undefined). Change §8.2: every method other than POST returns 405 with no CORS headers.

VERDICT: READY TO BUILD once finding 1 is corrected and findings 2–4 are clarified, since none require redesign — only tighter specification of Caddy's header handling and a few edge-case definitions.

END-OF-REVIEW
