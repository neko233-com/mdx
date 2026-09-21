import { randomUUID } from 'node:crypto'

export class TurnService {
  constructor(ctx, { resolveAgent, liveAgent, runtimeRegistry, attachmentGateway, stableTurnId }) {
    this.ctx = ctx
    this.resolveAgent = resolveAgent
    this.liveAgent = liveAgent
    this.runtimeRegistry = runtimeRegistry
    this.attachmentGateway = attachmentGateway
    this.stableTurnId = stableTurnId
  }

  text(input) {
    if (typeof input === 'string') return input
    if (Array.isArray(input)) {
      const text = input.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
      return text || JSON.stringify(input)
    }
    return typeof input?.text === 'string' ? input.text : JSON.stringify(input)
  }

  async content(input) { return this.attachmentGateway.admitTurnInput(input, this.text(input)) }

  message(content, id) {
    return { id: id || `message-${randomUUID()}`, role: 'user', content, source: { kind: 'user' } }
  }

  async start(id, input) {
    const agent = await this.resolveAgent(id)
    const nextTurn = (agent.session.events || []).reduce((max, event) => Math.max(max, Number(event.data?.turn) || 0), 0) + 1
    const turnId = this.stableTurnId(id, nextTurn)
    const pending = this.runtimeRegistry.pendingTurns.get(id) || []
    pending.push(turnId)
    this.runtimeRegistry.pendingTurns.set(id, pending)
    const message = this.message(await this.content(input))
    agent.followup ? agent.followup(message) : agent.send(message, 'followup', true)
    return { id: turnId, threadId: id, status: 'inProgress', items: [] }
  }

  async steer(id, input, clientMessageId) {
    const agent = await this.resolveAgent(id)
    const message = this.message(await this.content(input), typeof clientMessageId === 'string' && clientMessageId.trim() ? clientMessageId.trim() : undefined)
    agent.steer ? agent.steer(message) : agent.send(message, 'next-step', true)
    return true
  }

  async interrupt(id) {
    const agent = this.liveAgent(id)
    if (!agent) return { interrupted: false }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { interrupted: true }
  }

  activeId(id) { return this.runtimeRegistry.activeTurns.get(String(id)) ?? null }
}
