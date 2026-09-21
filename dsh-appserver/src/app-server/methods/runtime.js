import { APP_SERVER_API_VERSION, APP_SERVER_PROTOCOL_VERSION, protocolDescriptor } from '../protocol/foundation.js'

export function runtimeMethods(adapter) {
  const capabilities = () => adapter.capabilitiesReport?.() ?? protocolDescriptor(adapter.protocolCapabilities?.() || {})
  const status = () => ({
    ...protocolDescriptor(adapter.protocolCapabilities?.() || {}),
    ...(adapter.statusReport?.() || { initialized: true }),
    protocolVersion: APP_SERVER_PROTOCOL_VERSION,
    apiVersion: APP_SERVER_API_VERSION,
  })
  return {
    'runtime/capabilities': capabilities,
    'runtime/status': status,
  }
}
