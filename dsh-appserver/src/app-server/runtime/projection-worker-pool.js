import { Worker } from 'node:worker_threads'
import { RequestCancelledError } from '../protocol/domain-errors.js'

export class ProjectionWorkerPool {
  constructor({ size = 2, thresholdEvents = 5000, timeoutMs = 5000 } = {}) {
    this.config = { size, thresholdEvents, timeoutMs }
    this.queue = []; this.workers = []; this.nextId = 1; this.closed = false
  }
  shouldOffload(eventCount) { return eventCount >= this.config.thresholdEvents && this.config.size > 0 }
  run(kind, payload, { signal } = {}) {
    if (this.closed) return Promise.reject(new Error('Projection worker pool is closed'))
    return new Promise((resolve, reject) => {
      const task = { id: this.nextId++, kind, payload, signal, resolve, reject }
      task.abort = () => { this.queue = this.queue.filter(row => row !== task); reject(new Error('Projection task cancelled')) }
      signal?.addEventListener?.('abort', task.abort, { once: true })
      this.queue.push(task); this.drain()
    })
  }
  drain() {
    while (!this.closed && this.workers.length < this.config.size && this.queue.length) this.start(this.queue.shift())
  }
  start(task) {
    if (task.signal?.aborted) { task.abort(); this.drain(); return }
    const worker = new Worker(new URL('./projection-worker.js', import.meta.url), {
      // `--input-type` is valid for the parent eval/STDIN process but invalid
      // when Node starts a Worker from a file URL.
      execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
    })
    const row = { worker, task }; this.workers.push(row)
    const finish = (error, result) => {
      if (row.settled) return
      row.settled = true
      clearTimeout(row.timer); task.signal?.removeEventListener?.('abort', task.abort)
      this.workers = this.workers.filter(value => value !== row)
      row.termination = Promise.resolve(worker.terminate())
      error ? task.reject(error) : task.resolve(result); this.drain()
    }
    row.finish = finish
    task.signal?.removeEventListener?.('abort', task.abort)
    task.abort = () => finish(new RequestCancelledError())
    task.signal?.addEventListener?.('abort', task.abort, { once: true })
    row.timer = setTimeout(() => finish(new Error('Projection worker timed out')), this.config.timeoutMs)
    worker.once('error', error => finish(error))
    worker.on('message', message => message.id === task.id && finish(message.error ? new Error(message.error) : null, message.result))
    worker.postMessage({ id: task.id, kind: task.kind, payload: task.payload })
  }
  async dispose() {
    this.closed = true
    for (const task of this.queue.splice(0)) task.reject(new Error('Projection worker pool disposed'))
    const active = [...this.workers]
    for (const row of active) row.finish(new RequestCancelledError())
    await Promise.allSettled(active.map(row => row.termination))
    this.workers = []
  }
  snapshot() { return { active: this.workers.length, queued: this.queue.length, ...this.config } }
}
