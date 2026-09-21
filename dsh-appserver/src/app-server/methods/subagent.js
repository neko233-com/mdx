import { SubagentService } from '../services/subagent-service.js'
import { requiredString } from '../protocol/json-rpc.js'

export function subagentMethods(adapter, notify) {
  const service = adapter.subagentService || new SubagentService(adapter, { notify })
  adapter.subagentService = service
  return {
    'thread/subagent/spawn': (p, context) => service.spawn(requiredString(p.parentThreadId, 'parentThreadId'), p, context),
    'thread/subagent/list': (p, context) => service.list(requiredString(p.parentThreadId, 'parentThreadId'), context),
    'thread/subagent/send': (p, context) => service.send(requiredString(p.childThreadId, 'childThreadId'), p, context),
    'thread/subagent/resume': (p, context) => service.resume(requiredString(p.childThreadId, 'childThreadId'), context),
    'thread/subagent/interrupt': (p, context) => service.interrupt(requiredString(p.childThreadId, 'childThreadId'), context),
    'thread/subagent/wait': (p, context) => service.wait(requiredString(p.childThreadId, 'childThreadId'), context),
    'thread/subagent/close': (p, context) => service.close(requiredString(p.childThreadId, 'childThreadId'), context),
  }
}
