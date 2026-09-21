import { describe, expect, it } from 'vitest'
import { ItemLifecycle } from '../src/protocol.js'

describe('item lifecycle contract', () => {
  it('deduplicates repeated starts and deltas while accepting an authoritative terminal snapshot', () => {
    const lifecycle = new ItemLifecycle('thread-1')
    const first = lifecycle.begin({ id: 'item-1', type: 'toolCall' }, { turnId: 'turn-1', sourceSeq: 10, event: { type: 'tool/call' } })
    const duplicate = lifecycle.begin({ id: 'item-1', type: 'toolCall', text: 'duplicate' }, { turnId: 'turn-1', sourceSeq: 10, event: { type: 'tool/call' } })
    expect(first.accepted).toBe(true)
    expect(duplicate.accepted).toBe(false)

    const delta = lifecycle.delta('item-2', { turnId: 'turn-1', sourceSeq: 30, sourceSubsequence: 0 })
    const duplicateDelta = lifecycle.delta('item-2', { turnId: 'turn-1', sourceSeq: 30, sourceSubsequence: 0 })
    expect(delta).toMatchObject({ accepted: true, started: true })
    expect(duplicateDelta.accepted).toBe(false)

    // Provider stream revisions and durable session sequences are different
    // domains; the completed durable snapshot must still win.
    const completed = lifecycle.complete({ id: 'item-2', type: 'agentMessage', text: 'done' }, { turnId: 'turn-1', sourceSeq: 12, event: { type: 'assistant/message' } })
    expect(completed).toMatchObject({ accepted: true, item: { status: 'completed', text: 'done' } })
  })
})
