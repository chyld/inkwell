// A small MCP client for tests: an agent token for a user, connected to the app on a local port.
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Env } from './helpers.js';

export class McpTestClient {
  private constructor(private client: McpClient) {}

  static async connect(env: Env, username: string): Promise<McpTestClient> {
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(env.app.server.address() as { port: number }).port}`;
    const token = env.store.identity.addAgent(username, 'bot').token;
    const client = new McpClient({ name: 't', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return new McpTestClient(client);
  }

  /** create_note; returns the new note's id. */
  async createNote(title: string, content: string): Promise<string> {
    const r = await this.client.callTool({ name: 'create_note', arguments: { title, content } });
    if (r.isError) throw new Error(JSON.stringify(r.content));
    return /Created note ([0-9a-f-]{36})/.exec((r.content as { text: string }[])[0].text)![1];
  }

  async close() {
    await this.client.close();
  }
}
