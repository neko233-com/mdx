import { requiredString } from '../protocol/json-rpc.js'
import { GoalService } from '../services/goal-service.js'

export function goalMethods(adapter) {
  const service = adapter.goalService || new GoalService(adapter)
  return {
    'thread/goal/get': p => service.get(requiredString(p.threadId, 'threadId')),
    'thread/goal/set': p => service.set(requiredString(p.threadId, 'threadId'), p),
    'thread/goal/clear': p => service.clear(requiredString(p.threadId, 'threadId'), p),
  }
}
