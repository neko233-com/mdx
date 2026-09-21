import { requiredString } from '../protocol/json-rpc.js'

export function sessionMethods(adapter) {
  const query = adapter.sessionQueryService
  const id = p => requiredString(p.sessionId || p.threadId, 'sessionId')
  return {
    'session/flush': p => query?.flush(id(p)) ?? adapter.flush(id(p)),
    'session/ensure': p => query?.ensure(id(p)) ?? adapter.ensureSession(id(p)),
    'session/prompt': async p => ({ turn: await adapter.startTurn(id(p), p.modelText ?? p.input) }),
    'session/history': (p, context) => query?.history(id(p), p, context) ?? adapter.sessionHistory(id(p), p),
    'session/dispose': async p => ({ disposed: (await adapter.closeThread(id(p))).closed }),
    'run/cancel': async p => ({ cancelled: (await adapter.interruptTurn(id(p))).interrupted }),
  }
}
