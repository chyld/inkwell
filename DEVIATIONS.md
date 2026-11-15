# Deviations and interpretations

Where SPEC.md (draft 3) was ambiguous or could not be followed literally, this
is what was done. Section 2 decisions are unchanged.

| # | Spec says | What was done | Why |
|---|---|---|---|
| 1 | 4.1: `PUT /notes/:id` returns 409 "with the current version" | 409 body is `{ "error": { "code": "version_conflict", "message", "version": <n> } }` | Keeps the one error format of 4.1 while carrying the version. |
| 2 | 6.3: save rejected if note is in Trash; no status given | 409 with code `in_trash`; the editor shows it as "Not saved" and does not retry | Distinct from a version conflict, not a 404 (the note exists). |
| 3 | 6.1/7.2: "updated" timestamp | Only title/body saves change `updated_at`; folder, tag and Trash changes do not | Matches `version`, which those changes also leave alone. |
| 4 | 7.1: folder view | A folder view lists the notes directly in that folder; search narrowed to a folder includes subfolders (as 7.3 says) | Simplest reading. |
| 5 | 6.2: tables "with an optional header row" | Header cells are accepted only in the first row; every row must have the same number of cells; pasted tables lose spans and column widths | Enforces "header row" and "no merged cells" on the server and on paste. |
| 6 | 5: size units | 1 MB = 1,048,576 bytes; `NOTES_USER_QUOTA_MB` is in MiB (default 1024 = 1 GiB) | One consistent binary unit. |
| 7 | 8.2: permitted methods `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` | Those are served exactly as written (2025 protocol, stateless, JSON responses). `server/discover` is also accepted, because the current stable MCP TypeScript SDK (v2, `@modelcontextprotocol/server` 2.4) implements the 2026-07-28 protocol revision, where `server/discover` replaces `initialize` and `ping` no longer exists. Every other method gets JSON-RPC -32601; an unknown tool name gets -32602; batches get -32600. | The instructions require the current stable SDK; serving both revisions keeps 2025-era and 2026-era clients working. Tests cover both. |
| 8 | 8.2: "no SSE stream" | `responseMode: 'json'`: every POST is answered with one JSON body (or 202 for a notification). The tool capability is advertised with `listChanged: false`. | As specified. |
| 9 | 8.3: title "1-200 characters" | Title is trimmed and control characters removed, then 1-200 Unicode code points. | "Characters" read as code points. |
