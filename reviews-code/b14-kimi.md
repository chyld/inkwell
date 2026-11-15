# Code review: b14-kimi

Deployment focus (SPEC 12): Dockerfile, docker-compose.yml, Caddyfile, .env.example and README are all correct and complete — non-root user with `/data` pre-owned, only Caddy publishing ports, fixed subnet matching `NOTES_TRUSTED_PROXY`, healthz-gated Caddy start, pre-upgrade snapshot/rollback as specified, honest backup warnings, and every required README section (1-9) present and accurate against the code. I verified the rest by reading all of `src/`, the shared schema/Markdown converter, and the tests (which genuinely exercise what they claim, e.g. logs redaction, forged `X-Forwarded-For`, quota-per-transaction, migration failure).

One finding:

### 1. [medium] Agent client configurations never verified by hand, contra SPEC 8.4
Where: README.md:207
SPEC 8.4 requires each of the four clients (Claude Code, Codex, Grok, Muse) to be checked by hand before hand-over, with the working configuration in the README. README section 5 and `clients.ts` state all four were "written from `--help` output" and tried zero times; flags like `--bearer-token-env-var` and `grok mcp doctor` may not exist, so the owner may find no client connects. Fix: run each documented command once against a deployment, correct README/`clients.ts`, and report any client that cannot work with a static bearer token.

VERDICT: SHIP AFTER FIXES — the deployment path itself (image, compose, Caddy, README for SPEC 12, tests) is sound; only verify the four documented agent-client setups before hand-over.

END-OF-REVIEW
