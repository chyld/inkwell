# Code review b02 (sonnet): sign-in, sessions, rate limiting, Origin, proxy/IP, headers, logging

Scope read: SPEC.md, DEVIATIONS.md, src/server/{app,api,ratelimit,config,main,store,mcp,images,db,passwords}.ts, Caddyfile, docker-compose.yml, Dockerfile, and the sign-in, session, origin and log tests. Origin check, cookie attributes, session expiry, proxy trust, MCP auth separation and log redaction all match SPEC. Only the items below are real defects.

### 1. [medium] Sign-in limit is bypassed by concurrent requests
Where: src/server/api.ts:44-50 (with src/server/ratelimit.ts:153-165)

`isBlocked` runs before the awaited Argon2 check, and `recordFailure` runs only after it finishes. A burst of N parallel POSTs for one username from one IP all pass the check before any failure is recorded. That gives N guesses instead of 5, and N threadpool-bound 64 MiB hashes. Fix: record a provisional attempt synchronously before awaiting, and remove it on success. test/signin-limit.test.ts is sequential only, so it misses this.

### 2. [low] IPv6 clients can rotate addresses to evade both limits
Where: src/server/api.ts:43 (keys in src/server/ratelimit.ts:154,159)

`req.ip` is used verbatim as the rate-limit key. One IPv6 host normally controls a whole /64, so an attacker can send each guess from a new address. Neither the 5-per-pair nor the 20-per-IP limit then ever triggers against a known username. Fix: key IPv6 addresses by their /64 prefix (keep full IPv4 addresses). Matters only if the hostname has an AAAA record.

### 3. [low] A sign-in that is already running survives a password change
Where: src/server/store.ts:221-229 and src/server/api.ts:47-53

`checkCredentials` reads the user row and verifies against the old hash. That takes an async Argon2 run of roughly 100 ms. If the CLI `user passwd` (which deletes all sessions) commits inside that window, `createSession` still runs afterwards. The old-password holder then gets a live session, contrary to SPEC 5. Fix: re-read the user's `password_hash` and `disabled` inside the same transaction that inserts the session, and refuse if they changed.

VERDICT: SHIP AFTER FIXES — the sign-in limiter can be defeated by parallel requests (finding 1), and everything else in the focus area matches SPEC.
END-OF-REVIEW
