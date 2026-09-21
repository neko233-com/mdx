/** Disposable process-local index. Correctness always falls back to the event log. */
export class SessionProjectionIndex {
  constructor({ maxSessions = 64 } = {}) { this.maxSessions = maxSessions; this.sessions = new Map() }
  empty() { return { lastSequence: -1, eventCount: 0, turns: [], tools: new Map(), commands: new Map(), compactions: [] } }
  ingest(sessionId, event) {
    const id = String(sessionId), state = this.sessions.get(id) || this.empty()
    if (Number(event?.seq) <= state.lastSequence) return state
    state.lastSequence = Number(event?.seq ?? state.lastSequence)
    state.eventCount += 1
    if (event.type === 'turn/start') state.turns.push({ number: event.data?.turn, startSequence: event.seq, endSequence: null, status: 'inProgress' })
    if (event.type === 'turn/end' && state.turns.length) Object.assign(state.turns.at(-1), { endSequence: event.seq, status: event.data?.status || event.data?.reason?.kind || 'completed' })
    if (event.type === 'tool/call') state.tools.set(String(event.data?.callId || event.data?.id), { callSequence: event.seq, name: event.data?.name || event.data?.toolName })
    if (event.type === 'tool/result') { const row = state.tools.get(String(event.data?.callId || event.data?.toolCallId)); if (row) row.resultSequence = event.seq }
    if (event.type === 'command/run') state.commands.set(String(event.data?.commandId || event.data?.id), { runSequence: event.seq, command: event.data?.command || event.data?.line })
    if (event.type === 'command/done') { const row = state.commands.get(String(event.data?.commandId || event.data?.id)); if (row) row.doneSequence = event.seq }
    if (event.type === 'user/message' && event.surfaceOp?.op === 'replace') state.compactions.push(event.seq)
    this.sessions.delete(id); this.sessions.set(id, state)
    while (this.sessions.size > this.maxSessions) this.sessions.delete(this.sessions.keys().next().value)
    return state
  }
  build(sessionId, events) { const id = String(sessionId); this.sessions.delete(id); for (const event of events) this.ingest(id, event); return this.sessions.get(id) || this.empty() }
  ensure(sessionId, events) {
    const state = this.sessions.get(String(sessionId))
    return state?.lastSequence === Number(events.at(-1)?.seq ?? -1) && state.eventCount === events.length
      ? state
      : this.build(sessionId, events)
  }
  delete(sessionId) { this.sessions.delete(String(sessionId)) }
  clear() { this.sessions.clear() }
}
