#!/usr/bin/env node

/**
 * Streamable HTTP entry point (roadmap task 47).
 *
 * stdio (src/index.ts) only reaches clients that can spawn a local process.
 * The HTTP transport exposes the same tools at http://HOST:PORT/mcp so remote
 * MCP clients — ChatGPT connectors, web agents, other machines — can connect.
 *
 * Bind defaults to 127.0.0.1: the endpoint is meant to sit behind an SSH
 * tunnel or a reverse proxy that terminates auth, not on a public interface.
 * LOCAL_PM_MCP_TOKEN, when set, requires `Authorization: Bearer <token>` on
 * every request and answers 401 otherwise.
 */

import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createLocalPmServer } from './local-pm-server.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3020;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface HttpOptions {
  host?: string;
  port?: number;
  token?: string;
}

export interface HttpMcpHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Starts the HTTP MCP endpoint. Resolves once the server is listening.
 * Each MCP session gets its own Server + StreamableHTTPServerTransport pair;
 * `close` shuts the listener down and ends every live session.
 */
export function startHttpMcp(options: HttpOptions = {}): Promise<HttpMcpHandle> {
  const host = options.host ?? process.env.LOCAL_PM_MCP_HOST ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env.LOCAL_PM_MCP_PORT ?? DEFAULT_PORT);
  const token = options.token ?? process.env.LOCAL_PM_MCP_TOKEN;

  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // DNS-rebinding protection compares the Host header against this list, so it
  // has to include whatever host:port the client actually dials — the port is
  // only known for sure once the OS assigns it.
  const allowedHosts = new Set<string>();

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void (async () => {
      try {
        if (req.url !== '/mcp') {
          sendJson(res, 404, { error: 'Not found. MCP endpoint is at /mcp.' });
          return;
        }
        if (token && req.headers.authorization !== `Bearer ${token}`) {
          sendJson(res, 401, { error: 'Unauthorized. Pass Authorization: Bearer <LOCAL_PM_MCP_TOKEN>.' });
          return;
        }

        if (req.method === 'POST') {
          const raw = await readBody(req);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            sendJson(res, 400, { error: 'Invalid JSON body.' });
            return;
          }

          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          let transport = sessionId ? sessions.get(sessionId) : undefined;

          if (!transport) {
            if (!isInitializeRequest(parsed)) {
              sendJson(res, 400, { error: 'Bad Request: no valid session and not an initialize request.' });
              return;
            }
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id: string) => {
                if (transport) sessions.set(id, transport);
              },
              enableDnsRebindingProtection: true,
              allowedHosts: [...allowedHosts],
            });
            const current = transport;
            current.onclose = () => {
              const id = current.sessionId;
              if (id) sessions.delete(id);
            };
            const server = createLocalPmServer();
            await server.connect(current);
          }

          await transport.handleRequest(req, res, parsed);
          return;
        }

        if (req.method === 'GET' || req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          const transport = sessionId ? sessions.get(sessionId) : undefined;
          if (!transport) {
            sendJson(res, 404, { error: 'Session not found.' });
            return;
          }
          await transport.handleRequest(req, res);
          return;
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        sendJson(res, 405, { error: 'Method not allowed.' });
      } catch (error) {
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'Internal server error.',
          });
        } else {
          res.end();
        }
      }
    })();
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      allowedHosts.add(`${host}:${boundPort}`);
      allowedHosts.add(`localhost:${boundPort}`);
      if (host === '127.0.0.1') allowedHosts.add(`127.0.0.1:${boundPort}`);

      const handle: HttpMcpHandle = {
        host,
        port: boundPort,
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const transport of sessions.values()) void transport.close();
            sessions.clear();
            httpServer.close(() => resolveClose());
          }),
      };
      resolve(handle);
    });
  });
}

async function main() {
  const handle = await startHttpMcp();
  const tokenNote = process.env.LOCAL_PM_MCP_TOKEN ? ' (bearer token required)' : '';
  console.error(`Local PM MCP Server listening on http://${handle.host}:${handle.port}/mcp${tokenNote}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
