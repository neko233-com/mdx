import { CapabilityUnavailableError, InvalidInputError, RevisionConflictError } from '../protocol/domain-errors.js'

const STATUS_BY_OPERATION = Object.freeze({
  create: 'active', set: 'active', start: 'active', resume: 'active', activate: 'active', edit: 'active',
  pause: 'paused', paused: 'paused',
  complete: 'completed', completed: 'completed',
  block: 'blocked', blocked: 'blocked',
  'budget-limited': 'budgetLimited', budget_limited: 'budgetLimited', budgetLimited: 'budgetLimited',
})

const STATUS_VALUES = new Set(['active', 'paused', 'completed', 'blocked', 'budgetLimited'])

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }

function normalizedStatus(value, fallback) {
  const candidate = String(value || '').trim()
  if (STATUS_VALUES.has(candidate)) return candidate
  const lower = candidate.toLowerCase()
  if (lower === 'running' || lower === 'in_progress' || lower === 'in-progress') return 'active'
  if (lower === 'done' || lower === 'complete') return 'completed'
  if (lower === 'budget_limited' || lower === 'budget-limited') return 'budgetLimited'
  return fallback
}

// Prefer DSH's registered goal projection when the host exposes it. The
// event fold below remains a compatibility path for older hosts without the
// projection registry; it is never a second source of state.
function projectCoreGoal(threadId, projection) {
  if (projection === null || projection === undefined) return null
  const source = object(projection)
  const goal = object(source.goal)
  const id = text(goal.id)
  if (!id) return null
  const revision = finite(goal.revision) ?? finite(goal.version) ?? 0
  const phase = normalizedStatus(goal.phase || goal.status, 'active')
  return {
    threadId,
    id,
    version: Math.max(0, revision),
    revision: Math.max(0, revision),
    objective: text(goal.objective) || '',
    status: phase,
    ...(goal.blockedReason === undefined ? {} : { blockedReason: goal.blockedReason }),
    ...(finite(goal.maxGoalRounds) === undefined ? {} : { maxGoalRounds: finite(goal.maxGoalRounds) }),
    ...(finite(source.roundsStarted) === undefined ? {} : { roundsStarted: finite(source.roundsStarted) }),
    ...(finite(source.createdAt) === undefined ? {} : { createdAt: finite(source.createdAt) }),
    ...(finite(source.updatedAt) === undefined ? {} : { updatedAt: finite(source.updatedAt) }),
  }
}

/** Fold a durable DSH goal/change event into the public ThreadGoal snapshot. */
export function applyGoalChange(previous, change, threadId, event = {}) {
  const payload = object(change)
  const operation = String(payload.operation || '').trim()
  const lowerOperation = operation.toLowerCase()
  if (lowerOperation === 'clear' || lowerOperation === 'cleared') return null

  const raw = object(payload.goal)
  const current = object(previous)
  const id = text(raw.id) || text(payload.goalId) || text(current.id) || `${threadId}:goal`
  const version = finite(raw.revision) ?? finite(raw.version) ?? finite(payload.version) ?? finite(current.version) ?? (previous ? Number(current.version || 0) + 1 : 1)
  const status = normalizedStatus(raw.status || raw.phase || payload.status, STATUS_BY_OPERATION[lowerOperation] || current.status || 'active')
  const objective = text(raw.objective) || text(raw.text) || text(payload.objective) || current.objective || ''
  const tokenBudget = finite(raw.tokenBudget) ?? finite(raw.maxTokens) ?? finite(payload.tokenBudget) ?? current.tokenBudget
  const tokensUsed = finite(raw.tokensUsed) ?? finite(payload.tokensUsed) ?? current.tokensUsed ?? 0
  const timeUsedSeconds = finite(raw.timeUsedSeconds) ?? finite(payload.timeUsedSeconds) ?? current.timeUsedSeconds ?? 0
  const createdAt = raw.createdAt ?? payload.createdAt ?? current.createdAt
  const updatedAt = raw.updatedAt ?? payload.updatedAt ?? event.time ?? event.timestamp ?? current.updatedAt

  return {
    threadId,
    id,
    version: Math.max(0, version),
    revision: Math.max(0, version),
    objective,
    status,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    tokensUsed,
    timeUsedSeconds,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(finite(raw.maxGoalRounds) === undefined ? {} : { maxGoalRounds: finite(raw.maxGoalRounds) }),
    ...(finite(raw.roundsStarted) === undefined ? {} : { roundsStarted: finite(raw.roundsStarted) }),
  }
}

export function projectGoal(threadId, events = []) {
  let goal = null
  for (const event of events || []) {
    if (event?.type === 'goal/change') goal = applyGoalChange(goal, event.data, threadId, event)
  }
  return goal
}

function commandForStatus(status) {
  if (status === 'active') return '/goal resume'
  if (status === 'paused') return '/goal pause'
  if (status === 'completed') return '/goal complete'
  if (status === 'blocked') return '/goal block'
  throw new CapabilityUnavailableError('goal-token-budget')
}

export class GoalService {
  constructor(adapter) { this.adapter = adapter }

  async coreProjection(threadId) {
    const ctx = this.adapter?.ctx
    const query = ctx?.get?.('sessionQuery') || ctx?.sessionQuery
    if (typeof query?.observeSession !== 'function') return { available: false }
    let observation
    try {
      observation = await query.observeSession(threadId, { projectionMode: 'all' })
      const values = observation?.projections?.values
      if (!values || !Object.prototype.hasOwnProperty.call(values, 'goal')) return { available: false }
      return { available: true, goal: projectCoreGoal(threadId, values.goal) }
    } finally {
      observation?.[Symbol.dispose]?.()
    }
  }

  async events(threadId) {
    if (typeof this.adapter.readGoalEvents === 'function') return this.adapter.readGoalEvents(threadId)
    if (typeof this.adapter.eventSnapshot === 'function') return (await this.adapter.eventSnapshot(threadId)).events || []
    if (typeof this.adapter.listEvents !== 'function') throw new CapabilityUnavailableError('goals')

    // Read through the bounded paging API. This is a compatibility fallback;
    // native adapters can provide readGoalEvents backed by a goal index later.
    const events = []
    let afterSeq = -1
    const seen = new Set()
    for (let pageNo = 0; pageNo < 10000; pageNo += 1) {
      const page = await this.adapter.listEvents(threadId, afterSeq, 1000)
      const data = Array.isArray(page?.data) ? page.data : []
      for (const event of data) {
        const key = `${event?.seq}:${event?.type}`
        if (!seen.has(key)) { seen.add(key); events.push(event) }
      }
      if (!page?.nextCursor || data.length === 0) break
      const next = Number(page.nextCursor)
      if (!Number.isSafeInteger(next) || next <= afterSeq) break
      afterSeq = next
    }
    return events
  }

  async read(threadId) {
    const projected = await this.coreProjection(threadId)
    if (projected.available) return projected.goal
    return projectGoal(threadId, await this.events(threadId))
  }

  async get(threadId) { return { goal: await this.read(threadId) } }

  async assertVersion(threadId, current, params) {
    if (params.expectedGoalId !== undefined && params.expectedGoalId !== current?.id) {
      throw new RevisionConflictError('goal', params.expectedGoalId, current?.id)
    }
    if (params.expectedVersion !== undefined) {
      if (!Number.isSafeInteger(params.expectedVersion) || params.expectedVersion < 0) throw new InvalidInputError('expectedVersion', 'must be a non-negative safe integer')
      const actual = current?.version ?? 0
      if (params.expectedVersion !== actual) throw new RevisionConflictError('goal', params.expectedVersion, actual)
    }
  }

  async execute(threadId, command) {
    if (typeof this.adapter.executeCommand !== 'function') throw new CapabilityUnavailableError('goals')
    const result = await this.adapter.executeCommand(threadId, command, [])
    if (result?.execution?.result?.kind === 'error' || result?.result?.kind === 'error') {
      throw new InvalidInputError('goal', result.execution?.result?.text || result.result?.text || 'command failed')
    }
    return result
  }

  async set(threadId, params = {}) {
    const current = await this.read(threadId)
    await this.assertVersion(threadId, current, params)
    const objective = params.objective === undefined ? undefined : text(params.objective)
    if (params.objective !== undefined && !objective) throw new InvalidInputError('objective', 'must be a non-empty string')
    const status = params.status === undefined ? undefined : normalizedStatus(params.status)
    if (params.status !== undefined && !status) throw new InvalidInputError('status', 'is invalid')
    if (params.tokenBudget !== undefined) {
      throw new CapabilityUnavailableError('goal-token-budget')
    }
    if (objective === undefined && status === undefined && params.tokenBudget === undefined) {
      throw new InvalidInputError('goal', 'must include objective, status or tokenBudget')
    }

    if (objective !== undefined) await this.execute(threadId, `/goal set ${objective}`)
    if (status !== undefined && !(status === 'active' && objective !== undefined)) await this.execute(threadId, commandForStatus(status))
    return { goal: await this.read(threadId) }
  }

  async clear(threadId, params = {}) {
    const current = await this.read(threadId)
    await this.assertVersion(threadId, current, params)
    await this.execute(threadId, '/goal clear')
    const goal = await this.read(threadId)
    return { cleared: goal === null, goal }
  }
}
