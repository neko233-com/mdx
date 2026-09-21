const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function numeric(value) { return Number.isSafeInteger(Number(value)) ? Number(value) : undefined }
function timestamp(event, field) {
  const value = event?.[field] ?? event?.data?.[field]
  if (typeof value === 'number' || typeof value === 'string') return value
  return undefined
}

export function isTerminalItemStatus(status) { return TERMINAL.has(status) }

export function itemKey(threadId, turnId, itemId) {
  return `${String(threadId)}:${String(turnId || 'none')}:${String(itemId)}`
}

export function normalizeItem(item, { threadId, turnId, sourceSeq, event, status } = {}) {
  if (!item || typeof item !== 'object' || !item.id) return undefined
  const normalizedStatus = status || item.status || (item.type === 'toolCall' || item.type === 'approvalRequest' ? 'inProgress' : 'completed')
  const sequence = numeric(item.sourceSeq ?? sourceSeq)
  const revision = numeric(item.revision) ?? sequence ?? 0
  const startedAt = item.startedAt ?? timestamp(event, 'time') ?? timestamp(event, 'timestamp') ?? timestamp(event, 'createdAt')
  const completedAt = isTerminalItemStatus(normalizedStatus)
    ? (item.completedAt ?? timestamp(event, 'time') ?? timestamp(event, 'timestamp') ?? timestamp(event, 'updatedAt'))
    : undefined
  return {
    ...item,
    id: String(item.id),
    ...(threadId === undefined ? {} : { threadId: String(threadId) }),
    ...(turnId === undefined ? {} : { turnId: String(turnId) }),
    ...(sequence === undefined ? {} : { sourceSeq: sequence }),
    status: normalizedStatus,
    revision,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  }
}

function sameOrOlder(existing, incoming) {
  // A durable terminal snapshot is authoritative even when a transient
  // provider revision is from a different sequence domain.
  if (isTerminalItemStatus(incoming?.status)) return false
  const existingSeq = numeric(existing?.sourceSeq)
  const incomingSeq = numeric(incoming?.sourceSeq)
  return existingSeq !== undefined && incomingSeq !== undefined && incomingSeq < existingSeq
}

export function mergeItem(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  if (sameOrOlder(existing, incoming)) return existing
  if (isTerminalItemStatus(existing.status) && !isTerminalItemStatus(incoming.status)) return existing
  return {
    ...existing,
    ...incoming,
    status: isTerminalItemStatus(incoming.status) ? incoming.status : (existing.status || incoming.status),
    revision: Math.max(numeric(existing.revision) || 0, numeric(incoming.revision) || 0),
    ...(existing.startedAt === undefined && incoming.startedAt !== undefined ? { startedAt: incoming.startedAt } : {}),
    ...(isTerminalItemStatus(incoming.status) && incoming.completedAt === undefined && existing.completedAt !== undefined ? { completedAt: existing.completedAt } : {}),
  }
}

/**
 * Process-local lifecycle gate for live and replayed notifications. Durable
 * history remains authoritative; this object only suppresses duplicates and
 * guarantees monotonic started -> delta -> completed transitions.
 */
export class ItemLifecycle {
  constructor(threadId, { maxItems = 2048, maxEvents = 4096 } = {}) {
    this.threadId = String(threadId)
    this.maxItems = maxItems
    this.maxEvents = maxEvents
    this.items = new Map()
    this.seenEvents = new Set()
    this.eventOrder = []
  }

  remember(eventKey) {
    if (!eventKey || this.seenEvents.has(eventKey)) return false
    this.seenEvents.add(eventKey)
    this.eventOrder.push(eventKey)
    while (this.eventOrder.length > this.maxEvents) this.seenEvents.delete(this.eventOrder.shift())
    return true
  }

  trimItems() {
    while (this.items.size > this.maxItems) this.items.delete(this.items.keys().next().value)
  }

  begin(item, context = {}) {
    const normalized = normalizeItem(item, { ...context, threadId: this.threadId, status: 'inProgress' })
    if (!normalized) return { accepted: false, item: undefined }
    const key = itemKey(this.threadId, context.turnId, normalized.id)
    const existing = this.items.get(key)
    const eventKey = `${key}:item:start:${context.event?.type || 'start'}:${normalized.sourceSeq ?? normalized.revision}`
    if (!this.remember(eventKey)) return { accepted: false, item: existing || normalized, key, existing }
    const merged = mergeItem(existing, normalized)
    const accepted = !existing || merged !== existing
    if (accepted) { this.items.set(key, merged); this.trimItems() }
    return { accepted, item: merged, key, existing }
  }

  complete(item, context = {}) {
    const normalized = normalizeItem(item, { ...context, threadId: this.threadId, status: context.status || 'completed' })
    if (!normalized) return { accepted: false, item: undefined }
    const key = itemKey(this.threadId, context.turnId, normalized.id)
    const existing = this.items.get(key)
    const eventKey = `${key}:item:complete:${context.event?.type || 'complete'}:${normalized.sourceSeq ?? normalized.revision}`
    if (!this.remember(eventKey)) return { accepted: false, item: existing || normalized, key, existing }
    const merged = mergeItem(existing, normalized)
    const accepted = !existing || merged !== existing || !isTerminalItemStatus(existing.status)
    if (accepted) { this.items.set(key, merged); this.trimItems() }
    return { accepted, item: merged, key, existing }
  }

  delta(itemId, { turnId, sourceSeq, sourceSubsequence, itemType = 'agentMessage', event } = {}) {
    const key = itemKey(this.threadId, turnId, itemId)
    const eventKey = `${key}:delta:${sourceSeq ?? 'none'}:${sourceSubsequence ?? 'none'}`
    const accepted = this.remember(eventKey)
    if (!accepted) return { accepted: false, item: this.items.get(key), key }
    const started = !this.items.has(key)
    if (started) {
      this.items.set(key, normalizeItem({ id: itemId, type: itemType }, { threadId: this.threadId, turnId, sourceSeq, event, status: 'inProgress' }))
      this.trimItems()
    }
    return { accepted: true, started, item: this.items.get(key), key }
  }

  snapshot() { return [...this.items.values()] }
}
