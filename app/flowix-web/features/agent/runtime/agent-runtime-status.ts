import type { AgentRuntimeAvailability } from '@platform/tauri/client';
import type { AgentTypeKey } from '@/types/agent';

/**
 * Small, UI-facing state model for one local Agent runtime.
 *
 * `AgentRuntimeAvailability` is the IPC shape and intentionally stays close
 * to the backend. Consumers should eventually depend on this normalized state
 * instead of reconstructing meaning from `available`, `installed`, and
 * free-form `reason` independently.
 */
export type AgentRuntimeState =
  | 'unknown'
  | 'checking'
  | 'not-installed'
  | 'not-ready'
  | 'ready';

export interface AgentRuntimeStatusView {
  state: AgentRuntimeState;
  reason: string | null;
}

export type AgentRuntimeStatusViewByType = Partial<Record<AgentTypeKey, AgentRuntimeStatusView>>;

export function isAgentRuntimeInstalledState(status: AgentRuntimeStatusView): boolean {
  return status.state === 'ready' || status.state === 'not-ready';
}

/**
 * Convert the backend availability shape into the shared UI vocabulary.
 *
 * The optional `installed` field keeps this compatible with older IPC payloads:
 * before the field exists, `available` is the best available installation hint.
 */
export function normalizeAgentRuntimeStatus(
  status: AgentRuntimeAvailability | undefined,
  isChecking = false,
): AgentRuntimeStatusView {
  if (!status) {
    return {
      state: isChecking ? 'checking' : 'unknown',
      reason: null,
    };
  }

  const installed = status.installed ?? status.available;
  return {
    state: !installed
      ? 'not-installed'
      : status.available
        ? 'ready'
        : 'not-ready',
    reason: status.reason ?? null,
  };
}

export function normalizeAgentRuntimeStatusByType(
  statusByType: Partial<Record<AgentTypeKey, AgentRuntimeAvailability>>,
  isChecking = false,
): AgentRuntimeStatusViewByType {
  return Object.fromEntries(
    (Object.keys(statusByType) as AgentTypeKey[]).map((typeKey) => [
      typeKey,
      normalizeAgentRuntimeStatus(statusByType[typeKey], isChecking),
    ]),
  ) as AgentRuntimeStatusViewByType;
}
