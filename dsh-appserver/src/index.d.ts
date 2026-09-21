export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type RpcId = string | number
export interface RpcRequest { jsonrpc: '2.0'; id: RpcId; method: string; params?: Json }
export interface RpcResponse { jsonrpc: '2.0'; id: RpcId; result?: Json; error?: { code: number; message: string; data?: Json } }
export { RevisionConflictError } from './protocol.js'
export { APP_SERVER_API_VERSION, APP_SERVER_PROTOCOL_VERSION, PROTOCOL_FEATURES, PROTOCOL_LIMITS, nextRevision, optionalRevision, protocolDescriptor } from './protocol.js'
export interface DshAppServerOptions {
  maxQueuedRequests?: number
  connectionTtlMs?: number
  history?: Record<string, unknown>
  projection?: Record<string, unknown>
  workers?: Record<string, unknown>
  exports?: Record<string, unknown>
  adapter?: unknown
  observer?: (event: Record<string, unknown>) => void
}
export declare class DshAppServer {
  constructor(ctx: unknown, options?: DshAppServerOptions)
  dispatch(request: RpcRequest, connectionId?: string, options?: { signal?: AbortSignal }): Promise<RpcResponse>
  dispose(): Promise<void>
}
export { DshAppServer as AppServer, DshAppServer as NativeJsonRpcServer }
export interface HttpTransportOptions {
  host?: string
  port?: number
  maxBodyBytes?: number
  authToken?: string
  mobileAuth?: { pairingSecret?: string; persistencePath?: string; tokenTtlMs?: number; refreshTtlMs?: number; maxDevices?: number }
  allowedOrigins?: string[]
  heartbeatMs?: number
  maxSseConnections?: number
  maxReplayEvents?: number
  secureClientIdentity?: boolean
  pairingMaxAttempts?: number
  pairingWindowMs?: number
  pairingBlockMs?: number
  requestTimeoutMs?: number
  headersTimeoutMs?: number
  keepAliveTimeoutMs?: number
  clientIdentityTtlMs?: number
}
export declare function createHttpTransport(server: DshAppServer, options?: HttpTransportOptions): {
  listen(): Promise<unknown>
  close(): Promise<void>
}
export declare const name: 'dsh-appserver'
export declare const inject: readonly string[]
export default function dshAppServer(ctx: unknown, config?: Record<string, unknown>): (() => Promise<void>) | void
