import { describe, expect, it } from 'vitest'
import { AppServer } from '../src/index.js'

function createAdapter() {
  const threads = new Map<string, any>()
  const listeners = new Set<(event: any) => void>()
  const emit = (event: any) => { for (const listener of listeners) listener(event) }
  const adapter: any = {
    threads,
    startThread: async (id: string, config: any = {}) => {
      const thread = { id, parentThreadId: config.parentThreadId, status: 'idle', turns: [] }
      threads.set(id, thread)
      return structuredClone(thread)
    },
    readThread: async (id: string) => {
      const thread = threads.get(id)
      if (!thread) throw new Error(`thread not found: ${id}`)
      return structuredClone(thread)
    },
    listThreads: async () => [...threads.values()].map(thread => structuredClone(thread)),
    startTurn: async (id: string, input: any) => {
      const thread = threads.get(id)
      const turn = { id: `turn-${id}`, threadId: id, status: 'inProgress', items: [{ id: `user-${id}`, type: 'userMessage', text: String(input) }] }
      thread.turns.push(turn)
      emit({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: id, turnId: turn.id, turn } })
      return structuredClone(turn)
    },
    steerTurn: async (id: string, input: any) => ({ id: `steer-${id}`, threadId: id, status: 'inProgress', input }),
    interruptTurn: async (id: string) => { emit({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: id, turn: { status: 'interrupted' } } }); return { interrupted: true } },
    closeThread: async (id: string) => { threads.delete(id); return { closed: true } },
    complete: (id: string, status = 'completed', text = 'child result') => {
      const thread = threads.get(id)
      thread.turns.at(-1).status = status
      thread.turns.at(-1).items.push({ id: `assistant-${id}`, type: 'agentMessage', text })
      emit({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: id, turnId: thread.turns.at(-1).id, turn: { id: thread.turns.at(-1).id, status } } })
    },
    subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return adapter
}

describe('subagent coordination protocol', () => {
  it('creates an independent child thread, exposes parent relation and is idempotent', async () => {
    const adapter = createAdapter()
    await adapter.startThread('parent')
    const server = new AppServer(null, { adapter })
    const events: any[] = []
    server.subscribe(event => events.push(event))
    await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const first = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'thread/subagent/spawn', params: { parentThreadId: 'parent', prompt: '检查配置', role: 'reviewer', clientMutationId: 'm-1' } })
    const second = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'thread/subagent/spawn', params: { parentThreadId: 'parent', prompt: '检查配置', role: 'reviewer', clientMutationId: 'm-1' } })
    const childId = first.result.subagent.childThreadId
    expect(second.result).toMatchObject({ idempotent: true, subagent: { childThreadId: childId } })
    expect(adapter.threads.get(childId).parentThreadId).toBe('parent')
    expect(events.some(event => event.method === 'item/started' && event.params.item.type === 'collabAgentToolCall')).toBe(true)

    adapter.complete(childId, 'completed', '配置分层清晰')
    await new Promise(resolve => setTimeout(resolve, 0))
    const list = await server.dispatch({ jsonrpc: '2.0', id: 4, method: 'thread/subagent/list', params: { parentThreadId: 'parent' } })
    expect(list.result.data[0]).toMatchObject({ childThreadId: childId, status: 'completed', result: { summary: '配置分层清晰' } })
    const parentRead = await server.dispatch({ jsonrpc: '2.0', id: 6, method: 'thread/read', params: { threadId: 'parent' } })
    expect(parentRead.result.subagents[0].childThreadId).toBe(childId)
    expect(events.some(event => event.method === 'item/completed' && event.params.item.id === first.result.subagent.itemId)).toBe(true)
  })

  it('supports explicit send, interrupt and close controls without copying child messages', async () => {
    const adapter = createAdapter()
    const server = new AppServer(null, { adapter })
    await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const spawned = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'thread/subagent/spawn', params: { parentThreadId: 'parent', prompt: '执行检查' } })
    const childId = spawned.result.subagent.childThreadId
    const sent = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'thread/subagent/send', params: { childThreadId: childId, mode: 'sendMessage', input: '继续' } })
    expect(sent.result.sent).toBe(true)
    const interrupted = await server.dispatch({ jsonrpc: '2.0', id: 4, method: 'thread/subagent/interrupt', params: { childThreadId: childId } })
    expect(interrupted.result.subagent.status).toBe('interrupted')
    const closed = await server.dispatch({ jsonrpc: '2.0', id: 5, method: 'thread/subagent/close', params: { childThreadId: childId } })
    expect(closed.result.closed).toBe(true)
  })

  it('prefers the DSH native subagent runtime and keeps continuable children non-terminal', async () => {
    const entries: any[] = []
    const calls: any[] = []
    const parentAgent = { session: { id: 'parent', header: { id: 'parent' } }, status: 'running' }
    const native = {
      list: () => ['spawn'],
      getProvider: () => ({ prepareContinuable: async () => ({}) }),
      listChildren: async () => structuredClone(entries),
      startContinuable: async (spec: any) => {
        calls.push({ kind: 'start', spec })
        const childId = spec.childId || 'native-child-1'
        entries.push({ kind: 'child', id: childId, activity: 'running', mode: 'continuable', label: spec.label })
        return { childId, messageId: 'accepted-1' }
      },
      prompt: async (request: any) => { calls.push({ kind: 'prompt', request }); return { messageId: 'accepted-2' } },
      interruptByParent: (childId: string, parentId: string, mode: string) => { calls.push({ kind: 'interrupt', childId, parentId, mode }); return { accepted: true } },
      drainContinuableChildren: async (parent: any, childIds: string[]) => { calls.push({ kind: 'close', parent, childIds }) },
    }
    const listeners = new Set<(event: any) => void>()
    const adapter: any = {
      ctx: { get: (name: string) => name === 'subagents' ? native : undefined },
      liveAgent: (id: string) => id === 'parent' ? parentAgent : undefined,
      subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      readThread: async (id: string) => ({ id, parentThreadId: 'parent', status: 'idle', turns: [] }),
    }
    const server = new AppServer(null, { adapter })
    await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const spawned = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'thread/subagent/spawn', params: {
      parentThreadId: 'parent', prompt: '检查', clientMutationId: 'mutation-1', description: '原生检查',
    } })
    const childId = spawned.result.subagent.childThreadId
    expect(childId).toBe('subagent-a09fc113a4d4461ad2dc625a')
    expect(calls[0].kind).toBe('start')
    expect(calls[0].spec.request.parent).toBe(parentAgent)

    entries[0].activity = 'inactive'
    for (const listener of listeners) listener({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: childId, turn: { status: 'completed' } } })
    const listed = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'thread/subagent/list', params: { parentThreadId: 'parent' } })
    expect(listed.result.data[0].status).toBe('idle')

    const sent = await server.dispatch({ jsonrpc: '2.0', id: 4, method: 'thread/subagent/send', params: { childThreadId: childId, mode: 'sendMessage', input: '继续' } })
    expect(sent.result.sent).toBe(true)
    expect(calls.at(-1).request.delivery).toBe('steer')
    const interrupted = await server.dispatch({ jsonrpc: '2.0', id: 5, method: 'thread/subagent/interrupt', params: { childThreadId: childId } })
    expect(interrupted.result.subagent.status).toBe('interrupted')
    const resumedByPrompt = await server.dispatch({ jsonrpc: '2.0', id: 55, method: 'thread/subagent/send', params: { childThreadId: childId, mode: 'sendMessage', input: '涓嬩竴姝�' } })
    expect(resumedByPrompt.result.sent).toBe(true)
    const closed = await server.dispatch({ jsonrpc: '2.0', id: 6, method: 'thread/subagent/close', params: { childThreadId: childId } })
    expect(closed.result).toMatchObject({ closed: true, durable: true, native: true })
  })
})
