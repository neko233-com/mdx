import { CapabilityUnavailableError, InvalidInputError } from '../protocol/domain-errors.js'

export class ModelSettingsService {
  constructor(ctx) { this.ctx = ctx }

  settings(operation) {
    const settings = this.ctx.get?.('settings') || this.ctx.settings
    if (!settings?.[operation]) throw new CapabilityUnavailableError('model-settings-management')
    return settings
  }

  describe() {
    const settings = this.ctx.get?.('settings') || this.ctx.settings
    if (!settings?.describe) return { revision: 0, providers: {}, applies: [] }
    let descriptor
    try { descriptor = settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-pi-ai') } catch { descriptor = undefined }
    if (!descriptor) return { revision: 0, providers: {}, applies: [] }
    const user = descriptor.user && typeof descriptor.user === 'object' && !Array.isArray(descriptor.user) ? descriptor.user : {}
    const effective = descriptor.effective && typeof descriptor.effective === 'object' && !Array.isArray(descriptor.effective)
      ? descriptor.effective
      : descriptor.value && typeof descriptor.value === 'object' && !Array.isArray(descriptor.value)
        ? descriptor.value
        : user
    const providers = effective.providers && typeof effective.providers === 'object' && !Array.isArray(effective.providers)
      ? effective.providers
      : user.providers && typeof user.providers === 'object' && !Array.isArray(user.providers)
        ? user.providers
        : {}
    return {
      revision: descriptor.revision,
      providers,
      applies: descriptor.applies,
    }
  }

  validateRoute(route) {
    if (typeof route !== 'string' || route === '') throw new InvalidInputError('route', 'must be a non-empty string')
    if (['__proto__', 'prototype', 'constructor'].includes(route)) throw new InvalidInputError('route', 'is reserved')
  }

  validateRevision(revision) {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
      throw new InvalidInputError('expectedRevision', 'must be a non-negative integer')
    }
  }

  async upsert(route, profile, expectedRevision) {
    this.validateRoute(route)
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new InvalidInputError('profile', 'must be an object')
    this.validateRevision(expectedRevision)
    await this.settings('mutate').mutate('llm-pi-ai', [{ op: 'set', path: ['providers', route], value: profile }], expectedRevision)
    return this.describe()
  }

  async remove(route, expectedRevision) {
    this.validateRoute(route)
    this.validateRevision(expectedRevision)
    await this.settings('mutate').mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', route] }], expectedRevision)
    return this.describe()
  }
}
