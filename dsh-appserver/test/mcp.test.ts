import { describe, expect, it } from 'vitest'
import { AppServer } from '../src/index.js'

describe('MCP management protocol', () => {
  it('lists normalized server status with detail filtering and pagination', async () => {
    const calls: any[] = []
    const mcp = {
      list: async (params: any) => {
        calls.push(params)
        return [
          {
            name: 'docs-server', runtimeStatus: 'connected', authStatus: 'oauth',
            tools: [{ name: 'search', description: 'Search docs' }],
            resources: [{ uri: 'docs://root' }], resourceTemplates: [{ uriTemplate: 'docs://{id}' }],
          },
          { name: 'disabled-server', status: 'disabled', tools: {}, resources: [] },
        ]
      },
    }
    const adapter = {
      ctx: { get: (name: string) => name === 'mcp' ? mcp : undefined },
      subscribe: () => () => {},
    }
    const server = new AppServer(null, { adapter })
    await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' })

    const first = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: { limit: 1, detail: 'toolsAndAuthOnly' } })
    expect(first.result).toEqual({
      data: [{
        name: 'docs-server', runtimeStatus: 'connected', pluginId: null, serverInfo: null,
        serverCapabilities: null, tools: { search: { name: 'search', description: 'Search docs' } },
        toolsError: null, resources: [], resourceTemplates: [], authStatus: 'oauth',
      }],
      nextCursor: '1',
    })
    const second = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'mcpServerStatus/list', params: { cursor: '1', limit: 1 } })
    expect(second.result?.data[0].name).toBe('disabled-server')
    expect(second.result?.nextCursor).toBeNull()
    expect(calls[0]).toMatchObject({ detail: 'toolsAndAuthOnly', limit: 1 })
  })

  it('routes refresh, tool calls and resource reads through the host MCP service', async () => {
    const calls: any[] = []
    const mcp = {
      refresh: async () => { calls.push(['refresh']); return { refreshed: true } },
      oauthLogin: async (params: any) => { calls.push(['oauth', params]); return { authorizationUrl: 'https://auth.example.test/start' } },
      callTool: async (params: any) => { calls.push(['tool', params]); return { content: [{ type: 'text', text: 'ok' }] } },
      readResource: async (params: any) => { calls.push(['resource', params]); return { contents: [{ uri: params.uri, text: 'body' }] } },
    }
    const adapter = {
      ctx: { get: (name: string) => name === 'mcp' ? mcp : undefined },
      subscribe: () => () => {},
    }
    const server = new AppServer(null, { adapter })
    await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const refresh = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'mcpServer/refresh' })
    const oauth = await server.dispatch({ jsonrpc: '2.0', id: 5, method: 'mcpServer/oauth/login', params: { name: 'docs-server', threadId: 'thread-1', scopes: ['read'] } })
    const tool = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'mcpServer/tool/call', params: { threadId: 'thread-1', server: 'docs-server', tool: 'search', arguments: { q: 'agent' } } })
    const resource = await server.dispatch({ jsonrpc: '2.0', id: 4, method: 'mcpServer/resource/read', params: { server: 'docs-server', uri: 'docs://root' } })
    const reload = await server.dispatch({ jsonrpc: '2.0', id: 6, method: 'config/mcpServer/reload' })
    expect(refresh.result).toEqual({ refreshed: true })
    expect(oauth.result).toEqual({ authorizationUrl: 'https://auth.example.test/start' })
    expect(tool.result?.content[0].text).toBe('ok')
    expect(resource.result?.contents[0].text).toBe('body')
    expect(reload.result).toEqual({ refreshed: true })
    expect(calls).toEqual([
      ['refresh'],
      ['oauth', { name: 'docs-server', threadId: 'thread-1', scopes: ['read'] }],
      ['tool', { threadId: 'thread-1', server: 'docs-server', tool: 'search', arguments: { q: 'agent' } }],
      ['resource', { server: 'docs-server', uri: 'docs://root' }],
      ['refresh'],
    ])
  })
})
