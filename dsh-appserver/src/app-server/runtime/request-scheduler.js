import { RequestCancelledError } from '../protocol/domain-errors.js'
import { methodSchedule } from '../protocol/method-schema.js'

/** Serializes mutations by resource without forcing unrelated global reads to wait. */
export class RequestScheduler {
  constructor({ maxQueuedRequests = 1024 } = {}) {
    this.maxQueuedRequests = maxQueuedRequests
    this.queuedRequests = 0
    this.queues = new Map()
    this.controllers = new Set()
    this.closed = false
  }

  key(request) {
    const params = request?.params
    const id = params && typeof params === 'object' && !Array.isArray(params)
      ? params.threadId || params.sessionId || params.parentThreadId || params.childThreadId
      : undefined
    if (typeof id === 'string' && id) return `thread:${id}`
    const schedule = methodSchedule(request?.method)
    if (schedule === 'model-config') return 'admin:model-config'
    if (schedule === 'config') return 'admin:config'
    if (schedule === 'mcp') return 'admin:mcp'
    if (schedule === 'credential') return 'admin:credential'
    if (schedule === 'connection') return `connection:${request?.connectionId || 'default'}`
    return `request:${String(request?.id ?? Math.random())}`
  }

  run(request, operation, signal) {
    if (this.closed || this.queuedRequests >= this.maxQueuedRequests) return null
    this.queuedRequests++
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener?.('abort', abort, { once: true })
    this.controllers.add(controller)
    const key = this.key(request)
    const previous = this.queues.get(key) || Promise.resolve()
    const current = previous.then(() => {
      if (controller.signal.aborted) throw new RequestCancelledError()
      return operation(controller.signal)
    })
    const tail = current.catch(() => undefined).finally(() => {
      this.queuedRequests--
      this.controllers.delete(controller)
      signal?.removeEventListener?.('abort', abort)
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    this.queues.set(key, tail)
    return current
  }

  clear() {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    this.queues.clear()
  }
  snapshot() { return { queuedRequests: this.queuedRequests, activeQueues: this.queues.size, maxQueuedRequests: this.maxQueuedRequests } }
}
