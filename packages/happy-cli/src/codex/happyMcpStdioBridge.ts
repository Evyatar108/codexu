/**
 * Happy MCP STDIO Bridge
 *
 * Minimal STDIO MCP server exposing a single tool `change_title`.
 * On invocation it forwards the tool call to an existing Happy HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `HAPPY_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { registerAgentCommsBridge, type AgentCommsBridgeHandle } from './agentCommsBridge';
import { sendAgentMessage, spawnDaemonSessionFromSession } from '@/daemon/controlClient';
import { HAPPY_CURRENT_SESSION_ID } from '@/utils/envNames';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

async function main() {
  // Resolve target HTTP MCP URL
  const { url: urlFromArgs } = parseArgs(process.argv.slice(2));
  const baseUrl = urlFromArgs || process.env.HAPPY_HTTP_MCP_URL || '';

  if (!baseUrl) {
    // Write to stderr; never stdout.
    process.stderr.write(
      '[happy-mcp] Missing target URL. Set HAPPY_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
    );
    process.exit(2);
  }

  let httpClient: Client | null = null;

  async function ensureHttpClient(): Promise<Client> {
    if (httpClient) return httpClient;
    const client = new Client(
      { name: 'happy-stdio-bridge', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await client.connect(transport);
    httpClient = client;
    return client;
  }

  // Create STDIO MCP server
  const server = new McpServer({
    name: 'Happy MCP Bridge',
    version: '1.0.0',
  });

  // Register the single tool and forward to HTTP MCP
  server.registerTool(
    'change_title',
    {
      description: 'Change the title of the current chat session',
      title: 'Change Chat Title',
      inputSchema: {
        title: z.string().describe('The new title for the chat session'),
      },
    },
    async (args) => {
      try {
        const client = await ensureHttpClient();
        const response = await client.callTool({ name: 'change_title', arguments: args });
        // Pass-through response from HTTP server
        return response as any;
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Failed to change chat title: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    }
  );

  // agent-comms Scope B (D-002): register the cross-session send tool, the
  // drainable agent-comms resource, and the inbox watcher for THIS session.
  // The session id + daemon control URL are passed through the bridge spawn env
  // by runCodex.ts. Disabled (with a stderr note) when the session id is absent.
  let agentCommsHandle: AgentCommsBridgeHandle | undefined;
  const currentSessionId = process.env[HAPPY_CURRENT_SESSION_ID];
  if (currentSessionId) {
    agentCommsHandle = registerAgentCommsBridge({
      server,
      sessionId: currentSessionId,
      sendMessage: (target, body, senderSessionId, options) =>
        sendAgentMessage(target, body, senderSessionId, options),
      spawnSession: spawnDaemonSessionFromSession,
    });
  } else {
    process.stderr.write(
      '[happy-mcp] HAPPY_CURRENT_SESSION_ID not set; agent-comms bridge disabled\n'
    );
  }

  // Tear down the inbox watcher on shutdown so we never leak a file descriptor.
  const shutdown = () => {
    try {
      agentCommsHandle?.dispose();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // Start STDIO transport
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

// Start and surface fatal errors to stderr only
main().catch((err) => {
  try {
    process.stderr.write(`[happy-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.exit(1);
  }
});

