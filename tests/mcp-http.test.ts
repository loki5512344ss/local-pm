// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { startHttpMcp as startHttpMcpFactory } from '../mcp-server/src/http'

type HttpMcpHandle = Awaited<ReturnType<typeof startHttpMcpFactory>>

let startHttpMcp: typeof startHttpMcpFactory

const handles: HttpMcpHandle[] = []

beforeAll(async () => {
  ;({ startHttpMcp } = await import('../mcp-server/src/http'))
})

afterAll(async () => {
  for (const handle of handles.splice(0)) await handle.close()
  vi.restoreAllMocks()
})


const STATUSES_RESPONSE = {
  docs: [
    { id: 's1', key: 'backlog', name: 'Backlog', type: 'BACKLOG', order: 100, project: null },
    { id: 's2', key: 'todo', name: 'Todo', type: 'UNSTARTED', order: 200, project: null },
    { id: 's3', key: 'in_progress', name: 'In Progress', type: 'STARTED', order: 300, project: null },
    { id: 's4', key: 'done', name: 'Done', type: 'COMPLETED', order: 500, project: null },
  ],
}

function stubStatusesApi() {
  // The MCP client itself speaks fetch to 127.0.0.1:<port>/mcp — only the
  // server-side calls to the Local PM API are faked, everything else passes
  // through to the real network stack. Captures the Local PM API calls so
  // tests can assert on headers.
  const realFetch = globalThis.fetch
  const apiCalls: Array<{ url: string; headers: Record<string, unknown> }> = []
  const stub = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url)
    if (target.includes('/api/')) {
      apiCalls.push({ url: target, headers: { ...(init?.headers ?? {}) } })
      const payload = target.includes('/api/statuses') ? STATUSES_RESPONSE : { docs: [], totalDocs: 0 }
      return {
        ok: true,
        json: async () => payload,
      } as unknown as Response
    }
    return realFetch(url as string, init) as unknown as Response
  })
  vi.stubGlobal('fetch', stub)
  return apiCalls
}

async function connect(handle: HttpMcpHandle): Promise<Client> {
  const client = new Client({ name: 'vitest-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${handle.port}/mcp`),
  )
  await client.connect(transport)
  return client
}

describe('MCP streamable HTTP transport (task 47)', () => {
  it('serves the tool list over HTTP, including the new list_statuses tool', async () => {
    const handle = await startHttpMcp({ port: 0 })
    handles.push(handle)

    const client = await connect(handle)
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)

    expect(names).toContain('list_statuses')
    expect(names).toContain('move_ticket')
    expect(names).toContain('create_ticket')
    await client.close()
  })

  it('resolves real configured statuses through list_statuses (task 57)', async () => {
    stubStatusesApi()
    const handle = await startHttpMcp({ port: 0 })
    handles.push(handle)

    const client = await connect(handle)
    const result = await client.callTool({ name: 'list_statuses', arguments: {} })
    expect(result.isError).toBeFalsy()

    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    const keys = payload.statuses.map((status: { key: string }) => status.key)
    expect(keys).toEqual(['backlog', 'todo', 'in_progress', 'done'])
    await client.close()
  })

  it('keeps two sessions isolated', async () => {
    const handle = await startHttpMcp({ port: 0 })
    handles.push(handle)

    const first = await connect(handle)
    const second = await connect(handle)
    expect(first.getServerVersion()).toBeDefined()
    expect(second.getServerVersion()).toBeDefined()
    await first.close()
    await second.close()
  })

  it('sends the LOCAL_PM_API_KEY as the Payload Authorization header', async () => {
    const apiCalls = stubStatusesApi()
    process.env.LOCAL_PM_API_KEY = 'agent-key-1234'
    try {
      const handle = await startHttpMcp({ port: 0 })
      handles.push(handle)

      const client = await connect(handle)
      await client.callTool({ name: 'list_projects', arguments: {} })
      await client.close()

      expect(apiCalls.length).toBeGreaterThan(0)
      for (const call of apiCalls) {
        expect(call.headers.Authorization).toBe('users API-Key agent-key-1234')
      }
    } finally {
      delete process.env.LOCAL_PM_API_KEY
    }
  })

  it('answers 401 when a token is configured and the request carries none', async () => {
    const handle = await startHttpMcp({ port: 0, token: 'secret-token' })
    handles.push(handle)

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(response.status).toBe(401)
  })

  it('accepts bearer-token requests when the token matches', async () => {
    const handle = await startHttpMcp({ port: 0, token: 'secret-token' })
    handles.push(handle)

    const client = new Client({ name: 'vitest-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle.port}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer secret-token' } } },
    )
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    await client.close()
  })
})
