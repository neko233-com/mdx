import { CapabilityUnavailableError, InvalidInputError } from '../protocol/domain-errors.js'

const STATUS_VALUES = new Set([
  'notStarted', 'starting', 'connected', 'authenticationRequired',
  'failed', 'cancelled', 'disabled',
])
const DETAIL_VALUES = new Set(['full', 'toolsAndAuthOnly'])

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function clone(value) {
  try { return structuredClone(value) } catch { return value }
}
function stringValue(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function listValue(value) { return Array.isArray(value) ? value : [] }

function contextValue(ctx, name) {
  try {
    return ctx?.get?.(name) || ctx?.[name]
  } catch {
    return undefined
  }
}

function serviceFrom(ctx, operations = []) {
  const candidates = [
    contextValue(ctx, 'mcp'), contextValue(ctx, 'mcpServers'), contextValue(ctx, 'mcpService'),
  ].filter(value => value && typeof value === 'object')
  return operations.length
    ? candidates.find(value => operations.some(operation => typeof value[operation] === 'function'))
    : candidates[0]
}

function toolMap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return clone(value)
  return Object.fromEntries(listValue(value).map(tool => {
    const name = stringValue(tool?.name) || stringValue(tool?.id)
    return name ? [name, clone(tool)] : null
  }).filter(Boolean))
}

export function normalizeMcpStatus(server, detail = 'full') {
  const value = object(server)
  const name = stringValue(value.name) || stringValue(value.id) || stringValue(value.server) || 'unknown'
  const runtimeStatus = stringValue(value.runtimeStatus) || stringValue(value.runtime_status) || stringValue(value.status)
  const normalizedStatus = STATUS_VALUES.has(runtimeStatus) ? runtimeStatus : runtimeStatus ? 'failed' : null
  const status = {
    name,
    runtimeStatus: normalizedStatus,
    pluginId: stringValue(value.pluginId) || stringValue(value.plugin_id) || null,
    serverInfo: value.serverInfo ?? value.server_info ?? null,
    serverCapabilities: value.serverCapabilities ?? value.server_capabilities ?? null,
    tools: toolMap(value.tools),
    toolsError: stringValue(value.toolsError) || stringValue(value.tools_error) || null,
    resources: listValue(value.resources).map(clone),
    resourceTemplates: listValue(value.resourceTemplates || value.resource_templates).map(clone),
    authStatus: stringValue(value.authStatus) || stringValue(value.auth_status) || 'unknown',
  }
  if (detail === 'toolsAndAuthOnly') {
    status.resources = []
    status.resourceTemplates = []
  }
  return status
}

function numericCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return 0
  if (!/^\d+$/u.test(String(cursor))) return null
  const value = Number(String(cursor))
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

export class McpService {
  constructor(ctx) { this.ctx = ctx }

  subscribe(listener) {
    const provider = serviceFrom(this.ctx, ['subscribe', 'on'])
    if (!provider || typeof listener !== 'function') return undefined
    if (typeof provider.subscribe === 'function') return provider.subscribe(listener)
    if (typeof provider.on === 'function') {
      const disposer = provider.on('status', listener)
      return typeof disposer === 'function' ? disposer : undefined
    }
    return undefined
  }

  provider(operation) {
    const provider = serviceFrom(this.ctx, [operation])
    if (!provider) throw new CapabilityUnavailableError('mcp-management')
    if (!provider[operation]) throw new CapabilityUnavailableError(`mcp-${operation}`)
    return provider
  }

  providerFor(...operations) {
    const provider = serviceFrom(this.ctx, operations)
    if (!provider) throw new CapabilityUnavailableError('mcp-management')
    const operation = operations.find(name => typeof provider[name] === 'function')
    if (!operation) throw new CapabilityUnavailableError(`mcp-${operations[0]}`)
    return { provider, operation }
  }

  async list(params = {}) {
    const detail = params.detail || 'full'
    if (!DETAIL_VALUES.has(detail)) throw new InvalidInputError('detail', 'must be full or toolsAndAuthOnly')
    const limit = params.limit === undefined ? 100 : Number(params.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new InvalidInputError('limit', 'must be an integer between 1 and 200')
    if (params.threadId !== undefined && (!stringValue(params.threadId))) throw new InvalidInputError('threadId', 'must be a non-empty string')
    const cursor = params.cursor === undefined || params.cursor === null ? undefined : String(params.cursor)
    const start = numericCursor(cursor)
    const { provider, operation } = this.providerFor('statusList', 'listStatus', 'list')
    const result = await provider[operation]({ ...params, detail, limit, ...(cursor === undefined ? {} : { cursor }) })
    const raw = Array.isArray(result) ? result : result?.data || result?.servers || result?.statuses || []
    const providerReturnedArray = Array.isArray(result)
    if (providerReturnedArray && start === null) throw new InvalidInputError('cursor', 'must be an opaque cursor supported by the MCP provider')
    const localPage = providerReturnedArray ? raw.slice(start, start + limit) : raw.slice(0, limit)
    const next = result?.nextCursor ?? result?.next_cursor
    const nextCursor = next !== undefined && next !== null
      ? String(next)
      : (providerReturnedArray && start + localPage.length < raw.length ? String(start + localPage.length) : null)
    return { data: localPage.map(server => normalizeMcpStatus(server, detail)), nextCursor }
  }

  async refresh() {
    const provider = serviceFrom(this.ctx, ['refresh', 'reload', 'statusList', 'listStatus', 'list'])
    if (!provider) throw new CapabilityUnavailableError('mcp-management')
    if (typeof provider.refresh === 'function') return (await provider.refresh()) || {}
    if (typeof provider.reload === 'function') return (await provider.reload()) || {}
    // A provider without an explicit refresh hook still supports a safe
    // inventory read. The caller can use it to rehydrate a UI without a
    // second, invented connection manager in App Server.
    await this.list({ detail: 'toolsAndAuthOnly' })
    return {}
  }

  async reloadConfig() {
    const provider = serviceFrom(this.ctx, ['reload', 'refresh'])
    if (!provider) throw new CapabilityUnavailableError('mcp-management')
    if (typeof provider.reload === 'function') return (await provider.reload()) || {}
    if (typeof provider.refresh === 'function') return (await provider.refresh()) || {}
    throw new CapabilityUnavailableError('mcp-config-reload')
  }

  async oauthLogin(params = {}) {
    const name = stringValue(params.name)
    if (!name) throw new InvalidInputError('name', 'must be a non-empty string')
    if (params.threadId !== undefined && !stringValue(params.threadId)) throw new InvalidInputError('threadId', 'must be a non-empty string')
    if (params.scopes !== undefined && (!Array.isArray(params.scopes) || !params.scopes.every(scope => stringValue(scope)))) throw new InvalidInputError('scopes', 'must be an array of non-empty strings')
    if (params.timeoutSecs !== undefined && (!Number.isSafeInteger(params.timeoutSecs) || params.timeoutSecs <= 0)) throw new InvalidInputError('timeoutSecs', 'must be a positive integer')
    const { provider, operation } = this.providerFor('oauthLogin', 'login')
    return (await provider[operation]({
      name,
      ...(params.threadId === undefined ? {} : { threadId: params.threadId }),
      ...(params.clientRegistration === undefined ? {} : { clientRegistration: params.clientRegistration }),
      ...(params.scopes === undefined ? {} : { scopes: clone(params.scopes) }),
      ...(params.timeoutSecs === undefined ? {} : { timeoutSecs: params.timeoutSecs }),
    })) || {}
  }

  async callTool(params = {}) {
    const server = stringValue(params.server)
    const tool = stringValue(params.tool)
    const threadId = stringValue(params.threadId)
    if (!server) throw new InvalidInputError('server', 'must be a non-empty string')
    if (!tool) throw new InvalidInputError('tool', 'must be a non-empty string')
    if (!threadId) throw new InvalidInputError('threadId', 'must be a non-empty string')
    const { provider, operation } = this.providerFor('callTool', 'toolCall', 'call')
    return (await provider[operation]({
      threadId, server, tool,
      ...(params.arguments === undefined ? {} : { arguments: clone(params.arguments) }),
      ...(params.meta === undefined ? {} : { meta: clone(params.meta) }),
    })) || { content: [] }
  }

  async readResource(params = {}) {
    const server = stringValue(params.server)
    const uri = stringValue(params.uri)
    if (!server) throw new InvalidInputError('server', 'must be a non-empty string')
    if (!uri) throw new InvalidInputError('uri', 'must be a non-empty string')
    if (params.threadId !== undefined && !stringValue(params.threadId)) throw new InvalidInputError('threadId', 'must be a non-empty string')
    const { provider, operation } = this.providerFor('readResource', 'resourceRead', 'read')
    return (await provider[operation]({
      server, uri,
      ...(params.threadId === undefined ? {} : { threadId: params.threadId }),
      ...(params.originCallId === undefined ? {} : { originCallId: params.originCallId }),
      ...(params.connectorId === undefined ? {} : { connectorId: params.connectorId }),
    })) || { contents: [] }
  }
}

export function normalizeMcpStartupStatus(payload) {
  const value = object(payload)
  const status = stringValue(value.status) || stringValue(value.state) || 'failed'
  return {
    ...(stringValue(value.threadId) || stringValue(value.thread_id) ? { threadId: stringValue(value.threadId) || stringValue(value.thread_id) } : {}),
    name: stringValue(value.name) || stringValue(value.server) || 'unknown',
    status: ['starting', 'ready', 'failed', 'cancelled'].includes(status) ? status : 'failed',
    error: stringValue(value.error) || null,
    ...(stringValue(value.failureReason) || stringValue(value.failure_reason) ? { failureReason: stringValue(value.failureReason) || stringValue(value.failure_reason) } : {}),
  }
}
