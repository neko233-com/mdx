import { McpService } from '../services/mcp-service.js'

export function mcpMethods(adapter) {
  const service = adapter.mcpService || new McpService(adapter.ctx)
  return {
    'mcpServerStatus/list': p => service.list(p),
    'mcpServer/refresh': () => service.refresh(),
    'config/mcpServer/reload': () => service.reloadConfig(),
    'mcpServer/oauth/login': p => service.oauthLogin(p),
    'mcpServer/tool/call': p => service.callTool(p),
    'mcpServer/resource/read': p => service.readResource(p),
    'mcp/resource/read': p => service.readResource(p),
  }
}
