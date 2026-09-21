import { describe, expect, it } from 'vitest'
import { HistoryGuard } from '../src/app-server/runtime/history-guard.js'
import { ProjectionCache } from '../src/app-server/projections/projection-cache.js'
import { SessionProjectionIndex } from '../src/app-server/projections/session-projection-index.js'
import { SessionRepository } from '../src/app-server/services/session-repository.js'
import { RequestScheduler } from '../src/app-server/runtime/request-scheduler.js'

describe('long-session production guards', () => {
  it('rejects an event log above the configured projection limit', () => {
    const guard = new HistoryGuard({ maxProjectionEvents: 10 })
    expect(() => guard.checkEvents(Array.from({ length: 11 }), { sessionId: 'large' })).toThrow(/projection limit/)
  })

  it('keeps a bounded projection cache', () => {
    const cache = new ProjectionCache({ maxSessions: 2, maxEstimatedBytes: 1024 * 1024 })
    for (let index = 0; index < 3; index++) cache.get(`s${index}`, 'turns', [{ seq: index }], () => [{ id: index }])
    expect(cache.snapshot().sessions).toBeLessThanOrEqual(2)
  })

  it('incrementally indexes a synthetic long session', () => {
    const index = new SessionProjectionIndex({ maxSessions: 2 })
    const events = Array.from({ length: 10_000 }, (_, seq) => seq % 10 === 0
      ? { seq, type: 'turn/start', data: { turn: seq / 10 } }
      : seq % 10 === 9
        ? { seq, type: 'turn/end', data: { turn: Math.floor(seq / 10), status: 'completed' } }
        : { seq, type: 'assistant/message', data: {} })
    const state = index.build('long', events)
    expect(state.lastSequence).toBe(9999)
    expect(state.turns).toHaveLength(1000)
    expect(state.turns.at(-1)?.endSequence).toBe(9999)
  })

  it('pages a live long session without cloning the complete event log', async () => {
    const events = Array.from({ length: 10_000 }, (_, seq) => ({ seq, type: 'assistant/message', data: { turn: 1 } }))
    const repository = new SessionRepository({ sessions: { get: () => ({ events }) } }, { handle: () => undefined, history: new Map() })
    const page = await repository.eventsAfter('long', 9_899, 50)
    expect(page.events).toHaveLength(50)
    expect(page.events[0].seq).toBe(9_900)
    expect(page.nextCursor).toBe('9949')
    expect(page.snapshotSequence).toBe(9_999)
  })

  it('cancels active and queued scheduler requests on shutdown', async () => {
    const scheduler = new RequestScheduler()
    const operation = (signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
    const first = scheduler.run({ method: 'turn/start', params: { threadId: 'same' } }, operation)
    const second = scheduler.run({ method: 'turn/start', params: { threadId: 'same' } }, operation)
    const settled = Promise.allSettled([first, second])
    scheduler.clear()
    expect((await settled).map(result => result.status)).toEqual(['rejected', 'rejected'])
  })
})
