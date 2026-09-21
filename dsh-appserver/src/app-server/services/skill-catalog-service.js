import { CapabilityUnavailableError, InvalidInputError } from '../protocol/domain-errors.js'

const SCOPES = new Set(['user', 'repo', 'system', 'admin', 'workspace', 'managed'])

function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value) }
function stringValue(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }

function scopeOf(skill, cwd) {
  const value = stringValue(skill?.scope) || stringValue(skill?.source?.scope) || stringValue(skill?.metadata?.scope)
  if (value && SCOPES.has(value)) return value
  // DSH registries do not consistently expose a scope. A cwd-derived entry is
  // still more useful to clients as a repository/workspace skill than as an
  // unknown object, while explicit scopes always win above.
  return cwd && cwd !== process.cwd() ? 'repo' : 'user'
}

function dependencyList(value) {
  if (!Array.isArray(value)) return undefined
  const dependencies = value.filter(isObject).map(dependency => ({
    type: stringValue(dependency.type) || 'tool',
    value: stringValue(dependency.value) || stringValue(dependency.name) || '',
    ...(stringValue(dependency.description) ? { description: stringValue(dependency.description) } : {}),
    ...(stringValue(dependency.transport) ? { transport: stringValue(dependency.transport) } : {}),
    ...(stringValue(dependency.command) ? { command: stringValue(dependency.command) } : {}),
    ...(stringValue(dependency.url) ? { url: stringValue(dependency.url) } : {}),
  })).filter(dependency => dependency.value)
  return dependencies.length > 0 ? dependencies : undefined
}

export function normalizeSkill(skill, cwd) {
  const source = isObject(skill) ? skill : {}
  const invocation = isObject(source.invocation) ? source.invocation : {}
  const interfaceInfo = isObject(source.interface) ? source.interface : undefined
  const result = {
    name: String(source.name || source.id || 'unnamed-skill'),
    description: String(source.description || ''),
    ...(stringValue(source.shortDescription) ? { shortDescription: stringValue(source.shortDescription) } : {}),
    ...(stringValue(source.path) || stringValue(source.filePath) || stringValue(source.location) ? { path: stringValue(source.path) || stringValue(source.filePath) || stringValue(source.location) } : {}),
    scope: scopeOf(source, cwd),
    enabled: source.enabled !== false,
    ...(stringValue(source.pluginId) || stringValue(source.plugin?.id) ? { pluginId: stringValue(source.pluginId) || stringValue(source.plugin?.id) } : {}),
    ...(interfaceInfo ? { interface: interfaceInfo } : {}),
    ...(dependencyList(source.dependencies) ? { dependencies: dependencyList(source.dependencies) } : {}),
  }
  // Keep DSH-specific invocation metadata available to the compatibility
  // projection without making it part of the required Codex-shaped fields.
  if (source.whenToUse !== undefined) result.whenToUse = String(source.whenToUse)
  if (invocation.modelInvocable !== undefined) result.modelInvocable = Boolean(invocation.modelInvocable)
  if (invocation.userInvocable !== undefined) result.userInvocable = Boolean(invocation.userInvocable)
  return result
}

function candidatesOf(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.candidates)) return result.candidates
  if (Array.isArray(result?.skills)) return result.skills
  if (Array.isArray(result?.data)) return result.data
  return []
}

export class SkillCatalogService {
  constructor(ctx, { resolveAgent, maxCacheEntries = 256 } = {}) {
    this.ctx = ctx
    this.resolveAgent = resolveAgent
    this.maxCacheEntries = Math.max(1, Number(maxCacheEntries) || 256)
    this.cache = new Map()
    this.revision = 0
    this.configService = undefined
  }

  registryFor(agent) {
    const presets = this.ctx?.get?.('agentPresets')
    return presets?.serviceFor?.(agent, 'skills') || this.ctx?.skills || this.ctx?.get?.('skills')
  }

  invalidate() {
    this.cache.clear()
    this.revision += 1
    return this.revision
  }

  remember(key, value) {
    // This is only a bounded read-through projection cache. DSH's skills
    // registry remains the source of truth and invalidation is driven by its
    // skills/changed notification (or forceReload).
    this.cache.delete(key)
    this.cache.set(key, value)
    while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value)
    return value
  }

  async list({ cwds, forceReload = false, threadId } = {}) {
    if (cwds !== undefined && (!Array.isArray(cwds) || !cwds.every(value => typeof value === 'string' && value.trim()))) {
      throw new InvalidInputError('cwds', 'must be an array of non-empty strings')
    }
    if (threadId !== undefined && !(typeof threadId === 'string' && threadId.trim())) {
      throw new InvalidInputError('threadId', 'must be a non-empty string')
    }
    let agent
    if (threadId !== undefined) {
      if (!this.resolveAgent) throw new CapabilityUnavailableError('skills')
      agent = await this.resolveAgent(threadId)
    }
    const agentCwd = stringValue(agent?.session?.header?.cwd)
    const roots = [...new Set((cwds?.length ? cwds : [agentCwd || process.cwd()]).map(value => String(value).trim()))]
    const registry = this.registryFor(agent)
    if (!registry?.list) throw new CapabilityUnavailableError('skills')

    const data = []
    for (const cwd of roots) {
      const cacheKey = `${agent?.session?.id || 'global'}:${cwd}`
      if (!forceReload && this.cache.has(cacheKey)) {
        data.push(this.cache.get(cacheKey))
        continue
      }
      try {
        const result = await registry.list({ cwd, ...(agent ? { scope: agent } : {}) })
        const entry = {
          cwd,
          skills: candidatesOf(result)
            .map(skill => normalizeSkill(skill, cwd))
            .sort((left, right) => left.name.localeCompare(right.name)),
          errors: [],
        }
        this.remember(cacheKey, entry)
        data.push(entry)
      } catch (error) {
        const entry = {
          cwd,
          skills: [],
          errors: [{ path: cwd, message: error instanceof Error ? error.message : String(error) }],
        }
        // Errors are cacheable for a single request but forceReload can retry
        // after the host repairs a registry or plugin.
        this.remember(cacheKey, entry)
        data.push(entry)
      }
    }
    return { data, revision: this.revision }
  }

  async listForThread(threadId) {
    const result = await this.list({ threadId })
    return {
      skills: result.data.flatMap(entry => entry.skills)
        .filter(skill => skill.userInvocable !== false)
        .map(skill => ({
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          ...(skill.modelInvocable === undefined ? {} : { modelInvocable: skill.modelInvocable }),
        })),
    }
  }

  async writeConfig({ selector, name, enabled, expectedRevision } = {}) {
    if (typeof enabled !== 'boolean') throw new InvalidInputError('enabled', 'must be boolean')
    const selectedName = typeof selector === 'string' ? selector : selector?.name || name
    if (typeof selectedName !== 'string' || !selectedName.trim()) throw new InvalidInputError('selector', 'must include a skill name')
    if (!this.configService) throw new CapabilityUnavailableError('skills-config')
    const result = await this.configService.writeValue({
      namespace: 'flowix-appserver',
      path: ['skills', 'enabled', selectedName.trim()],
      value: enabled,
      expectedRevision,
    })
    this.invalidate()
    return { effectiveEnabled: enabled, revision: result.revision }
  }

  async setExtraRoots({ extraRoots, expectedRevision } = {}) {
    if (!Array.isArray(extraRoots) || !extraRoots.every(root => typeof root === 'string' && root.trim())) throw new InvalidInputError('extraRoots', 'must be an array of non-empty strings')
    if (!this.configService) throw new CapabilityUnavailableError('skills-config')
    const result = await this.configService.writeValue({
      namespace: 'flowix-appserver',
      path: ['skills', 'extraRoots'],
      value: extraRoots.map(root => root.trim()),
      expectedRevision,
    })
    this.invalidate()
    return { extraRoots: extraRoots.map(root => root.trim()), revision: result.revision }
  }
}
