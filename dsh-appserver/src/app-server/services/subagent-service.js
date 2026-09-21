import { createHash, randomUUID } from 'node:crypto'
import { CapabilityUnavailableError, InvalidInputError, RequestCancelledError } from '../protocol/domain-errors.js'

const TERMINAL = new Set(['completed', 'failed', 'interrupted', 'closed', 'notFound'])
const CONTROL_MODES = new Set(['message', 'sendMessage', 'sendInput', 'followupTask'])

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function dshLaunchConfig(value) {
  const source = object(value)
  return {
    ...(typeof source.cwd === 'string' && source.cwd ? { cwd: source.cwd } : {}),
    ...(typeof source.provider === 'string' && source.provider ? { provider: source.provider } : {}),
    ...(typeof source.model === 'string' && source.model ? { model: source.model } : {}),
    ...(Number.isSafeInteger(source.maxTokens) && source.maxTokens > 0 ? { maxTokens: source.maxTokens } : {}),
    ...(typeof source.agentPreset === 'string' && source.agentPreset ? { agentPreset: source.agentPreset } : {}),
    ...(typeof source.permissionMode === 'string' && source.permissionMode ? { permissionMode: source.permissionMode } : {}),
  }
}
function clone(value) {
  try { return structuredClone(value) } catch { return value }
}
function stringValue(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function inputText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  throw new InvalidInputError('input', 'must be a non-empty string, array or object')
}
function pathValue(value) {
  if (value === undefined) return []
  const path = Array.isArray(value) ? value : typeof value === 'string' ? value.split('.') : null
  if (!path || !path.length || !path.every(part => typeof part === 'string' && part.trim())) throw new InvalidInputError('agentPath', 'must be a non-empty string array')
  return path.map(part => part.trim())
}
function statusOf(value) {
  const status = stringValue(value)
  if (status === 'running' || status === 'active' || status === 'inProgress') return 'running'
  if (status === 'failed' || status === 'errored' || status === 'error') return 'errored'
  if (status === 'interrupted' || status === 'cancelled') return 'interrupted'
  if (status === 'closed' || status === 'shutdown') return 'shutdown'
  if (status === 'completed' || status === 'idle') return status === 'completed' ? 'completed' : 'idle'
  return 'pendingInit'
}
function terminalItemStatus(status) {
  return status === 'completed' ? 'completed' : status === 'interrupted' || status === 'closed' ? 'cancelled' : 'failed'
}

function abortSignal(value) {
  return value && typeof value.aborted === 'boolean' ? value : new AbortController().signal
}

function contentBlocks(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (value && typeof value === 'object') {
    if (Array.isArray(value.content)) return value.content
    if (typeof value.type === 'string') return [value]
    if (typeof value.text === 'string') return [{ type: 'text', text: value.text }]
  }
  return [{ type: 'text', text: String(value ?? '') }]
}

function stableChildId(parentThreadId, mutationId) {
  const digest = createHash('sha256').update(`${String(parentThreadId)}:${String(mutationId)}`).digest('hex').slice(0, 24)
  return `subagent-${digest}`
}

function nativeSubagentRuntime(adapter) {
  try {
    return adapter?.nativeSubagents
      || adapter?.ctx?.get?.('subagents')
      || adapter?.ctx?.subagents
  } catch {
    return undefined
  }
}

function nativeStatus(entry) {
  return entry?.activity === 'running' ? 'running' : 'idle'
}

function ensureNativeContinuable(state) {
  if (state?.mode === 'one-shot') {
    throw new InvalidInputError('childThreadId', 'only continuable DSH subagents support this operation')
  }
}

export function normalizeSubagentRef(value) {
  const source = object(value)
  const childThreadId = stringValue(source.childThreadId) || stringValue(source.threadId) || stringValue(source.id)
  if (!childThreadId) return undefined
  const status = stringValue(source.status) || 'pendingInit'
  return {
    parentThreadId: stringValue(source.parentThreadId),
    childThreadId,
    callId: stringValue(source.callId),
    itemId: stringValue(source.itemId),
    clientMutationId: stringValue(source.clientMutationId),
    runId: stringValue(source.runId),
    turnId: stringValue(source.turnId),
    ...(Array.isArray(source.agentPath) ? { agentPath: source.agentPath.map(String) } : {}),
    role: stringValue(source.role),
    model: stringValue(source.model),
    mode: stringValue(source.mode),
    activity: stringValue(source.activity),
    ...(source.hasChildren === undefined ? {} : { hasChildren: Boolean(source.hasChildren) }),
    prompt: source.prompt === undefined ? undefined : clone(source.prompt),
    status,
    agentStatus: stringValue(source.agentStatus) || status,
    completedSteps: Number.isSafeInteger(Number(source.completedSteps)) ? Number(source.completedSteps) : 0,
    createdAt: source.createdAt || undefined,
    updatedAt: source.updatedAt || undefined,
    ...(source.result === undefined ? {} : { result: clone(source.result) }),
    ...(source.error === undefined ? {} : { error: String(source.error) }),
  }
}

export class SubagentService {
  constructor(adapter, { notify, maxChildren = 16, maxDepth = 4, maxMutations = 1024 } = {}) {
    this.adapter = adapter
    this.notify = notify
    this.maxChildren = maxChildren
    this.maxDepth = maxDepth
    this.maxMutations = maxMutations
    // DSH owns the durable child lifecycle when its native subagent service is
    // mounted. Keep the generic ThreadPort implementation as a compatibility
    // path for tests and older hosts, but never shadow the native service.
    this.native = nativeSubagentRuntime(adapter)
    this.relations = new Map()
    this.byChild = new Map()
    this.mutations = new Map()
    this.disposers = []
    const unsubscribe = adapter?.subscribe?.(event => this.observe(event))
    if (typeof unsubscribe === 'function') this.disposers.push(unsubscribe)
  }

  nativeAvailable() {
    this.native ||= nativeSubagentRuntime(this.adapter)
    return Boolean(this.native && typeof this.native.startContinuable === 'function' && typeof this.native.listChildren === 'function')
  }

  nativeProvider(request = {}) {
    const requested = stringValue(request.subagentProvider)
      || stringValue(request.providerName)
      || stringValue(request.config?.subagentProvider)
      || stringValue(request.config?.providerName)
    const providers = typeof this.native?.list === 'function' ? this.native.list() : []
    const usable = providers.filter(name => {
      try { return typeof this.native?.getProvider !== 'function' || this.native.getProvider(name)?.prepareContinuable }
      catch { return false }
    })
    if (requested) return requested
    // DSH's bundled in-process providers use these stable names. Prefer a
    // fresh child by default; callers can request fork explicitly.
    const context = stringValue(request.context) || stringValue(request.config?.context)
    const preferred = context === 'fork' || request.inheritsParentContext === true ? ['fork', 'spawn'] : ['spawn', 'fork']
    return preferred.find(name => usable.includes(name)) || usable[0] || requested || 'spawn'
  }

  async resolveParentAgent(parentThreadId) {
    const live = this.adapter.liveAgent?.(parentThreadId)
      || this.adapter.ctx?.agents?.get?.(parentThreadId)
      || this.adapter.ctx?.get?.('agents')?.get?.(parentThreadId)
    if (live) return live
    if (typeof this.adapter.resumeThread === 'function') {
      await this.adapter.resumeThread(parentThreadId)
      const resumed = this.adapter.liveAgent?.(parentThreadId)
        || this.adapter.ctx?.agents?.get?.(parentThreadId)
        || this.adapter.ctx?.get?.('agents')?.get?.(parentThreadId)
      if (resumed) return resumed
    }
    throw new CapabilityUnavailableError('subagent-parent')
  }

  nativeState(parentThreadId, childThreadId, entry = {}) {
    const existing = this.byChild.get(String(childThreadId))
    if (existing) {
      if (entry.activity !== undefined && existing.status === 'pendingInit') {
        existing.status = nativeStatus(entry)
        existing.agentStatus = existing.status
        existing.updatedAt = this.now()
      }
      return existing
    }
    const now = this.now()
    const state = {
      parentThreadId: String(parentThreadId),
      childThreadId: String(childThreadId),
      callId: `call-${String(childThreadId)}`,
      itemId: `item-${String(childThreadId)}`,
      role: stringValue(entry.label),
      mode: stringValue(entry.mode) || 'continuable',
      activity: stringValue(entry.activity) || 'inactive',
      hasChildren: Boolean(entry.hasChildren),
      prompt: undefined,
      status: nativeStatus(entry),
      agentStatus: nativeStatus(entry),
      native: true,
      completedSteps: 0,
      createdAt: undefined,
      updatedAt: now,
    }
    this.relations.set(this.key(parentThreadId, childThreadId), state)
    this.byChild.set(String(childThreadId), state)
    return state
  }

  async nativeList(parentThreadId, signal) {
    const entries = await this.native.listChildren(String(parentThreadId), abortSignal(signal))
    const data = []
    const diagnostics = []
    for (const entry of entries || []) {
      if (entry?.kind === 'diagnostic') {
        diagnostics.push({ kind: 'diagnostic', id: String(entry.id), reason: String(entry.reason || 'unavailable') })
        continue
      }
      if (entry?.kind !== 'child' || !stringValue(entry.id)) continue
      const state = this.nativeState(parentThreadId, entry.id, entry)
      if (entry.label && !state.role) state.role = String(entry.label)
      state.activity = String(entry.activity || state.activity || 'inactive')
      state.mode = String(entry.mode || state.mode || 'continuable')
      state.hasChildren = Boolean(entry.hasChildren)
      // The host listing is authoritative after a reconnect or a missed
      // transient turn notification. A live activation always wins; an
      // inactive child keeps an explicit interrupt marker for the UI.
      if (state.status !== 'closed') {
        if (entry.activity === 'running' || state.status !== 'interrupted') {
          state.status = nativeStatus(entry)
          state.agentStatus = state.status
          state.updatedAt = this.now()
        }
      }
      data.push(this.snapshot(state))
      // Inactive native children are fully reconstructible from DSH's
      // durable listing. Do not retain one App Server state object per child
      // for the lifetime of a long-running host.
      if (entry.activity !== 'running') this.dropNativeState(state)
    }
    return { data: data.filter(Boolean), ...(diagnostics.length ? { diagnostics } : {}) }
  }

  async nativeSpawn(parentThreadId, request = {}, signal) {
    const prompt = inputText(request.prompt)
    const mutationId = stringValue(request.clientMutationId)
    const explicitChild = stringValue(request.childThreadId)
    const childHint = explicitChild || (mutationId ? stableChildId(parentThreadId, mutationId) : undefined)
    const existing = await this.nativeList(parentThreadId, signal)
    if (childHint) {
      const found = existing.data.find(item => item.childThreadId === childHint)
      if (found) return { subagent: found, idempotent: true }
    }
    if (existing.data.filter(item => item.status === 'running' || item.status === 'pendingInit').length >= this.maxChildren) {
      throw new InvalidInputError('parentThreadId', `exceeds max concurrent subagents (${this.maxChildren})`)
    }
    const parent = await this.resolveParentAgent(parentThreadId)
    const provider = this.nativeProvider(request)
    const agentOptions = { ...object(request.agentOptions) }
    if (request.model !== undefined && agentOptions.model === undefined) agentOptions.model = request.model
    if (request.llmProvider !== undefined && agentOptions.provider === undefined) agentOptions.provider = request.llmProvider
    const maxDepth = Number.isSafeInteger(Number(request.maxDepth))
      ? Number(request.maxDepth)
      : this.maxDepth
    const label = stringValue(request.description) || stringValue(request.label) || stringValue(request.role) || 'App Server subagent'
    const started = await this.native.startContinuable({
      provider,
      label,
      ...(childHint ? { childId: childHint } : {}),
      request: {
        prompt: contentBlocks(prompt),
        parent,
        ...(Object.keys(agentOptions).length ? { agentOptions: clone(agentOptions) } : {}),
        ...(Number.isSafeInteger(maxDepth) && maxDepth >= 0 ? { maxDepth } : {}),
        ...(request.toolFilter === undefined ? {} : { toolFilter: clone(request.toolFilter) }),
        ...(request.persona === undefined ? {} : { persona: String(request.persona) }),
      },
      signal: abortSignal(signal),
    })
    const childThreadId = String(started.childId)
    const state = this.nativeState(parentThreadId, childThreadId, { activity: 'running', label })
    state.clientMutationId = mutationId
    state.prompt = clone(prompt)
    state.role = stringValue(request.role) || state.role
    state.model = stringValue(request.model)
    state.status = 'running'
    state.agentStatus = 'running'
    state.updatedAt = this.now()
    this.emit('subagent/spawned', { ...this.snapshot(state), item: this.item(state), native: true })
    this.emit('item/started', { threadId: parentThreadId, item: this.item(state) })
    this.statusEvent(state, 'started')
    return { subagent: this.snapshot(state), ...(started.messageId ? { messageId: String(started.messageId) } : {}), native: true }
  }

  async nativeParentForChild(childThreadId, signal) {
    const state = this.byChild.get(String(childThreadId))
    if (state?.parentThreadId) return state.parentThreadId
    try {
      const thread = await this.adapter.readThread?.(childThreadId, false)
      const parent = stringValue(thread?.parentThreadId)
      if (parent) {
        // Rehydrate the durable mode from ctx.subagents.listChildren when
        // possible. The child header supplies the parent address; the DSH
        // subagent projection supplies whether it is one-shot or continuable.
        let entry
        try {
          entry = (await this.native.listChildren(parent, abortSignal(signal)))
            .find(value => value?.kind === 'child' && String(value.id) === String(childThreadId))
        } catch { /* prompt/interrupt will surface the core error below */ }
        this.nativeState(parent, childThreadId, entry || {})
        return parent
      }
    } catch { /* list/read below will surface the authoritative error */ }
    const threads = await this.adapter.listThreads?.()
    const thread = (threads || []).find(value => String(value?.id) === String(childThreadId))
    const parent = stringValue(thread?.parentThreadId)
    if (!parent) throw new InvalidInputError('childThreadId', 'is not a persisted direct subagent')
    let entry
    try {
      entry = (await this.native.listChildren(parent, abortSignal(signal)))
        .find(value => value?.kind === 'child' && String(value.id) === String(childThreadId))
    } catch { /* prompt/interrupt will surface the core error below */ }
    this.nativeState(parent, childThreadId, entry || {})
    return parent
  }

  async nativeSend(childThreadId, request = {}, signal) {
    const mode = request.mode || 'message'
    if (!CONTROL_MODES.has(mode)) throw new InvalidInputError('mode', `must be one of: ${[...CONTROL_MODES].join(', ')}`)
    const input = inputText(request.input ?? request.message)
    const parentThreadId = await this.nativeParentForChild(childThreadId, signal)
    const state = this.nativeState(parentThreadId, childThreadId)
    ensureNativeContinuable(state)
    // Native continuable children remain durable after an interrupt.  The
    // interrupt parks the current activation; the next explicit prompt is
    // allowed to cold-resume that same child Thread.  One-shot/fallback
    // children retain the stricter terminal-state guard.
    const resumableInterrupted = state.native && state.status === 'interrupted'
    if (TERMINAL.has(state.status) && !resumableInterrupted && mode !== 'followupTask' && mode !== 'sendInput') {
      throw new InvalidInputError('childThreadId', 'is in a terminal state; use followupTask or sendInput to resume')
    }
    // The host protocol owns user-authored delivery, so use prompt() rather
    // than sendMessage(), which is reserved for model-authored Agent messages.
    const receipt = await this.native.prompt({
      requestId: stringValue(request.clientMessageId) || `appserver-${randomUUID()}`,
      parentSessionId: parentThreadId,
      childSessionId: childThreadId,
      mode: 'continuable',
      delivery: mode === 'message' || mode === 'sendMessage' ? 'steer' : 'queue',
      content: contentBlocks(input),
    }, abortSignal(signal))
    state.status = 'running'
    state.agentStatus = 'running'
    state.turnId = stringValue(receipt?.messageId)
    state.updatedAt = this.now()
    this.statusEvent(state, 'started')
    return { sent: true, messageId: String(receipt?.messageId || ''), subagent: this.snapshot(state), native: true }
  }

  async nativeResume(childThreadId, signal) {
    const parentThreadId = await this.nativeParentForChild(childThreadId, signal)
    const entries = await this.nativeList(parentThreadId, signal)
    const entry = entries.data.find(item => item.childThreadId === childThreadId)
    const state = this.nativeState(parentThreadId, childThreadId, entry || {})
    ensureNativeContinuable(state)
    // `resume` is a read/rehydrate operation for the App Server protocol.
    // DSH owns activation and cold-resume; reflect the authoritative catalog
    // activity instead of unconditionally marking the child idle.
    state.activity = entry?.activity || state.activity || 'inactive'
    state.status = entry ? nativeStatus(entry) : state.status
    state.agentStatus = state.status
    state.updatedAt = this.now()
    const thread = await this.adapter.readThread?.(childThreadId, true)
    const subagent = this.snapshot(state)
    if (entry?.activity !== 'running') this.dropNativeState(state)
    return { resumed: true, thread: clone(thread), subagent, native: true }
  }

  async nativeInterrupt(childThreadId, signal) {
    const parentThreadId = await this.nativeParentForChild(childThreadId, signal)
    const state = this.nativeState(parentThreadId, childThreadId)
    ensureNativeContinuable(state)
    const wasRunning = state.activity === 'running' || state.status === 'running'
    let result
    if (typeof this.native.interruptByParent === 'function') {
      result = this.native.interruptByParent(childThreadId, parentThreadId, 'continuable')
    } else if (typeof this.native.interrupt === 'function') {
      result = this.native.interrupt(childThreadId, { kind: 'user', parentSessionId: parentThreadId })
    } else {
      throw new CapabilityUnavailableError('subagent-interrupt')
    }
    // DSH deliberately treats idle/already-completed targets as accepted
    // no-ops. Preserve that authoritative state instead of manufacturing an
    // interrupted terminal state in the App Server projection.
    if (!wasRunning) {
      state.status = nativeStatus(state)
      state.agentStatus = state.status
      state.updatedAt = this.now()
      const subagent = this.snapshot(state)
      this.dropNativeState(state)
      return { ...(result || { accepted: true }), interrupted: false, subagent, native: true }
    }
    state.status = 'interrupted'
    state.agentStatus = 'interrupted'
    state.updatedAt = this.now()
    this.statusEvent(state, 'interrupted')
    const subagent = this.snapshot(state)
    this.dropNativeState(state)
    return { ...(result || { accepted: true, interrupted: true }), subagent, native: true }
  }

  async nativeWait(childThreadId, signal) {
    const parentThreadId = await this.nativeParentForChild(childThreadId, signal)
    const state = this.nativeState(parentThreadId, childThreadId)
    if (TERMINAL.has(state.status) && !(state.status === 'interrupted')) return { completed: true, subagent: this.snapshot(state), native: true }
    // Continuable children intentionally have no host-level "run completion";
    // they remain durable and inactive until the next prompt cold-resumes them.
    const entries = await this.nativeList(parentThreadId, signal)
    const latest = entries.data.find(item => item.childThreadId === childThreadId)
    if (latest) Object.assign(state, latest)
    return { completed: false, subagent: this.snapshot(state), native: true }
  }

  async nativeClose(childThreadId, signal) {
    if (signal?.aborted) throw new RequestCancelledError()
    const parentThreadId = await this.nativeParentForChild(childThreadId, signal)
    const state = this.nativeState(parentThreadId, childThreadId)
    ensureNativeContinuable(state)
    const parent = await this.resolveParentAgent(parentThreadId)
    if (typeof this.native.drainContinuableChildren === 'function') {
      await this.native.drainContinuableChildren(parent, [childThreadId])
    } else if (typeof this.native.drainChildren === 'function') {
      await this.native.drainChildren(parent, [childThreadId])
    } else {
      throw new CapabilityUnavailableError('subagent-close')
    }
    // Closing releases the live activation. The durable child log remains
    // intentionally retained and can only be resumed by an explicit follow-up.
    state.status = 'closed'
    state.agentStatus = 'shutdown'
    state.updatedAt = this.now()
    this.statusEvent(state, 'closed')
    const subagent = this.snapshot(state)
    this.dropNativeState(state)
    return { closed: true, durable: true, subagent, native: true }
  }

  emit(method, params) {
    try { this.notify?.(method, params) } catch { /* notifications must not fail a subagent mutation */ }
  }

  now() { return new Date().toISOString() }

  key(parentThreadId, childThreadId) { return `${String(parentThreadId)}:${String(childThreadId)}` }

  relation(parentThreadId, childThreadId) {
    return this.relations.get(this.key(parentThreadId, childThreadId)) || this.byChild.get(String(childThreadId))
  }

  dropNativeState(state) {
    if (!state?.native) return
    this.relations.delete(this.key(state.parentThreadId, state.childThreadId))
    if (this.byChild.get(String(state.childThreadId)) === state) this.byChild.delete(String(state.childThreadId))
  }

  snapshot(state) {
    const ref = normalizeSubagentRef(state)
    if (!ref) return undefined
    return ref
  }

  item(state) {
    const ref = this.snapshot(state)
    if (!ref) return undefined
    return {
      id: ref.itemId,
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      status: TERMINAL.has(ref.status) ? terminalItemStatus(ref.status) : 'inProgress',
      senderThreadId: ref.parentThreadId,
      receiverThreadIds: [ref.childThreadId],
      ...(ref.prompt === undefined ? {} : { prompt: clone(ref.prompt) }),
      ...(ref.model ? { model: ref.model } : {}),
      ...(ref.role ? { role: ref.role } : {}),
      agentStates: {
        [ref.childThreadId]: {
          status: ref.agentStatus,
          ...(ref.runId ? { runId: ref.runId } : {}),
          ...(ref.turnId ? { turnId: ref.turnId } : {}),
        },
      },
      ...(ref.result === undefined ? {} : { result: clone(ref.result) }),
      ...(ref.error ? { error: ref.error } : {}),
    }
  }

  statusEvent(state, lifecycle = 'status') {
    const ref = this.snapshot(state)
    if (!ref) return
    const payload = {
      ...ref,
      item: this.item(state),
    }
    this.emit('subagent/status', payload)
    if (lifecycle !== 'status') this.emit(`subagent/${lifecycle}`, payload)
    if (TERMINAL.has(ref.status)) this.emit('item/completed', { threadId: ref.parentThreadId, item: this.item(state) })
  }

  observe(event) {
    const method = event?.method
    const params = object(event?.params)
    const childThreadId = stringValue(params.childThreadId) || stringValue(params.threadId)
    if (!childThreadId) return
    const state = this.byChild.get(childThreadId)
    if (!state) return
    if (method === 'turn/started') {
      state.turnId = stringValue(params.turnId) || stringValue(params.turn?.id) || state.turnId
      state.agentStatus = 'running'
      state.status = 'running'
      state.updatedAt = this.now()
      this.statusEvent(state, 'started')
      return
    }
    if (method === 'turn/completed') {
      if (state.native) {
        // A DSH continuable child is a durable conversation, not a one-turn
        // run. Turn settlement returns it to idle; the native service cold-
        // resumes it when the next prompt is delivered.
        state.turnId = stringValue(params.turnId) || stringValue(params.turn?.id) || state.turnId
        state.status = state.status === 'closed' ? 'closed' : 'idle'
        state.agentStatus = state.status === 'closed' ? 'shutdown' : 'idle'
        state.updatedAt = this.now()
        this.statusEvent(state, 'status')
        this.dropNativeState(state)
        return
      }
      void this.completeFromTurn(state, params).catch(error => this.fail(state, error))
      return
    }
    if (method === 'thread/status/changed') {
      const runtimeStatus = statusOf(params.status?.type || params.status)
      if (runtimeStatus === 'shutdown') this.finish(state, 'closed')
      else if (runtimeStatus === 'errored') this.fail(state, new Error('child agent runtime failed'))
      return
    }
    if (method === 'item/started' || method === 'item/completed' || method === 'item/agentMessage/delta') {
      if (method === 'item/completed') state.completedSteps += 1
      state.updatedAt = this.now()
      this.emit('subagent/progress', {
        childThreadId,
        runId: state.runId,
        status: state.status,
        completedSteps: state.completedSteps,
        activity: {
          type: method.slice('item/'.length),
          ...(params.item?.type ? { itemType: params.item.type } : {}),
          ...(params.itemId ? { itemId: params.itemId } : {}),
        },
      })
    }
  }

  async completeFromTurn(state, params) {
    const status = statusOf(params.turn?.status || params.status)
    if (status === 'interrupted') return this.finish(state, 'interrupted')
    if (status === 'errored') return this.fail(state, new Error(params.turn?.error || params.error || 'child agent turn failed'))
    const result = params.turn?.result || await this.resultFromThread(state.childThreadId)
    state.result = result
    return this.finish(state, 'completed')
  }

  async resultFromThread(childThreadId) {
    try {
      const thread = await this.adapter.readThread?.(childThreadId, true)
      const items = (thread?.turns || []).flatMap(turn => turn.items || [])
      const messages = items.filter(item => item?.type === 'agentMessage' || item?.type === 'assistantMessage' || item?.role === 'assistant')
      const last = messages.at(-1)
      const summary = typeof last?.text === 'string' ? last.text.trim().slice(0, 4000) : undefined
      const artifacts = items.flatMap(item => Array.isArray(item?.artifacts) ? item.artifacts : item?.receiptId ? [{ receiptId: item.receiptId }] : [])
      return { ...(summary ? { summary } : {}), ...(artifacts.length ? { artifacts } : {}) }
    } catch { return {} }
  }

  finish(state, status) {
    if (TERMINAL.has(state.status)) return this.snapshot(state)
    state.status = status
    state.agentStatus = status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : status === 'closed' ? 'shutdown' : 'errored'
    state.updatedAt = this.now()
    this.statusEvent(state, status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : status === 'closed' ? 'closed' : 'failed')
    this.emit('subagent/result', { childThreadId: state.childThreadId, runId: state.runId, status, ...(state.result ? { result: clone(state.result) } : {}), ...(state.error ? { error: state.error } : {}) })
    return this.snapshot(state)
  }

  fail(state, error) {
    state.error = error instanceof Error ? error.message : String(error)
    return this.finish(state, 'failed')
  }

  validateParent(value) {
    const parentThreadId = stringValue(value)
    if (!parentThreadId) throw new InvalidInputError('parentThreadId', 'must be a non-empty string')
    return parentThreadId
  }

  validateChild(value) {
    const childThreadId = stringValue(value)
    if (!childThreadId) throw new InvalidInputError('childThreadId', 'must be a non-empty string')
    return childThreadId
  }

  rememberMutation(key, value) {
    this.mutations.set(key, value)
    while (this.mutations.size > this.maxMutations) this.mutations.delete(this.mutations.keys().next().value)
  }

  async spawn(parentThreadId, request = {}, options = {}) {
    const parent = this.validateParent(parentThreadId)
    if (this.nativeAvailable()) return this.nativeSpawn(parent, request, options.signal)
    const prompt = inputText(request.prompt)
    const mutationId = stringValue(request.clientMutationId)
    const mutationKey = mutationId ? `${parent}:${mutationId}` : undefined
    if (mutationKey && this.mutations.has(mutationKey)) return { subagent: this.snapshot(this.mutations.get(mutationKey)), idempotent: true }
    const children = await this.list(parent)
    if (mutationId) {
      const existing = children.data.find(item => item.clientMutationId === mutationId)
      if (existing) {
        this.rememberMutation(mutationKey, existing)
        return { subagent: existing, idempotent: true }
      }
    }
    if (children.data.filter(item => item.status === 'pendingInit' || item.status === 'running').length >= this.maxChildren) throw new InvalidInputError('parentThreadId', `exceeds max concurrent subagents (${this.maxChildren})`)
    const parentRelation = this.byChild.get(parent)
    const parentPath = request.agentPath === undefined
      ? [...(parentRelation?.agentPath || []), ...(parentRelation ? [parent] : [])]
      : pathValue(request.agentPath)
    if (parentPath.length > this.maxDepth) throw new InvalidInputError('agentPath', `exceeds max depth (${this.maxDepth})`)
    const child = stringValue(request.childThreadId) || `subagent-${randomUUID()}`
    if (this.byChild.has(child) || children.data.some(item => item.childThreadId === child)) throw new InvalidInputError('childThreadId', 'already exists')
    const now = this.now()
    const state = {
      parentThreadId: parent,
      childThreadId: child,
      // These are presentation/correlation ids, not Session metadata. Keep
      // them stable from the core-owned child id so a re-list does not invent
      // a different parent item after a process restart.
      callId: stringValue(request.callId) || `call-${child}`,
      itemId: stringValue(request.itemId) || `item-${child}`,
      clientMutationId: mutationId,
      runId: `run-${child}`,
      turnId: undefined,
      agentPath: parentPath,
      role: stringValue(request.role) || stringValue(request.preset) || stringValue(request.config?.agentPreset),
      model: stringValue(request.model),
      prompt: clone(prompt),
      status: 'pendingInit',
      agentStatus: 'pendingInit',
      completedSteps: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.relations.set(this.key(parent, child), state)
    this.byChild.set(child, state)
    if (mutationKey) this.rememberMutation(mutationKey, state)
    try {
      if (typeof this.adapter.startThread !== 'function') throw new CapabilityUnavailableError('subagent-spawn')
      await this.adapter.startThread(child, {
        ...dshLaunchConfig(request.config),
        parentThreadId: parent,
        delegationDepth: parentPath.length + 1,
        model: state.model,
      })
      state.status = 'running'
      state.agentStatus = 'running'
      state.updatedAt = this.now()
      this.emit('subagent/spawned', { ...this.snapshot(state), item: this.item(state) })
      this.emit('item/started', { threadId: parent, item: this.item(state) })
      if (typeof this.adapter.startTurn !== 'function') throw new CapabilityUnavailableError('subagent-turn')
      const turn = await this.adapter.startTurn(child, prompt)
      state.turnId = stringValue(turn?.id) || state.turnId
      state.updatedAt = this.now()
      this.statusEvent(state, 'started')
      return { subagent: this.snapshot(state) }
    } catch (error) {
      this.fail(state, error)
      throw error
    }
  }

  async list(parentThreadId, options = {}) {
    const parent = this.validateParent(parentThreadId)
    if (this.nativeAvailable()) return this.nativeList(parent, options.signal)
    const known = new Map()
    for (const state of this.relations.values()) if (state.parentThreadId === parent) known.set(state.childThreadId, state)
    try {
      const threads = await this.adapter.listThreads?.()
      for (const thread of threads || []) {
        const child = stringValue(thread?.id)
        if (!child || String(thread.parentThreadId || '') !== parent || known.has(child)) continue
        const metadata = object(thread.subagent)
        const state = {
          parentThreadId: parent, childThreadId: child,
          callId: stringValue(metadata.callId) || `call-${child}`,
          itemId: stringValue(metadata.itemId) || `item-${child}`,
          clientMutationId: stringValue(metadata.clientMutationId),
          runId: stringValue(metadata.runId) || `run-${child}`,
          role: stringValue(metadata.role), prompt: metadata.prompt, status: statusOf(thread.status), agentStatus: statusOf(thread.status),
          agentPath: Array.isArray(metadata.agentPath) ? metadata.agentPath : [], completedSteps: 0, createdAt: undefined, updatedAt: undefined,
        }
        known.set(child, state)
      }
    } catch { /* a host may only expose live child handles */ }
    return { data: [...known.values()].map(state => this.snapshot(state)).filter(Boolean) }
  }

  async send(childThreadId, request = {}, options = {}) {
    const child = this.validateChild(childThreadId)
    if (this.nativeAvailable()) return this.nativeSend(child, request, options.signal)
    const state = this.byChild.get(child)
    const mode = request.mode || 'message'
    if (!CONTROL_MODES.has(mode)) throw new InvalidInputError('mode', `must be one of: ${[...CONTROL_MODES].join(', ')}`)
    const input = inputText(request.input ?? request.message)
    if (state && TERMINAL.has(state.status) && mode !== 'followupTask' && mode !== 'sendInput') throw new InvalidInputError('childThreadId', 'is in a terminal state; use followupTask or sendInput to resume')
    let result
    if ((mode === 'message' || mode === 'sendMessage') && typeof this.adapter.steerTurn === 'function') result = await this.adapter.steerTurn(child, input, stringValue(request.clientMessageId))
    else if (typeof this.adapter.startTurn === 'function') result = await this.adapter.startTurn(child, input)
    else throw new CapabilityUnavailableError('subagent-send')
    if (state) {
      state.runId = `run-${randomUUID()}`
      state.turnId = stringValue(result?.id) || state.turnId
      state.status = 'running'
      state.agentStatus = 'running'
      state.updatedAt = this.now()
      this.statusEvent(state, 'started')
    }
    return { sent: true, ...(state ? { subagent: this.snapshot(state) } : {}), ...(result && typeof result === 'object' ? { turn: clone(result) } : {}) }
  }

  async resume(childThreadId, options = {}) {
    const child = this.validateChild(childThreadId)
    if (this.nativeAvailable()) return this.nativeResume(child, options.signal)
    if (typeof this.adapter.resumeThread !== 'function') throw new CapabilityUnavailableError('subagent-resume')
    const thread = await this.adapter.resumeThread(child)
    const state = this.byChild.get(child)
    if (state) {
      state.status = 'idle'
      state.agentStatus = 'idle'
      state.runId = `run-${randomUUID()}`
      state.updatedAt = this.now()
    }
    return { resumed: true, thread: clone(thread), ...(state ? { subagent: this.snapshot(state) } : {}) }
  }

  async interrupt(childThreadId, options = {}) {
    const child = this.validateChild(childThreadId)
    if (this.nativeAvailable()) return this.nativeInterrupt(child, options.signal)
    if (typeof this.adapter.interruptTurn !== 'function') throw new CapabilityUnavailableError('subagent-interrupt')
    let result = await this.adapter.interruptTurn(child)
    if (result?.interrupted === false && typeof this.adapter.resumeThread === 'function') {
      try {
        await this.adapter.resumeThread(child)
        result = await this.adapter.interruptTurn(child)
      } catch { /* preserve the host's original not-running result */ }
    }
    const state = this.byChild.get(child)
    if (state && result?.interrupted !== false) this.finish(state, 'interrupted')
    return { ...(result || { interrupted: true }), ...(state ? { subagent: this.snapshot(state) } : {}) }
  }

  async wait(childThreadId, options = {}) {
    const child = this.validateChild(childThreadId)
    if (this.nativeAvailable()) return this.nativeWait(child, options.signal)
    const state = this.byChild.get(child)
    if (state && TERMINAL.has(state.status)) return { completed: true, subagent: this.snapshot(state) }
    if (typeof this.adapter.waitSubagent === 'function') return this.adapter.waitSubagent(child)
    return { completed: false, ...(state ? { subagent: this.snapshot(state) } : { childThreadId }) }
  }

  async close(childThreadId, options = {}) {
    const child = this.validateChild(childThreadId)
    if (this.nativeAvailable()) return this.nativeClose(child, options.signal)
    if (typeof this.adapter.closeThread !== 'function') throw new CapabilityUnavailableError('subagent-close')
    const result = await this.adapter.closeThread(child)
    const state = this.byChild.get(child)
    if (state && result?.closed !== false) this.finish(state, 'closed')
    return { ...(result || { closed: true }), ...(state ? { subagent: this.snapshot(state) } : {}) }
  }

  dispose() { for (const dispose of this.disposers) dispose?.(); this.disposers = []; this.relations.clear(); this.byChild.clear(); this.mutations.clear() }
}
