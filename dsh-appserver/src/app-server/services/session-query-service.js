import { projectHistoryMessages } from '../projections/transcript-projector.js'
import { RequestCancelledError, SessionNotFoundError } from '../protocol/domain-errors.js'

function lowerBound(events, sequence, inclusive) {
  if (!Number.isFinite(sequence)) return events.length
  let low = 0; let high = events.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const value = Number(events[middle]?.seq)
    if (value < sequence || (!inclusive && value === sequence)) low = middle + 1
    else high = middle
  }
  return low
}

function pageRange(events, beforeSequence, ceiling, limit) {
  const beforeEnd = lowerBound(events, Number(beforeSequence), true)
  const ceilingEnd = lowerBound(events, Number(ceiling), false)
  const end = Math.min(beforeEnd, ceilingEnd)
  const starts = []
  for (let index = end - 1; index >= 0; index--) {
    if (events[index].type === 'turn/start' && starts.push(index) > limit) break
  }
  if (!starts.length) return { events: events.slice(0, end), oldestSequence: events[0]?.seq ?? null, hasMore: false }
  let oldest = starts[Math.min(limit, starts.length) - 1]
  while (oldest > 0 && ['command/run', 'command/done'].includes(events[oldest - 1]?.type)) oldest--
  return { events: events.slice(oldest, end), oldestSequence: events[oldest]?.seq ?? null, hasMore: starts.length > limit }
}

function number(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function dispose(value) { value?.[Symbol.dispose]?.() }

export class SessionQueryService {
  constructor(ctx, repository, { projectThread, startThread, historyGuard, projectionIndex, projectionWorkers }) {
    this.ctx = ctx
    this.repository = repository
    this.projectThread = projectThread
    this.startThread = startThread
    this.historyGuard = historyGuard
    this.projectionIndex = projectionIndex
    this.projectionWorkers = projectionWorkers
  }

  async flush(id) {
    const session = this.repository.live(id)
    if (session) {
      try { return { flushed: await this.ctx.sessions.flush(session) } } catch { /* committed state fallback */ }
    }
    await this.repository.metadata(id)
    return { flushed: true }
  }

  async ensure(id) {
    const live = this.repository.live(id)
    if (live) return this.projectThread(live)
    try {
      const snapshot = await this.repository.snapshot(id)
      return this.projectThread({ id, header: snapshot.header, events: snapshot.events }, 'idle')
    } catch (error) {
      if (!(error instanceof SessionNotFoundError)) throw error
      return this.startThread(id)
    }
  }

  async history(id, options = {}, execution = {}) {
    return this.historyGuard.run(signal => this.projectHistory(id, options, signal), execution)
  }

  async projectHistory(id, { beforeSequence, snapshotSequence, limit = 50 } = {}, signal) {
    const live = this.repository.live(id)
    const snapshot = live && Array.isArray(live.events)
      ? { header: live.header, events: live.events }
      : await this.repository.snapshot(id)
    const all = snapshot.events || []
    if (signal?.aborted) throw new RequestCancelledError()
    const ceiling = Number.isInteger(Number(snapshotSequence)) ? Number(snapshotSequence) : Number(all.at(-1)?.seq ?? 0)
    const before = Number.isInteger(Number(beforeSequence)) ? Number(beforeSequence) : Number.POSITIVE_INFINITY
    const index = this.projectionIndex?.ensure(id, all)
    const page = pageRange(all, before, ceiling, Math.min(200, Math.max(1, Number(limit) || 50)))
    this.historyGuard.checkEvents(page.events, { sessionId: id, operation: 'history-page' })
    const toolNames = new Map()
    for (const [callId, tool] of index?.tools || []) {
      if (tool?.name) toolNames.set(String(callId), String(tool.name))
    }
    const projectionPayload = { sessionId: id, events: page.events, toolNames: [...toolNames], allEvents: page.events, options: { preserveCompactedHistory: true } }
    const offloaded = this.projectionWorkers?.shouldOffload(page.events.length) === true
    const messages = offloaded
      ? await this.projectionWorkers.run('history', projectionPayload, { signal })
      : projectHistoryMessages(id, page.events, toolNames, page.events, { preserveCompactedHistory: true })
    const result = {
      sessionId: id,
      messages,
      oldestSequence: page.oldestSequence == null ? null : Number(page.oldestSequence),
      snapshotSequence: ceiling,
      hasMore: page.hasMore,
      meta: { eventCount: all.length, selectedEventCount: page.events.length, projectionMode: offloaded ? 'worker' : 'inline', degraded: false },
    }
    this.historyGuard.checkResult(result, { sessionId: id })
    return result
  }

  async usage(id) {
    const query = this.ctx.get?.('sessionQuery') || this.ctx.sessionQuery
    let observation
    try {
      observation = typeof query?.observeSession === 'function' ? await query.observeSession(id, { projectionMode: 'all' }) : null
      const snapshot = observation ? { events: observation.events } : await this.repository.snapshot(id)
      const events = snapshot.events || []
      const legacy = events.filter(event => event.type === 'assistant/message' && event.data?.usage).reduce((total, event) => {
        const data = event.data.usage
        total.inputTokens += Number(data.inputTokens || data.input_tokens || 0)
        total.outputTokens += Number(data.outputTokens || data.output_tokens || 0)
        total.cacheReadTokens += Number(data.cacheReadTokens || data.cache_read_tokens || 0)
        total.cacheWriteTokens += Number(data.cacheWriteTokens || data.cache_write_tokens || 0)
        return total
      }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
      const projections = observation?.projections?.values || {}
      const totals = projections.tokenUsage?.totals || projections.tokenUsage || {}
      const pressure = projections.contextPressure || {}
      const context = [...events].reverse().find(event => event.type === 'request/context')?.data || {}
      return {
        sessionId: id,
        inputTokens: number(totals.uncachedInputTokens, legacy.inputTokens), outputTokens: number(totals.outputTokens, legacy.outputTokens),
        cacheReadTokens: number(totals.cacheReadTokens, legacy.cacheReadTokens), cacheWriteTokens: number(totals.cacheWriteTokens, legacy.cacheWriteTokens),
        contextTokens: pressure.projectedTokens ?? context.contextTokens ?? null,
        contextWindow: pressure.contextWindow ?? context.contextWindow ?? null,
        modelId: context.model ?? context.modelId ?? null,
      }
    } finally { dispose(observation) }
  }
}
