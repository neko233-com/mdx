import {
  assistantChunkText, isPlanSteerPromptEvent, itemFromEvent,
  stableAssistantStreamItemId, stableTurnId, turnEndError, turnEndStatus,
} from './event-projector.js'
import { applyGoalChange } from '../services/goal-service.js'
import { ItemLifecycle } from '../services/item-lifecycle-service.js'

/** Converts durable DSH events into the resumable notification stream. */
export function projectNotifications(threadId, events) {
  const notifications = []
  const legacyAssistantItemIds = new Map()
  let activeTurnId
  let goal = null
  const lifecycle = new ItemLifecycle(threadId)
  for (const event of events || []) {
    if (event.type === 'goal/change') {
      goal = applyGoalChange(goal, event.data, threadId, event)
      notifications.push({ jsonrpc: '2.0', method: 'goal/changed', params: { threadId, sourceSeq: event.seq, change: event.data } })
      notifications.push({
        jsonrpc: '2.0', method: goal ? 'thread/goal/updated' : 'thread/goal/cleared',
        params: { threadId, sourceSeq: event.seq, ...(goal ? { goal } : { goalId: event.data?.goal?.id || event.data?.goalId || undefined }), change: event.data },
      })
      continue
    }
    if (isPlanSteerPromptEvent(events, event)) continue
    const number = event.data?.turn
    if (event.type === 'turn/start') {
      activeTurnId = stableTurnId(threadId, number ?? event.seq)
      notifications.push({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turnId: activeTurnId, sourceSeq: event.seq, turn: { id: activeTurnId, threadId, status: 'inProgress', items: [] } } })
      continue
    }
    if (event.type === 'assistant/chunk') {
      const delta = assistantChunkText(event.data)
      if (delta !== undefined) {
        const turn = event.data?.turn
        const step = event.data?.step
        const key = turn == null || step == null ? String(activeTurnId || 'current') : `${turn}:${step}`
        const itemId = legacyAssistantItemIds.get(key) || stableAssistantStreamItemId(threadId, `legacy-${key}`)
        legacyAssistantItemIds.set(key, itemId)
        const turnId = activeTurnId || (number == null ? undefined : stableTurnId(threadId, number))
        const transition = lifecycle.delta(itemId, { turnId, sourceSeq: event.seq, sourceSubsequence: event.data?.chunk?.index, event })
        if (transition.accepted && transition.started) notifications.push({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, sourceSeq: event.seq, item: transition.item } })
        if (transition.accepted) notifications.push({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, sourceSeq: event.seq, ...(event.data?.chunk?.index == null ? {} : { sourceSubsequence: event.data.chunk.index }), revision: transition.item?.revision, delta } })
      }
      continue
    }
    const item = itemFromEvent(threadId, event)
    if (item) {
      const turnId = activeTurnId || (number == null ? undefined : stableTurnId(threadId, number))
      // Reconcile legacy assistant chunks with the durable assistant snapshot
      // when both use the same turn/step identity.
      if (event.type === 'assistant/message') {
        const turn = event.data?.turn
        const step = event.data?.step
        const key = turn == null || step == null ? undefined : `${turn}:${step}`
        const streamItemId = key ? legacyAssistantItemIds.get(key) : undefined
        if (streamItemId) item.id = streamItemId
      }
      const terminal = ['user/message', 'assistant/message', 'tool/result', 'approval/decided'].includes(event.type)
      const transition = terminal
        ? lifecycle.complete(item, { turnId, sourceSeq: event.seq, event })
        : lifecycle.begin(item, { turnId, sourceSeq: event.seq, event })
      if (transition.accepted && transition.existing === undefined) notifications.push({ jsonrpc: '2.0', method: 'item/started', params: { threadId, turnId, sourceSeq: event.seq, item: transition.item } })
      if (transition.accepted && terminal) notifications.push({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, turnId, sourceSeq: event.seq, item: transition.item } })
    }
    if (event.type === 'turn/end') {
      const turnId = activeTurnId || stableTurnId(threadId, number ?? event.seq)
      const failure = turnEndError(event.data)
      notifications.push({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turnId, sourceSeq: event.seq, turn: { id: turnId, threadId, status: turnEndStatus(event.data), items: [], ...(failure ? { error: failure } : {}) } } })
      activeTurnId = undefined
    }
  }
  return notifications
}
