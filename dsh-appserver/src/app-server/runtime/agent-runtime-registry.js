/**
 * Owns process-local Agent runtime state. Durable session history remains in
 * DSH persistence; this registry only tracks handles and transient projection
 * state that must be released when a thread closes.
 */
export class AgentRuntimeRegistry {
  constructor() {
    this.handles = new Map()
    this.resolutions = new Map()
    this.pendingTurns = new Map()
    this.activeTurns = new Map()
    this.assistantStreams = new Map()
    this.itemLifecycles = new Map()
  }

  handle(id) { return this.handles.get(String(id)) }
  setHandle(id, handle) { this.handles.set(String(id), handle); return handle }
  get size() { return this.handles.size }

  clearTransient(id) {
    const key = String(id)
    this.pendingTurns.delete(key)
    this.activeTurns.delete(key)
    this.assistantStreams.delete(key)
    this.itemLifecycles.delete(key)
  }

  async close(id) {
    const key = String(id)
    const handle = this.handles.get(key)
    this.handles.delete(key)
    this.resolutions.delete(key)
    this.clearTransient(key)
    if (!handle) return false
    await handle.dispose?.()
    return true
  }

  async dispose() {
    const handles = [...this.handles.values()]
    this.handles.clear()
    this.resolutions.clear()
    this.pendingTurns.clear()
    this.activeTurns.clear()
    this.assistantStreams.clear()
    this.itemLifecycles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose?.()))
  }
}
