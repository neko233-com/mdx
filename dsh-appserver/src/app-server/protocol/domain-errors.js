export class DomainError extends Error {
  constructor(kind, message, { code = -32010, data, cause } = {}) {
    super(message, { cause })
    this.name = this.constructor.name
    this.kind = kind
    this.code = code
    this.data = data
  }
}

export class CapabilityUnavailableError extends DomainError {
  constructor(capability) {
    super('capability_unavailable', `Capability is unavailable: ${capability}`, {
      code: -32011,
      data: { capability },
    })
  }
}

export class RequestCancelledError extends DomainError {
  constructor() { super('request_cancelled', 'Request was cancelled', { code: -32012 }) }
}

export class InvalidInputError extends DomainError {
  constructor(field, reason) {
    super('invalid_input', `${field} ${reason}`, { code: -32602, data: { field, reason } })
  }
}

export class RevisionConflictError extends DomainError {
  constructor(resource, expected, actual) {
    super('revision_conflict', `${resource} revision is stale`, {
      code: -32013,
      data: { resource, expected, actual },
    })
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(sessionId, options = {}) {
    super('session_not_found', `Session not found: ${sessionId}`, { code: -32020, data: { sessionId }, ...options })
  }
}

export class HistoryTooLargeError extends DomainError {
  constructor(message, data = {}) {
    super('history_too_large', message, { code: -32030, data: { alternatives: ['thread/events/list', 'session/export'], ...data } })
  }
}

export class ResultTooLargeError extends DomainError {
  constructor(resultBytes, maxResultBytes, data = {}) {
    super('result_too_large', 'Projected history exceeds the response size limit', { code: -32031, data: { resultBytes, maxResultBytes, ...data } })
  }
}

export function rpcErrorData(error) {
  if (!(error instanceof DomainError)) return undefined
  return { kind: error.kind, ...(error.data && typeof error.data === 'object' ? error.data : {}) }
}
