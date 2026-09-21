import { SessionNotFoundError } from '../protocol/domain-errors.js'

/** Read-only access to live and durable DSH sessions. Never takes a write handle. */
export class SessionRepository {
  constructor(ctx, runtimeRegistry) {
    this.ctx = ctx
    this.runtimeRegistry = runtimeRegistry
  }

  live(id) {
    const key = String(id)
    let session = this.runtimeRegistry.handle(key)?.agent?.session
    if (!session) {
      try { session = this.ctx.sessions?.get?.(key) } catch { /* inactive scoped session */ }
    }
    return session
  }

  persistence() {
    return this.ctx.sessionPersistence || this.ctx.get?.('sessionPersistence') || this.ctx.get?.('sessionPersistence', false)
  }

  async snapshot(id) {
    const key = String(id)
    const live = this.live(key)
    if (live && Array.isArray(live.events)) return { header: live.header, events: [...live.events] }

    const persistence = this.persistence()
    let snapshot
    if (typeof persistence?.open === 'function') {
      let handle
      try {
        handle = await persistence.open(key, 'read')
        const result = await handle.read()
        const events = Array.isArray(result) ? result : result?.events
        if (!Array.isArray(events)) throw new TypeError(`invalid session read result for ${key}`)
        snapshot = { header: handle.header || result?.header, events: [...events] }
      } finally {
        await handle?.close?.()
      }
    } else if (typeof persistence?.inspect === 'function') {
      snapshot = await persistence.inspect(key)
    }
    if (!snapshot) throw new SessionNotFoundError(key)
    return snapshot
  }

  async metadata(id) {
    const key = String(id)
    const live = this.live(key)
    if (live) return { header: live.header }
    const persistence = this.persistence()
    const value = typeof persistence?.stat === 'function'
      ? await persistence.stat(key)
      : await persistence?.inspect?.(key)
    if (!value) throw new SessionNotFoundError(key)
    return value
  }

  async eventsAfter(id, afterSeq = -1, limit = 200) {
    const key = String(id)
    const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 200))
    const live = this.live(key)
    if (live && Array.isArray(live.events)) {
      const events = live.events
      const boundary = Number(afterSeq)
      let low = 0; let high = events.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (Number(events[middle]?.seq) <= boundary) low = middle + 1
        else high = middle
      }
      const start = low
      const selected = events.slice(start, start + boundedLimit)
      const lastSeq = Number(selected.at(-1)?.seq ?? afterSeq)
      const finalSeq = Number(events.at(-1)?.seq ?? -1)
      return {
        events: selected,
        nextCursor: lastSeq < finalSeq ? String(lastSeq) : null,
        complete: start + selected.length >= events.length,
        snapshotSequence: finalSeq,
      }
    }
    const persistence = this.persistence()
    // Newer hosts may provide a bounded event reader. Prefer it so SSE resume
    // and event browsing do not materialize an entire long-running session.
    if (!this.live(key) && typeof persistence?.readEvents === 'function') {
      const result = await persistence.readEvents(key, { afterSequence: Number(afterSeq), limit: boundedLimit })
      const events = Array.isArray(result) ? result : result?.events
      if (!Array.isArray(events)) throw new TypeError(`invalid paged session result for ${key}`)
      return {
        events,
        nextCursor: result?.nextCursor ?? (events.length === boundedLimit ? String(events.at(-1)?.seq) : null),
        complete: result?.nextCursor == null && events.length < boundedLimit,
        snapshotSequence: Number(result?.snapshotSequence ?? events.at(-1)?.seq ?? afterSeq),
      }
    }
    const snapshot = await this.snapshot(key)
    const selected = (snapshot.events || []).filter(event => Number(event.seq) > Number(afterSeq)).slice(0, boundedLimit)
    const finalSeq = Number(snapshot.events?.at(-1)?.seq ?? -1)
    const lastSeq = Number(selected.at(-1)?.seq ?? afterSeq)
    return { events: selected, nextCursor: lastSeq < finalSeq ? String(lastSeq) : null, complete: true, snapshotSequence: finalSeq }
  }

  async list() {
    const persistence = this.persistence()
    return typeof persistence?.list === 'function' ? (await persistence.list()) || [] : []
  }
}
