// The MCP endpoint (SPEC 8). Stateless Streamable HTTP with JSON responses,
// one tool (create_note), agent bearer tokens only.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createMcpHandler, isLegacyRequest, McpServer, WebStandardStreamableHTTPServerTransport, type McpRequestContext } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { errorBody, type AppOptions } from './http.js';
import { MiB } from './units.js';
import { AppError } from './errors.js';
import type { AgentAuth, Store } from './store.js';
import { normalizeTags } from './store.js';
import { markdownToDoc } from './markdown.js';
import { charLength, cleanTitleText, MAX_TITLE_CHARS, NoteValidationError, utf8Length, validateBody } from '../shared/schema.js';

export const MAX_CONTENT_BYTES = 100_000;
export const MAX_AGENT_TAGS = 10;

/**
 * Methods accepted at /mcp. `server/discover` is the 2026-07-28 revision's
 * counterpart of `initialize` (see DEVIATIONS.md); everything else is refused
 * with the standard JSON-RPC "method not found" error.
 */
const ALLOWED_REQUESTS = new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'server/discover']);
const ALLOWED_NOTIFICATIONS = new Set(['notifications/initialized']);
const TOOL = 'create_note';

const DESCRIPTION =
  'Create a new note in the user’s Notes app. The note is placed in the user’s Inbox folder and marked as created by this agent. ' +
  'Content is Markdown (CommonMark with GFM tables, task lists and strikethrough). Raw HTML is shown as text, images become their alt text, ' +
  'and only http, https and mailto links are kept. Notes cannot be read, listed, changed or deleted through this server.';

class ToolInputError extends Error {}

function cleanAgentTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new ToolInputError('title must be a string.');
  const t = cleanTitleText(raw).trim();
  const n = charLength(t);
  if (n < 1 || n > MAX_TITLE_CHARS) throw new ToolInputError(`title must be 1-${MAX_TITLE_CHARS} characters.`);
  return t;
}

export function createNoteFromAgent(store: Store, agent: AgentAuth, args: { title?: unknown; content?: unknown; tags?: unknown }) {
  const title = cleanAgentTitle(args.title);
  if (typeof args.content !== 'string') throw new ToolInputError('content must be a string of Markdown.');
  if (utf8Length(args.content) > MAX_CONTENT_BYTES) throw new ToolInputError(`content must be at most ${MAX_CONTENT_BYTES} bytes of UTF-8.`);
  let tags: string[] = [];
  if (args.tags !== undefined && args.tags !== null) {
    if (!Array.isArray(args.tags)) throw new ToolInputError('tags must be a list of strings.');
    if (args.tags.length > MAX_AGENT_TAGS) throw new ToolInputError(`At most ${MAX_AGENT_TAGS} tags are allowed.`);
    try {
      tags = normalizeTags(args.tags, MAX_AGENT_TAGS);
    } catch (e) {
      throw new ToolInputError(e instanceof AppError ? e.message : 'Invalid tags.');
    }
  }
  let body;
  try {
    body = validateBody(markdownToDoc(args.content));
  } catch (e) {
    if (e instanceof NoteValidationError) throw new ToolInputError(`The converted note is not valid: ${e.message}`);
    throw e;
  }
  return store.notes.createAgentNote(agent, { title, body, tags });
}

function buildServer(store: Store, agent: AgentAuth): McpServer {
  const server = new McpServer({ name: 'notes', version: '1.0.0' }, { capabilities: { tools: { listChanged: false } } });
  server.registerTool(
    TOOL,
    {
      title: 'Create note',
      description: DESCRIPTION,
      inputSchema: z.object({
        title: z.string().describe('Note title, 1-200 characters.'),
        content: z.string().describe('Note body in Markdown, at most 100,000 bytes.'),
        tags: z
          .array(z.string())
          .max(MAX_AGENT_TAGS)
          .optional()
          .describe('Optional tags (at most 10; each 1-50 characters, no commas; stored lower-case).'),
      }),
    },
    async (args) => {
      try {
        const { id } = createNoteFromAgent(store, agent, args);
        return { content: [{ type: 'text', text: `Created note ${id} in the Inbox.` }] };
      } catch (e) {
        if (e instanceof ToolInputError || e instanceof AppError) {
          return { content: [{ type: 'text', text: `Note not created: ${e.message}` }], isError: true };
        }
        throw e;
      }
    },
  );
  return server;
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export async function registerMcp(app: FastifyInstance, opts: AppOptions) {
  const { store } = opts;
  // 2026-07-28 revision: per-request instances, JSON responses only.
  const modern = createMcpHandler((ctx: McpRequestContext) => buildServer(store, ctx.authInfo!.extra!.agent as AgentAuth), {
    legacy: 'reject',
    responseMode: 'json',
    maxRequestBodySize: MiB,
  });

  // 2025 revision (initialize handshake): a fresh server and stateless transport per request,
  // answering with a JSON body rather than an SSE stream.
  async function legacy(request: Request, parsedBody: unknown, agent: AgentAuth, authInfo: AuthInfo): Promise<{ res: Response; text: string }> {
    const server = buildServer(store, agent);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(request, { parsedBody, authInfo });
      return { res, text: await res.text() };
    } finally {
      await transport.close();
      await server.close();
    }
  }

  // The body arrives as a string so that a JSON parse error gets the JSON-RPC answer.
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: MiB }, (_req, body, done) => done(null, body));

  // Origin first (no web page may call /mcp), then the bearer token. Cookies are never looked at.
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin !== undefined) {
      return reply.status(403).send(errorBody('origin_not_allowed', 'Requests with an Origin header are not accepted at /mcp.'));
    }
    if (req.method !== 'POST') {
      return reply.status(405).header('allow', 'POST').send(errorBody('method_not_allowed', 'Only POST is supported at /mcp.'));
    }
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
    const agent = m ? store.identity.authenticateAgent(m[1]) : null;
    if (!agent) {
      return reply.status(401).header('www-authenticate', 'Bearer realm="notes"').send(errorBody('unauthorized', 'A valid agent token is required.'));
    }
    (req as FastifyRequest & { agent?: AgentAuth }).agent = agent;
  });

  const serve = async (req: FastifyRequest, reply: FastifyReply) => {
    const agent = (req as FastifyRequest & { agent?: AgentAuth }).agent!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof req.body === 'string' ? req.body : '');
    } catch {
      return reply.status(400).send(rpcError(null, -32700, 'Parse error'));
    }
    if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
      return reply.status(400).send(rpcError(null, -32600, 'Invalid Request: send one JSON-RPC message per request.'));
    }
    const msg = parsed as { id?: unknown; method?: unknown; params?: { name?: unknown } };
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (typeof msg.method !== 'string') {
      return reply.status(400).send(rpcError(msg.id, -32600, 'Invalid Request'));
    }
    if (!isRequest) {
      if (!ALLOWED_NOTIFICATIONS.has(msg.method)) return reply.status(202).send();
    } else {
      if (!ALLOWED_REQUESTS.has(msg.method)) return reply.status(200).send(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
      if (msg.method === 'tools/call' && msg.params?.name !== TOOL) {
        return reply.status(200).send(rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`));
      }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || k === 'authorization' || k === 'cookie' || k === 'content-length' || k === 'host') continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const request = new Request('http://app.internal/mcp', { method: 'POST', headers, body: req.body as string });
    const authInfo: AuthInfo = { token: '', clientId: agent.agentId, scopes: [], extra: { agent } };
    let res: Response;
    let text: string;
    if (await isLegacyRequest(request, parsed, { maxRequestBodySize: MiB })) {
      ({ res, text } = await legacy(request, parsed, agent, authInfo));
    } else {
      res = await modern.fetch(request, { authInfo, parsedBody: parsed });
      text = await res.text();
    }
    reply.status(res.status);
    res.headers.forEach((value, key) => {
      if (key === 'content-length' || key.startsWith('access-control-')) return;
      reply.header(key, value);
    });
    return reply.send(text.length ? text : undefined);
  };

  app.post('/mcp', { bodyLimit: MiB }, serve);
  app.route({ method: ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], url: '/mcp', handler: async (_r, reply) => reply.status(405).send() });
}
