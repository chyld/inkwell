# Notes

A private, self-hosted note-taking app for a handful of people (fewer than 10).
Each person has their own notes and nobody can see anyone else's. Notes are
written in a rich-text editor (headings, lists, task lists, code, quotes, links,
tables, resizable images, underline, text colours, highlights, fonts, text sizes and saved
text styles), organised in nested folders and with tags, and found with
full-text search. Deleted notes go to Trash until you empty it.

The screen ('Teal rail and paper'): a narrow teal **rail** of icons on the left
(All notes, Inbox, Folders, Tags; Fonts, Styles, Trash and your account; on a
phone it is a bar along the bottom), the **list** of notes as white cards, and
the **editor**: a slim line with the folder, tags, dates and save status, the
formatting toolbar as one dark pill, and the note on a sheet of paper with its
title at the top. Folders and Tags open a panel over the list; the account
button shows your storage and Sign out. Light and dark follow the device.

An AI agent (Claude Code, Codex, Grok, Muse, …) can **add** notes to one user's
Inbox through an MCP server at `https://<host>/mcp`, using a token you create.
An agent cannot read, list, search, change or delete anything.

It runs as two Docker containers: `app` (Node.js: web app, API, MCP endpoint and
SQLite database) and `caddy` (HTTPS with an automatic Let's Encrypt certificate).

> **There are no backups.** Nothing is backed up automatically or on a schedule.
> If the VPS disk is lost, every note is lost. To keep a copy, make one by hand
> (below) and store it somewhere else.

**Making a manual copy** (on the VPS, in the project directory):

```sh
docker compose exec app notes data copy /data/copy-2026-11-15
docker compose cp app:/data/copy-2026-11-15 ./copy-2026-11-15
docker compose exec app rm -rf /data/copy-2026-11-15
```

`data copy` writes a consistent copy of the database (`notes.db`) and all image
files into a new directory inside the data volume (image files never change, so
they are hard-linked there, which is instant and takes no extra space); `docker
compose cp` copies it out to the VPS's own disk, and from there you can `scp` it
to your own machine. The app keeps working during the copy (it only postpones
removing unused images until the copy is done). If an image file is missing
the copy fails and nothing is left behind; an interrupted copy leaves at most a
`<dir>.partial-<number>` directory, which the next copy to `<dir>` removes.
The copy leaves out the font store (`/data/fonts/`): font files are a cache that
the app fetches again from Google when needed (see section 12; a retired font
cannot be fetched again).
Delete the copy on the VPS when you have it elsewhere.

Contents:

1. [Prerequisites](#1-prerequisites)
2. [Check the hostname](#2-check-that-chyld-notesduckdnsorg-points-at-the-vps)
3. [Install and start](#3-get-the-code-onto-the-vps-configure-start)
4. [Users and agents](#4-create-the-first-user-and-an-agent)
5. [Connecting agent clients](#5-connecting-agent-clients)
6. [Updating and rolling back](#6-updating-to-a-new-version-and-rolling-back)
7. [Stopping, starting, logs](#7-stopping-starting-viewing-logs)
8. [Testing on your own machine](#8-testing-on-a-local-machine-with-notes_hostlocalhost)
9. [Troubleshooting](#9-troubleshooting)
10. [Command reference](#10-command-line-reference)
11. [Automated tests](#11-automated-tests)

---

## 1. Prerequisites

- A VPS with a fixed public IPv4 address running **Debian 13 ("trixie")**
  (Debian 12 "bookworm" also works). 1 GB of RAM is enough to run it; building
  the image is the most memory-hungry step (if a build is killed for lack of
  memory, add a swap file).
- Ports **80 and 443 (TCP)** open to the internet, plus **443/UDP** if you want
  HTTP/3 (optional). Port 80 is needed for Let's Encrypt to issue and renew the
  certificate, and for the redirect to HTTPS.
  - If your VPS provider has a firewall in its control panel, allow inbound
    TCP 80, TCP 443 and UDP 443 there.
  - If you use `ufw` on the VPS:

    ```sh
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 443/udp
    ```

    (Docker publishes ports through its own iptables rules, so check the
    provider's firewall as well.)
- **Docker Engine with the Compose plugin.** Install it from Docker's own
  Debian repository:

  ```sh
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"   # then log out and back in, so you can run docker without sudo
  docker compose version            # should print "Docker Compose version v2…" or later
  ```

Nothing else is needed on the VPS: Node.js, the database and Caddy all run in
the containers.

## 2. Check that `chyld-notes.duckdns.org` points at the VPS

On the VPS:

```sh
getent ahostsv4 chyld-notes.duckdns.org | head -1     # the address the name resolves to
ip -4 addr show scope global | grep inet               # the VPS's own address(es)
```

The first address must be the VPS's public IP (the one shown in your provider's
control panel; on some providers the VPS only sees a private address, in which
case compare with the control panel). If it is not, log in at
<https://www.duckdns.org>, set the IP of `chyld-notes` to the VPS's address and
wait a minute.

No DuckDNS token is needed by this app: Caddy gets the certificate over ports
80/443 (the HTTP challenge). `duckdns.org` is on the Public Suffix List, so
Let's Encrypt's rate limits apply to `chyld-notes.duckdns.org` alone, not to
all of DuckDNS.

## 3. Get the code onto the VPS, configure, start

The code is in a git repository on your workstation (it has no remote). Copy it
to the VPS as a git bundle, which keeps the history (needed for rolling back):

On your workstation, in the project directory:

```sh
git bundle create /tmp/notes.bundle --all
scp /tmp/notes.bundle you@your-vps:
```

On the VPS:

```sh
git clone ~/notes.bundle ~/notes
cd ~/notes
cp .env.example .env
nano .env        # check NOTES_HOST=chyld-notes.duckdns.org (a bare hostname)
docker compose up -d --build
```

The first build takes a few minutes. Then:

```sh
docker compose ps
```

should show `app` as `Up … (healthy)` and `caddy` as `Up`. Caddy only starts
once the app is healthy. Within a minute Caddy obtains the certificate; watch it
with `docker compose logs -f caddy` (look for `certificate obtained
successfully`). Open <https://chyld-notes.duckdns.org>: you should see the
sign-in page with a valid certificate.

`.env` settings (all non-secret; `.env` is not committed):

| Setting | Default | Meaning |
|---|---|---|
| `NOTES_HOST` | (required) | The public hostname, bare: `chyld-notes.duckdns.org`. With a scheme, port or slash the app refuses to start and logs the expected form. |
| `NOTES_USER_QUOTA_MB` | `1024` | Storage limit per user in MB (note bodies plus images, Trash included). |
| `NOTES_AGENT_RATE_PER_HOUR` | `60` | Notes each agent may create per hour. |

After changing `.env`, run `docker compose up -d` to apply it.

The data lives in Docker named volumes: `notes-data` (database and images,
mounted at `/data` in the app) and Caddy's `caddy-data` / `caddy-config`
(certificates). Compose prefixes them with the project name, so on the VPS they
are `notes_notes-data`, `notes_caddy-data` and `notes_caddy-config`.
`docker compose down` keeps them; **`docker compose down -v` deletes all notes.**

## 4. Create the first user and an agent

Users and agents are managed only on the server with the `notes` command. With
the app running:

```sh
docker compose exec app notes user add chyld
```

It asks for a password twice (at least 12 characters). Or let it make one:

```sh
docker compose exec app notes user add chyld --generate
```

which prints a random password once. Sign in at
<https://chyld-notes.duckdns.org>. Every user gets an **Inbox** folder.

To let an agent add notes for that user, create an agent (one per client is a
good idea, so you can revoke them separately):

```sh
docker compose exec app notes agent add chyld "Claude Code"
```

This prints the agent's token **once** (it starts with `nta_`) together with the
ready-to-paste commands for each client in section 5. Only a hash of the token is
stored; if you lose it, revoke the agent and add a new one under another name
(for example "Claude Code 2"): a revoked agent keeps its name in `agent list`. Notes the agent
creates land in that user's Inbox, marked "by Claude Code".

Revoke an agent (its token stops working immediately; its notes stay):

```sh
docker compose exec app notes agent revoke chyld "Claude Code"
```

## 5. Connecting agent clients

The MCP server is at `https://chyld-notes.duckdns.org/mcp` (Streamable HTTP,
stateless, JSON responses). Every client authenticates with the header
`Authorization: Bearer <token>`. It offers exactly one tool, `create_note`
(`title`, `content` as Markdown, optional `tags`). OAuth is not supported, so
claude.ai web connectors cannot use it; the command-line clients below can.

> **Status: not yet verified.** The four configurations below were written from
> each client's `--help` output on 2026-11-15 (Claude Code `claude mcp add`,
> Codex CLI 0.169.0, Grok 1.0.77, Muse Code 1.4.20). None has yet been tried
> by hand against a deployment. The server side was tested with the official
> MCP SDK client (both the 2025 `initialize` handshake and the 2026-07-28
> `server/discover` revision). If a client cannot be made to work with a static
> bearer token, that will be reported here.

**Worked example.** Suppose `notes agent add chyld "Claude Code"` printed the
token `nta_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample12`. Then:

### Claude Code — not yet verified

```sh
claude mcp add --transport http --scope user notes https://chyld-notes.duckdns.org/mcp \
  --header "Authorization: Bearer nta_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample12"
claude mcp list        # "notes" should show as connected
```

Then ask Claude Code, for example, "put a summary of this in my notes".

### Codex — not yet verified

Codex reads the token from an environment variable. Add the export to your
shell profile (`~/.bashrc`, `~/.zshrc`) so it is set whenever Codex runs:

```sh
export NOTES_MCP_TOKEN=nta_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample12
codex mcp add notes --url https://chyld-notes.duckdns.org/mcp --bearer-token-env-var NOTES_MCP_TOKEN
codex mcp list
```

### Grok — not yet verified

```sh
grok mcp add notes https://chyld-notes.duckdns.org/mcp --transport http \
  --header "Authorization: Bearer nta_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample12"
grok mcp doctor        # checks configuration and connectivity
```

### Muse — not yet verified

Muse can read the token from an environment variable (as for Codex):

```sh
export NOTES_MCP_TOKEN=nta_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample12
muse mcp add notes --url https://chyld-notes.duckdns.org/mcp --bearer-token-env-var NOTES_MCP_TOKEN --user
muse mcp get notes
```

(`muse mcp add notes --url … -H "Authorization: Bearer nta_…" --user` is the
alternative that stores the token in Muse's user settings.)

### Checking a token by hand

```sh
curl -sS https://chyld-notes.duckdns.org/mcp \
  -H "Authorization: Bearer nta_…" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A working token returns the `create_note` tool; a missing, wrong or revoked
token, or one whose user is disabled, returns HTTP 401.

## 6. Updating to a new version, and rolling back

To update, bring the new code onto the VPS and rebuild. With a new bundle from
your workstation (`git bundle create /tmp/notes.bundle --all`, `scp` as before):

```sh
cd ~/notes
git log --oneline -1                 # note the current version, for a rollback
git pull ~/notes.bundle master
docker compose up -d --build
docker compose ps                    # app should become healthy again
docker compose logs --tail 50 app
```

**What happens to the database.** When the new version starts and has database
changes (migrations) to apply, it first writes a snapshot of the database to
`/data/pre-upgrade.db` (replacing any earlier one), then applies the changes in
one transaction. If a change fails, the app exits with a clear log line and the
database is left exactly as it was. The snapshot does **not** include images,
and it is a safety net for one update, not a backup.

**Rolling back a failed update:**

1. Stop both services:

   ```sh
   docker compose stop
   ```

2. If the new version did start and you want to go back to the database as it
   was before the update, put the snapshot in place of the database and delete
   the database's `-wal` and `-shm` files:

   ```sh
   docker compose run --rm --no-deps app sh -c \
     'cp /data/pre-upgrade.db /data/notes.db && rm -f /data/notes.db-wal /data/notes.db-shm'
   ```

   **Warning: every note created or changed after the snapshot was taken (that
   is, since the update started) is lost.** (If the update failed during the
   migration, the database was not changed and you can skip this step.)

3. Check out the previous version and start it:

   ```sh
   git checkout <previous-commit>      # from `git log --oneline`
   docker compose up -d --build
   ```

When you are ready to try again, `git checkout master` and update as above.

## 7. Stopping, starting, viewing logs

Run these in the project directory (`~/notes`):

| What | Command |
|---|---|
| Start (or apply `.env` changes) | `docker compose up -d` |
| Stop (keeps all data) | `docker compose stop` |
| Stop and remove containers (keeps all data) | `docker compose down` |
| Restart | `docker compose restart` |
| Status | `docker compose ps` |
| Logs, both services, follow | `docker compose logs -f` |
| App logs only | `docker compose logs -f app` |
| Caddy logs only | `docker compose logs -f caddy` |

Both services restart automatically after a crash or a reboot
(`restart: unless-stopped`), unless you stopped them yourself.

Logs record method, path (without query string), status and duration. They
never contain passwords, session ids, agent tokens, the `Authorization`,
`Cookie` or `Set-Cookie` headers, or request bodies.

## 8. Testing on a local machine with `NOTES_HOST=localhost`

You can run the whole thing on your own computer first (Docker with the Compose
plugin required; ports 80 and 443 must be free):

```sh
cp .env.example .env
sed -i 's/^NOTES_HOST=.*/NOTES_HOST=localhost/' .env
docker compose -p notes-dev up -d --build
docker compose -p notes-dev exec app notes user add me
```

(`-p notes-dev` keeps the local test separate from anything else; use it on
every command.) With `NOTES_HOST=localhost` Caddy does not contact Let's
Encrypt; it creates its own local certificate authority and serves a
certificate from it. Your browser and agent clients will refuse that
certificate until you tell them to trust that authority. **Do not switch
certificate checking off; trust the local root certificate instead.**

Copy the root certificate out of the Caddy volume:

```sh
docker compose -p notes-dev cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-local-root.crt
curl --cacert ./caddy-local-root.crt https://localhost/healthz      # {"ok":true}
```

**Browser.**

- Chrome / Chromium / Edge on Linux: Settings → Privacy and security →
  Security → Manage certificates → Authorities (or "Custom" → "Installed by
  you") → Import `caddy-local-root.crt`, tick "Trust this certificate for
  identifying websites". From a terminal, the same is
  `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n caddy-local -i caddy-local-root.crt`
  (package `libnss3-tools`).
- Firefox: Settings → Privacy & Security → Certificates → View Certificates →
  Authorities → Import, tick "Trust this CA to identify websites".
- macOS: open the file in Keychain Access, add it to the "System" keychain, and
  set "When using this certificate" to "Always Trust".
- Windows: `certutil -addstore -f Root caddy-local-root.crt` in an
  administrator prompt, or import it into "Trusted Root Certification
  Authorities" with `certmgr.msc`.

Then open <https://localhost> and sign in. Remove the authority again when you
are done testing.

**Agent clients** (create an agent with
`docker compose -p notes-dev exec app notes agent add me test`, then use the
commands from section 5 with `https://localhost/mcp`). These settings were
found in each client's documentation or program and are **not yet verified**:

- Claude Code (Node.js): start it with
  `NODE_EXTRA_CA_CERTS=/path/to/caddy-local-root.crt claude`; this adds the
  authority to the normal ones.
- Codex, Grok and Muse read `SSL_CERT_FILE` (Codex also
  `CODEX_CA_CERTIFICATE`). These replace the system list, so give them a bundle
  that contains the system authorities plus Caddy's, or the client will no
  longer reach its own AI service:

  ```sh
  cat /etc/ssl/certs/ca-certificates.crt caddy-local-root.crt > notes-local-bundle.pem   # macOS: /etc/ssl/cert.pem
  CODEX_CA_CERTIFICATE=$PWD/notes-local-bundle.pem codex
  SSL_CERT_FILE=$PWD/notes-local-bundle.pem grok
  SSL_CERT_FILE=$PWD/notes-local-bundle.pem muse
  ```

**If port 80 or 443 is already in use** on your machine, you can publish Caddy
on other ports with an override file that stays on your machine:

```yaml
# docker-compose.override.yml (not committed)
services:
  caddy:
    ports: !override
      - "127.0.0.1:8080:80"
      - "127.0.0.1:8443:443"
```

The MCP endpoint then works at `https://localhost:8443/mcp`, but **signing in
from a browser will not**: the app accepts browser requests only from the exact
origin `https://localhost` (port 443). Free port 443 for browser testing.

Remove the local test completely (containers, volumes and image) with:

```sh
docker compose -p notes-dev down -v --rmi local
```

## 9. Troubleshooting

**The certificate is not issued** (browser shows a certificate error, Caddy logs
show `could not get certificate` or `challenge failed`):
- Check the name points at the VPS (section 2).
- Check ports 80 and 443 are reachable from outside, including the provider's
  firewall: from another machine, `curl -I http://chyld-notes.duckdns.org`
  should get an answer (a redirect) from Caddy.
- `docker compose logs caddy | grep -i -E 'error|challenge'` shows the reason.
- After several failures Let's Encrypt rate-limits the name for a while; fix
  the cause, then `docker compose restart caddy` and wait. Caddy retries by
  itself.

**A port is already in use** (`docker compose up` reports `bind: address already
in use` for 80 or 443): something else is listening there, often another web
server. Find it with `sudo ss -ltnp 'sport = :80'` (and `:443`), stop and
disable it (for example `sudo systemctl disable --now apache2` or `nginx`),
then `docker compose up -d`.

**"Pool overlaps with other one on this host"** when starting: the Compose
network uses the fixed subnet `172.30.87.0/24`, and another Docker network
already uses it. Pick another private /24 and change it in
`docker-compose.yml` in **both** places (`networks: notes: ipam` and
`NOTES_TRUSTED_PROXY`), then `docker compose up -d`.

**Forgotten password:** set a new one on the server (this also signs that user
out everywhere):

```sh
docker compose exec app notes user passwd chyld
```

**Too many failed sign-ins:** after 5 failures for one username from one address
(or 20 from one address) sign-in is blocked for 15 minutes for that pair (or
address). Wait, or restart the app (`docker compose restart app`), which clears
the counters.

**The hostname no longer resolves** (or points at an old IP): DuckDNS names must
be kept pointing at the VPS. Log in at <https://www.duckdns.org> and set the IP
for `chyld-notes` to the VPS's address. Certificate renewals also need this. No
change to the app is needed afterwards; Caddy retries automatically.

**Storage limit reached** ("Not saved: your storage limit has been reached",
uploads refused): notes in Trash still count. Empty Trash, or delete large notes
and images. Deleted notes free their space at once. An image is removed only
once it is more than 24 hours old and no note (Trash included) uses it; that
check runs when Trash is emptied or a note is deleted permanently, and once a
day. So an image uploaded today keeps counting until tomorrow, even after
Empty Trash. To raise the limit for everyone, set
`NOTES_USER_QUOTA_MB` in `.env` and run `docker compose up -d`. Check usage with
`docker compose exec app notes user list`.

**The app does not start after an update:** `docker compose ps` shows `app` not
healthy and `caddy` not started.
- `docker compose logs --tail 100 app` shows why.
- `configuration error: NOTES_HOST=… is not a bare hostname`: fix `.env`
  (for example `NOTES_HOST=chyld-notes.duckdns.org`, without `https://`), then
  `docker compose up -d`.
- `database migration failed, not starting`: the database was left unchanged.
  Roll back to the previous version (section 6, skipping step 2) and report the
  log line.
- A build error during `--build`: run `docker compose build --no-cache app` and
  read the first error; out-of-memory kills during the build need more RAM or a
  swap file.

## 10. Command-line reference

Run on the VPS in the project directory as `docker compose exec app notes
<command>`, or, when the app container is not running,
`docker compose run --rm app notes <command>`. It is safe to use while the app
is running.

| Command | Effect |
|---|---|
| `user add <username>` | Create a user and their Inbox. Prompts for a password twice, or `--generate` prints a random one once. Usernames: 3-32 characters, `a-z 0-9 - _` (input is lower-cased). |
| `user list` | Username, created date, enabled/disabled, note count, storage used, agent count. |
| `user passwd <username>` | Set a new password; ends that user's sessions. |
| `user disable <username>` / `user enable <username>` | Block or allow sign-in; disabling ends sessions and makes the user's agents get 401. |
| `user delete <username>` | Delete the user and all their notes, folders, tags, images and agents, after you type the username to confirm. |
| `agent add <username> <agent-name>` | Create an agent; prints its token once with the client configurations. |
| `agent list [<username>]` | Agent name, owner, created, last used, notes created, revoked or not. |
| `agent revoke <username> <agent-name>` | The token stops working at once; its notes stay. |
| `data copy <dir>` | Consistent copy of the database (font collections included) and the image files into the new directory `<dir>` (see the top of this file); the font store `/data/fonts/` is left out. |

Passwords can also be piped (two lines), for example from a password manager:
`printf '%s\n%s\n' "$PW" "$PW" | docker compose exec -T app notes user passwd chyld`.

## 11. Automated tests

Acceptance criteria 2-16 of `SPEC.md` are covered by automated tests (Vitest),
run with one command from the project directory on a machine with Node.js 26
(or 24.7+), npm, and a C/C++ toolchain for `better-sqlite3` (`python3`, `make`,
`g++`):

```sh
npm ci
npm test
```

| Criterion | Test file(s) |
|---|---|
| 2 isolation between users | `test/isolation.test.ts`, `test/images.test.ts` |
| 3 every element survives save, reload, search (browser and agent) | `test/roundtrip.test.ts`, `test/editor-roundtrip.test.ts` |
| 4 MCP handshake, tools, token/cookie separation (MCP SDK client) | `test/mcp.test.ts` |
| 5 revoked token, disabled user | `test/mcp.test.ts`, `test/cli.test.ts` |
| 6 search | `test/search.test.ts` |
| 7 conflicts, keep mine / load theirs | `test/conflict.test.ts`, `test/saver.test.ts` |
| 8 unsafe agent Markdown; over-size, over-quota, over-rate | `test/mcp.test.ts` |
| 9 sign-in limits behind the proxy | `test/signin-limit.test.ts` |
| 10 images | `test/images.test.ts` |
| 11 session expiry and ending | `test/sessions.test.ts` |
| 12 Origin check | `test/origin.test.ts` |
| 13 folders and Trash | `test/folders-trash.test.ts` |
| 14 storage limit | `test/quota.test.ts`, `test/images.test.ts`, `test/mcp.test.ts` |
| 15 CLI commands; failing migration | `test/cli.test.ts` |
| 16 no secrets in logs | `test/logs.test.ts` |

The Fonts feature's acceptance criteria (`FONTS-SPEC.md` section 11) run in the
same `npm test`, with no network: the upstream fetcher is replaced, and Google's
answers recorded from the live service on 2026-11-15 are in
`test/fixtures/fonts/`.

| Fonts criterion | Test file(s) |
|---|---|
| 1 search, category, "N of T", no retired families | `test/web/fonts-page.test.tsx` |
| 2 rendered rows, at most 6 loading, jumping, dropped cards | `test/web/fonts-loader.test.ts`, `test/web/fonts-page.test.tsx` |
| 3 collection row, editor menu, reload, privacy | `test/fonts-api.test.ts`, `test/web/fonts-page.test.tsx`, `test/web/fonts-editor.test.tsx` |
| 4 the 50 limit, parallel adds, failed downloads | `test/fonts-api.test.ts` |
| 5 applying a font, Default font | `test/web/fonts-editor.test.tsx` |
| 6 a font no longer in the collection | `test/web/fonts-editor.test.tsx`, `test/fonts-schema.test.ts` |
| 7 server refusals | `test/fonts-schema.test.ts` |
| 8 paste rules, the 51st font | `test/web/fonts-editor.test.tsx` |
| 9 crafted ids and hashes | `test/fonts-api.test.ts` |
| 10 upstream answers accepted and rejected | `test/fonts-stylesheet.test.ts`, `test/fonts-store.test.ts` |
| 11 shared operations, slots, queue, time limits | `test/fonts-store.test.ts` |
| 12 Google unreachable | `test/fonts-api.test.ts`, `test/web/fonts-editor.test.tsx` |
| 13 cap and eviction | `test/fonts-store.test.ts` |
| 14 reconciliation | `test/fonts-store.test.ts` |
| 15 headers, sessions, Origin, rate limit, retired, no-store | `test/fonts-api.test.ts` |
| 16 registering fonts on open, restore, conflict, paste, undo; failures | `test/web/fonts-editor.test.tsx` |
| 17 agents cannot set fonts | `test/fonts-schema.test.ts` |
| 18 data copy, user deletion | `test/fonts-store.test.ts` |
| 19 the snapshot and the generator | `test/font-catalogue.test.ts` |
| 20 CSP, bad setting, logs | `test/fonts-api.test.ts` |
| 21 `/fonts` routing | `test/web/fonts-page.test.tsx` |
| 22 preview names, 400 limit, shared queue, sign-out | `test/web/fonts-loader.test.ts`, `test/web/fonts-page.test.tsx` |
| 23 "Mixed", no selection | `test/web/fonts-editor.test.tsx` |

The Text styles feature's acceptance criteria (`STYLES-SPEC.md` section 12) run
in the same `npm test`, with no network:

| Styles criterion | Test file(s) |
|---|---|
| 1 create, trim, order | `test/styles-api.test.ts` |
| 2 refusals, races, limits, renaming | `test/styles-api.test.ts` |
| 3 retired and uncollected fonts | `test/styles-api.test.ts`, `test/web/styles-page.test.tsx`, `test/web/styles-editor.test.tsx` |
| 4 other users, user deletion | `test/styles-api.test.ts`, `test/web/styles-page.test.tsx` |
| 5-9 applying a style | `test/web/styles-editor.test.tsx` |
| 10 a style is a stamp | `test/styles-api.test.ts` |
| 11 Save selection as style | `test/web/styles-editor.test.tsx` |
| 12 the style form | `test/web/styles-page.test.tsx` |
| 13 the Styles menu | `test/web/styles-editor.test.tsx`, `test/web/styles-page.test.tsx` |
| 14, 15 the `/styles` page and its routing | `test/web/styles-page.test.tsx` |
| 16 the shared font loader | `test/web/styles-loader.test.tsx`, `test/web/styles-editor.test.tsx` |
| 17 the note schema is unchanged | `test/styles-api.test.ts` |
| 18 Origin, session, no-store | `test/styles-api.test.ts` |
| 19 names as plain text, logs | `test/styles-api.test.ts`, `test/web/styles-page.test.tsx`, `test/web/styles-editor.test.tsx` |

`DEVIATIONS.md` lists where the implementation interprets an ambiguous point of
the specification.

## 12. Fonts

Each person can browse the Google Fonts catalogue at **`/fonts`** (the "Fonts"
button on the rail), search it, filter it by category, and add up to 50 fonts
to their own collection. In a note, the toolbar's font menu lists that
collection; choose a font to apply it to the selected text, or "Inter" (the
app's default font, first in the menu) to remove it. Collections are private. Latin text only, in regular and bold,
upright and italic.

**Outbound access.** Browsers never contact Google: the app fetches font files
from `fonts.googleapis.com` and `fonts.gstatic.com` (HTTPS, port 443) the first
time they are needed and serves them itself. The app container therefore needs
outbound HTTPS to those two hosts. Without it, fonts already fetched keep
working, adding a new font answers "This font could not be downloaded. Try again
later.", and nothing else is affected.

**The font store** is `/data/fonts/` in the data volume: one shared cache for
all users, not counted toward anyone's storage limit. `NOTES_FONT_CACHE_MB` in
`.env` caps it (default `500`; a whole number of at least `50`, or the app does
not start). When it is full, the note-font files of fonts that nobody has in a
collection are removed, least recently used first; previews, fonts in a
collection and retired fonts are kept. If even that cannot make room, adding a
font answers "The font store is full."

**Backups.** `notes data copy` includes everyone's collections (they are in the
database) but leaves `/data/fonts/` out. After restoring such a copy the app
notices at start-up that the font files are missing and fetches them again from
Google as they are used. The one exception is a *retired* font (one Google no
longer lists): it may no longer be downloadable, so after a restore text in a
retired font shows in a fallback font.

**The catalogue** is a snapshot shipped with the app,
`src/shared/font-catalogue.json` (1,839 families on 2026-11-15); the running app
needs no Google account or key and never refreshes it. To update it, on a
developer machine with internet access:

```sh
npm run fonts:catalogue              # or: npm run fonts:catalogue -- --from listing.json
git diff --stat src/shared/font-catalogue.json
```

The script reads Google's public listing (`https://fonts.google.com/metadata/fonts`),
prints the families added, retired and un-retired, and refuses to write anything
if two families would share an id or the listing's format is not what it
expects. Ids never change and are never removed: a family Google drops is marked
retired (hidden on `/fonts`, still working where it is already used). Commit the
file and rebuild the image (section 6) to ship it.

## 13. The app's own fonts

All interface and note text is set in **Inter**, and inline code and code blocks
in **JetBrains Mono**, on every device. Both are part of the app: static WOFF2
files in `src/web/fonts/default/`, built into the web bundle (hashed under
`/assets/`, cached for a year like the other assets) and served by the notes
server. Neither the browser nor the running server contacts Google for them, and
they do not depend on the `/fonts` store or on outbound network access. Fonts
chosen from `/fonts` (section 12) still apply to the text that carries them.

| File | Family, style | Weights | Version | Bytes |
|---|---|---|---|---|
| `inter-latin-upright.woff2` | Inter, upright, Latin | 100-900 (variable) | 4.001 | 48,256 |
| `inter-latin-italic.woff2` | Inter, italic, Latin | 100-900 (variable) | 4.001 | 51,832 |
| `inter-latin-ext-upright.woff2` | Inter, upright, Latin Extended | 100-900 (variable) | 4.001 | 85,068 |
| `inter-latin-ext-italic.woff2` | Inter, italic, Latin Extended | 100-900 (variable) | 4.001 | 91,900 |
| `jetbrains-mono-latin-upright.woff2` | JetBrains Mono, upright, Latin | 100-800 (variable) | 2.211 | 40,404 |
| `jetbrains-mono-latin-italic.woff2` | JetBrains Mono, italic, Latin | 100-800 (variable) | 2.211 | 42,964 |
| `jetbrains-mono-latin-ext-upright.woff2` | JetBrains Mono, upright, Latin Extended | 100-800 (variable) | 2.211 | 15,196 |
| `jetbrains-mono-latin-ext-italic.woff2` | JetBrains Mono, italic, Latin Extended | 100-800 (variable) | 2.211 | 16,520 |

392,140 bytes in all; a page downloads only the slices and styles it uses (the
upright Latin Inter file, 48 KB, on every page and preloaded; the others only
when italic, code or Latin Extended characters appear).

**Where they came from.** Downloaded once, on 2026-11-15, from Google Fonts:
the stylesheets
`https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900`
(files under `https://fonts.gstatic.com/s/inter/v20/`) and
`https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800`
(files under `https://fonts.gstatic.com/s/jetbrainsmono/v24/`), keeping only the
`latin` and `latin-ext` blocks; their `unicode-range` values are copied into the
`@font-face` rules at the top of `src/web/styles.css`. The version numbers above
are the ones inside the font files. Both fonts are under the SIL Open Font
License 1.1; the licence texts (`Inter-OFL.txt`, `JetBrainsMono-OFL.txt`, each
with the copyright notice from its font file) are kept next to the files in the
repository.

To update them, download the same two stylesheets again with a current browser
User-Agent, replace the eight files and the `unicode-range` values, and rebuild.

## 14. Text styles

A style is a named set of text formatting: font, size, bold, italic,
underline, strikethrough, text colour and highlight. Each person keeps up to
50 of their own at **`/styles`** (the "Styles" button on the rail), where
they are shown as cards and can be created, edited and deleted. In a note, the
toolbar's first button, **Styles**, lists them: choosing one sets exactly those
eight things on the selected text (or, with no selection, on what is typed
next). "Save selection as style…" in the same menu starts a new style from the
formatting of the selected text.

A style is a stamp, not a link: the text keeps no record of the style it came
from, so editing or deleting a style later changes no note. The **Styles**
button shows the name of a style when the text at the cursor, or every piece of
the selected text, has exactly that style's eight settings (found by comparing,
so hand-formatted text that happens to match shows the name too, and text
stamped before a style was edited shows **Styles**). It reads **Mixed** when the
selected pieces differ, as the font button does. Styles are private
to each person, are stored in the database (so `notes data copy` includes them),
and are deleted with their owner. Agents cannot use them.
