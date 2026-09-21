import { CapabilityUnavailableError, InvalidInputError } from '../protocol/domain-errors.js'

export class AttachmentGateway {
  constructor(ctx) { this.ctx = ctx }

  async admitTurnInput(input, text) {
    const attachments = input && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.attachments)
      ? input.attachments
      : []
    if (attachments.length === 0) return [{ type: 'text', text }]
    const parts = attachments.map((attachment, index) => {
      if (attachment?.type !== 'image' || typeof attachment.mediaType !== 'string' || typeof attachment.data !== 'string') {
        throw new InvalidInputError(`attachments[${index}]`, 'must be an encoded image attachment')
      }
      return {
        type: 'image', mediaType: attachment.mediaType, data: attachment.data,
        ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
      }
    })
    const store = this.ctx.attachments || this.ctx.get?.('attachments')
    if (!store?.admitPromptContent) throw new CapabilityUnavailableError('attachments')
    return store.admitPromptContent([{ type: 'text', text }, ...parts])
  }
}
