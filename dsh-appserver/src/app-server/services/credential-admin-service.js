import { CapabilityUnavailableError, InvalidInputError } from '../protocol/domain-errors.js'

export class CredentialAdminService {
  constructor(ctx) { this.ctx = ctx }

  service(operation) {
    const credentials = this.ctx.get?.('credentials') || this.ctx.credentials
    if (!credentials?.[operation]) throw new CapabilityUnavailableError('credentials-management')
    return credentials
  }

  validateReference(reference) {
    if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) {
      throw new InvalidInputError('reference', 'must be an environment-variable name')
    }
    return reference
  }

  describe(reference) {
    return this.service('describe').describe(this.validateReference(reference))
  }

  async set(reference, value) {
    const ref = this.validateReference(reference)
    if (typeof value !== 'string' || value === '') throw new InvalidInputError('value', 'must be a non-empty string')
    await this.service('set').set(ref, value)
    return this.describe(ref)
  }

  async unset(reference) {
    const ref = this.validateReference(reference)
    await this.service('unset').unset(ref)
    return this.describe(ref)
  }
}
