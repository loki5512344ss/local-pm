#!/usr/bin/env node

/**
 * stdio entry point — the default transport. Remote and web clients use the
 * Streamable HTTP entry instead: see src/http.ts and README.md.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLocalPmServer } from './local-pm-server.js';

async function main() {
  const server = createLocalPmServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Local PM MCP Server running on stdio');
}

main().catch(console.error);
