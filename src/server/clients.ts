// Client configurations printed by `notes agent add` (SPEC 8.4, 9). Each was
// written from the client's own --help output; see README "Connecting agents".
export function clientInstructions(url: string, token: string): string {
  return `Claude Code:
  claude mcp add --transport http --scope user notes ${url} --header "Authorization: Bearer ${token}"

Codex (reads the token from an environment variable; put the export in your shell profile):
  export NOTES_MCP_TOKEN=${token}
  codex mcp add notes --url ${url} --bearer-token-env-var NOTES_MCP_TOKEN

Grok:
  grok mcp add notes ${url} --transport http --header "Authorization: Bearer ${token}"

Muse (reads the token from an environment variable; put the export in your shell profile):
  export NOTES_MCP_TOKEN=${token}
  muse mcp add notes --url ${url} --bearer-token-env-var NOTES_MCP_TOKEN --user

Any other MCP client: Streamable HTTP at ${url} with the header
  Authorization: Bearer ${token}`;
}
