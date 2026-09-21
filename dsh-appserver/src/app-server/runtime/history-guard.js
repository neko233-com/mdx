import { HistoryTooLargeError, RequestCancelledError, ResultTooLargeError } from '../protocol/domain-errors.js'

export class HistoryGuard {
  constructor({ concurrency = 2, maxQueued = 16, timeoutMs = 3000, warningEvents = 5000, maxProjectionEvents = 20000, maxResultBytes = 10 * 1024 * 1024 } = {}) {
    this.config = { concurrency, maxQueued, timeoutMs, warningEvents, maxProjectionEvents, maxResultBytes }
    this.active = 0
    this.queue = []
  }

  async run(operation, { signal } = {}) {
    if (this.active >= this.config.concurrency) {
      if (this.queue.length >= this.config.maxQueued) throw new HistoryTooLargeError('history queue is full', { queueDepth: this.queue.length })
      await new Promise((resolve, reject) => {
        const row = { resolve, reject, signal }
        row.abort = () => { this.queue = this.queue.filter(item => item !== row); reject(new RequestCancelledError()) }
        signal?.addEventListener?.('abort', row.abort, { once: true })
        this.queue.push(row)
      })
    }
    if (signal?.aborted) throw new RequestCancelledError()
    this.active++
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const abort = () => controller.abort()
    signal?.addEventListener?.('abort', abort, { once: true })
    try {
      return await operation(controller.signal)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener?.('abort', abort)
      this.active--
      const next = this.queue.shift()
      if (next) { next.signal?.removeEventListener?.('abort', next.abort); next.resolve() }
    }
  }

  checkEvents(events, context = {}) {
    if (events.length > this.config.maxProjectionEvents) {
      throw new HistoryTooLargeError('session history exceeds the local projection limit', { ...context, eventCount: events.length, maxProjectionEvents: this.config.maxProjectionEvents })
    }
  }

  checkResult(value, context = {}) {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > this.config.maxResultBytes) throw new ResultTooLargeError(bytes, this.config.maxResultBytes, context)
    return { value, bytes }
  }

  snapshot() { return { active: this.active, queued: this.queue.length, ...this.config } }
}
