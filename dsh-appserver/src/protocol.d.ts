export * from './index.js'
export declare const METHOD_SCHEMAS: Readonly<Record<string, Record<string, unknown>>>
export declare const ErrorCode: Readonly<Record<string, number>>
export declare class RevisionConflictError extends Error {}
export declare const APP_SERVER_PROTOCOL_VERSION: 1
export declare const APP_SERVER_API_VERSION: 'v2'
export declare const PROTOCOL_FEATURES: Readonly<Record<string, boolean>>
export declare const PROTOCOL_LIMITS: Readonly<Record<string, number>>
export declare function nextRevision(current?: number): number
export declare function optionalRevision(value: number | undefined, field?: string): number | undefined
export declare function protocolDescriptor(capabilities?: Json): Json
export declare function normalizeSkill(skill: Json, cwd: string): Json
export declare class SkillCatalogService {
  constructor(ctx: unknown, options?: { resolveAgent?: (threadId: string) => Promise<unknown>; maxCacheEntries?: number })
  invalidate(): number
  list(params?: { cwds?: string[]; forceReload?: boolean; threadId?: string }): Promise<Json>
  listForThread(threadId: string): Promise<Json>
}
export declare function isTerminalItemStatus(status: string): boolean
export declare function itemKey(threadId: string, turnId: string | undefined, itemId: string): string
export declare function mergeItem(existing: Json | undefined, incoming: Json | undefined): Json | undefined
export declare function normalizeItem(item: Json, context?: Json): Json | undefined
export declare class ItemLifecycle {
  constructor(threadId: string, options?: { maxItems?: number; maxEvents?: number })
  begin(item: Json, context?: Json): Json
  complete(item: Json, context?: Json): Json
  delta(itemId: string, context?: Json): Json
  snapshot(): Json[]
}
export declare function normalizeConfigChange(payload: Json): Json
export declare function normalizeConfigDescriptor(descriptor: Json, namespace: string): Json
export declare class ConfigService {
  constructor(ctx: unknown)
  read(namespace?: string): Json
  writeValue(params?: Json): Promise<Json>
  batchWrite(params?: Json): Promise<Json>
  requirements(namespace?: string): Json
}
export declare function normalizeMcpStatus(server: Json, detail?: string): Json
export declare function normalizeMcpStartupStatus(payload: Json): Json
export declare class McpService {
  constructor(ctx: unknown)
  subscribe(listener: (event: Json) => void): (() => void) | undefined
  list(params?: Json): Promise<Json>
  refresh(): Promise<Json>
  reloadConfig(): Promise<Json>
  oauthLogin(params?: Json): Promise<Json>
  callTool(params?: Json): Promise<Json>
  readResource(params?: Json): Promise<Json>
}
export declare function normalizeSubagentRef(value: Json): Json | undefined
export declare class SubagentService {
  constructor(adapter: unknown, options?: { notify?: (method: string, params: Json) => void; maxChildren?: number; maxDepth?: number; maxMutations?: number })
  spawn(parentThreadId: string, request?: Json, options?: { signal?: AbortSignal }): Promise<Json>
  list(parentThreadId: string, options?: { signal?: AbortSignal }): Promise<Json>
  send(childThreadId: string, request?: Json, options?: { signal?: AbortSignal }): Promise<Json>
  resume(childThreadId: string, options?: { signal?: AbortSignal }): Promise<Json>
  interrupt(childThreadId: string, options?: { signal?: AbortSignal }): Promise<Json>
  wait(childThreadId: string, options?: { signal?: AbortSignal }): Promise<Json>
  close(childThreadId: string, options?: { signal?: AbortSignal }): Promise<Json>
  dispose(): void
}
