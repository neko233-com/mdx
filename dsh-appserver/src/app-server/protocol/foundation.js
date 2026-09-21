/**
 * Stable protocol contract shared by transports, the RPC server and runtime
 * inspection.  `protocolVersion` remains the wire negotiation version used by
 * existing DSH clients; `apiVersion` identifies the Codex-shaped resource
 * surface that is being evolved independently.
 */
export const APP_SERVER_PROTOCOL_VERSION = 1
export const APP_SERVER_API_VERSION = 'v2'

export const PROTOCOL_FEATURES = Object.freeze({
  capabilityNegotiation: true,
  connectionScopedInitialization: true,
  notificationReplay: true,
  revisionedMutations: true,
})

export const PROTOCOL_LIMITS = Object.freeze({
  maxThreadList: 200,
  maxTurnList: 200,
  maxEventList: 1000,
})

export function protocolDescriptor(capabilities = {}) {
  return {
    protocolVersion: APP_SERVER_PROTOCOL_VERSION,
    apiVersion: APP_SERVER_API_VERSION,
    features: PROTOCOL_FEATURES,
    limits: PROTOCOL_LIMITS,
    capabilities,
  }
}

/** Normalize revisions at the protocol boundary; undefined means "not supplied". */
export function optionalRevision(value, field = 'revision') {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new TypeError(`${field} must be a non-negative safe integer`)
    error.field = field
    throw error
  }
  return value
}

export function nextRevision(current = 0) {
  const revision = optionalRevision(current, 'revision') ?? 0
  return revision + 1
}
