/** Bounded, expiring cache for deterministic event-log projections. */
export class ProjectionCache {
  constructor({ maxSessions = 64, ttlMs = 5 * 60_000, maxEstimatedBytes = 64 * 1024 * 1024 } = {}) {
    this.config = { maxSessions, ttlMs, maxEstimatedBytes }
    this.entries = new Map()
    this.inflight = new Map()
    this.estimatedBytes = 0
  }
  key(events) { return `${events.length}:${events.at(-1)?.seq ?? -1}` }
  estimate(value) { try { return Buffer.byteLength(JSON.stringify(value), 'utf8') } catch { return 0 } }
  entry(sessionId, events) {
    const id = String(sessionId), version = this.key(events), now = Date.now()
    let entry = this.entries.get(id)
    if (!entry || entry.version !== version || now - entry.accessedAt > this.config.ttlMs) {
      if (entry) this.estimatedBytes -= entry.bytes
      entry = { version, values: new Map(), bytes: 0, accessedAt: now }
    }
    entry.accessedAt = now
    this.entries.delete(id); this.entries.set(id, entry)
    return entry
  }
  get(sessionId, kind, events, project) {
    const entry = this.entry(sessionId, events)
    if (!entry.values.has(kind)) {
      const value = project()
      const bytes = this.estimate(value)
      entry.values.set(kind, value); entry.bytes += bytes; this.estimatedBytes += bytes
      this.prune()
    }
    return entry.values.get(kind)
  }
  async getAsync(sessionId, kind, events, project) {
    const version = this.key(events), key = `${sessionId}:${kind}:${version}`
    const entry = this.entry(sessionId, events)
    if (entry.values.has(kind)) return entry.values.get(kind)
    if (this.inflight.has(key)) return this.inflight.get(key)
    const promise = Promise.resolve().then(project).then(value => {
      const bytes = this.estimate(value)
      entry.values.set(kind, value); entry.bytes += bytes; this.estimatedBytes += bytes
      this.prune(); return value
    }).finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }
  prune() {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (now - entry.accessedAt > this.config.ttlMs || this.entries.size > this.config.maxSessions || this.estimatedBytes > this.config.maxEstimatedBytes) {
        this.entries.delete(id); this.estimatedBytes -= entry.bytes
      } else break
    }
  }
  invalidate(sessionId) {
    const entry = this.entries.get(String(sessionId)); if (entry) this.estimatedBytes -= entry.bytes
    this.entries.delete(String(sessionId))
  }
  clear() { this.entries.clear(); this.inflight.clear(); this.estimatedBytes = 0 }
  snapshot() { return { sessions: this.entries.size, inflight: this.inflight.size, estimatedBytes: this.estimatedBytes, ...this.config } }
}
