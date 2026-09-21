import { CapabilityUnavailableError } from '../protocol/domain-errors.js'

export class ModelCatalogService {
  constructor(ctx, modelSettings, { loadBuiltinCatalog } = {}) {
    this.ctx = ctx
    this.modelSettings = modelSettings
    this.loadBuiltinCatalog = loadBuiltinCatalog || (() => null)
  }

  configured() {
    const configuration = this.modelSettings.describe()
    return Object.entries(configuration.providers).map(([provider, profile]) => ({
      provider,
      ...(typeof profile?.displayName === 'string' ? { displayName: profile.displayName } : {}),
      ...(typeof (profile?.baseURL ?? profile?.baseUrl) === 'string' ? { baseUrl: profile.baseURL ?? profile.baseUrl } : {}),
      takesApiKey: provider !== 'ollama',
      models: Array.isArray(profile?.models)
        ? profile.models.filter(model => model && typeof model.id === 'string')
        : typeof profile?.model === 'string' && profile.model ? [{ id: profile.model }] : [],
    }))
  }

  async catalog() {
    const configured = this.configured()
    try {
      const llm = this.ctx.get?.('llm') || this.ctx.llm
      if (!llm?.listConfigurableProviders || !llm?.listModels) return { providers: configured }
      const entries = await llm.listConfigurableProviders()
      const configuredRoutes = new Set(configured.map(provider => provider.provider))
      const builtinCatalog = await this.loadBuiltinCatalog()
      const builtins = new Map((builtinCatalog?.builtinProviders?.() ?? []).map(provider => [provider.id, provider]))
      const visible = builtinCatalog ? entries.filter(entry => builtins.has(entry.provider) || configuredRoutes.has(entry.provider)) : entries
      const providers = await Promise.all(visible.map(async entry => {
        const builtin = builtins.get(entry.provider)
        let models = []
        if (configuredRoutes.has(entry.provider)) {
          try { models = await llm.listModels(entry.provider) } catch { models = [] }
        }
        if (models.length === 0 && builtinCatalog?.getBuiltinModels) models = builtinCatalog.getBuiltinModels(entry.provider) ?? []
        const first = models[0]
        return {
          provider: entry.provider,
          displayName: builtin?.name || entry.displayName || entry.provider,
          ...(first?.baseUrl ? { baseUrl: first.baseUrl } : {}),
          ...(first?.api ? { api: first.api } : {}),
          takesApiKey: builtin?.auth?.apiKey !== undefined || entry.provider !== 'ollama',
          models: models.map(model => ({
            id: model.id,
            ...(model.name ? { name: model.name } : {}),
            ...(model.api ? { api: model.api } : {}),
            ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
            ...(Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
            ...(Number.isFinite(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
          })),
        }
      }))
      const seen = new Set(providers.map(provider => provider.provider))
      return { providers: [...providers, ...configured.filter(provider => !seen.has(provider.provider))] }
    } catch {
      return { providers: configured }
    }
  }

  async discover(request = {}) {
    const llm = this.ctx.get?.('llm') || this.ctx.llm
    if (!llm?.discoverModels) throw new CapabilityUnavailableError('model-discovery')
    return { models: await llm.discoverModels('llm-pi-ai', request && typeof request === 'object' ? request : {}) }
  }
}
