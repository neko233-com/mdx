'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentConversationInstance } from '@features/agent/store/agent-conversation-types';
import { useAgentSessionStore } from '@features/agent/store/agent-session-store';
import {
  getConversationRunSummary,
  type ConversationRunSummary,
} from '@features/agent/store/conversation-run-index';
import { useWorkspaceRestoreStore } from '@features/workspace/store/workspace-restore-store';
import { selectAndOpenAgentConversation } from '@features/workspace/use-cases/agent-conversation-navigation';
import { getAgentType } from '@/lib/agent-types';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Tooltip } from '@shared/ui/tooltip';
import { AgentIcon } from '@features/agent/components/agent-icon';

interface AgentConversationStatusEntry {
  instance: AgentConversationInstance;
  run: ConversationRunSummary;
}

function conversationStatusEntries(
  instances: Record<string, AgentConversationInstance>,
  runSignatures: Record<string, string>,
  unreadInstanceIds: ReadonlySet<string>,
): AgentConversationStatusEntry[] {
  return Object.values(instances)
    .map((instance) => ({
      instance,
      run: getConversationRunSummary(runSignatures, instance.threadId),
    }))
    .filter(({ instance, run }) => (
      run.status === 'running' || unreadInstanceIds.has(instance.instanceId)
    ))
    .sort((a, b) => {
      // Keep active runs in their start order, followed by unread completed
      // conversations in their conversation update order.
      const aTime = a.run.status === 'running' ? a.run.startedAt : a.instance.updatedAt;
      const bTime = b.run.status === 'running' ? b.run.startedAt : b.instance.updatedAt;
      return aTime - bTime;
    });
}

/**
 * Compact status-bar entry for every running conversation and every
 * conversation that finished while it was not open. The component owns the
 * short-lived unread set because it is a view-state signal, not transcript
 * data; opening a conversation clears it immediately.
 */
export function AgentConversationStatusBar() {
  const { t } = useI18n();
  const instances = useAgentSessionStore((state) => state.conversationRegistry.instances);
  const runSignatures = useAgentSessionStore((state) => state.threadRunSignatures);
  const selectedInstanceId = useWorkspaceRestoreStore(
    (state) => state.agentConversation.selectedInstanceId,
  );
  const detailOpen = useWorkspaceRestoreStore((state) => state.agentConversation.detailOpen);
  const [unreadInstanceIds, setUnreadInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const previousStatusRef = useRef<ReadonlyMap<string, ConversationRunSummary['status']>>(
    new Map(),
  );

  const lifecycleEntries = useMemo(() => (
    Object.values(instances).map((instance) => ({
      instance,
      run: getConversationRunSummary(runSignatures, instance.threadId),
    }))
  ), [instances, runSignatures]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    const current = new Map(
      lifecycleEntries.map(({ instance, run }) => [instance.instanceId, run.status] as const),
    );
    const selectedIsOpen = (instanceId: string) =>
      detailOpen && selectedInstanceId === instanceId;

    setUnreadInstanceIds((existing) => {
      const next = new Set(existing);
      let changed = false;

      for (const { instance, run } of lifecycleEntries) {
        const wasRunning = previous.get(instance.instanceId) === 'running';
        const ended = wasRunning && run.status !== 'running' && run.status !== null;
        if (ended) {
          if (selectedIsOpen(instance.instanceId)) {
            changed = next.delete(instance.instanceId) || changed;
          } else if (!next.has(instance.instanceId)) {
            next.add(instance.instanceId);
            changed = true;
          }
        } else if (run.status === 'running' || selectedIsOpen(instance.instanceId)) {
          changed = next.delete(instance.instanceId) || changed;
        }
      }

      for (const instanceId of next) {
        if (!current.has(instanceId)) {
          next.delete(instanceId);
          changed = true;
        }
      }

      return changed ? next : existing;
    });
    previousStatusRef.current = current;
  }, [detailOpen, lifecycleEntries, selectedInstanceId]);

  const openConversation = useCallback((instance: AgentConversationInstance) => {
    setUnreadInstanceIds((existing) => {
      if (!existing.has(instance.instanceId)) return existing;
      const next = new Set(existing);
      next.delete(instance.instanceId);
      return next;
    });
    void selectAndOpenAgentConversation(instance.instanceId).catch((error) => {
      toast.error(error instanceof Error ? error.message : t('status.agent.conversationNotFound'));
    });
  }, [t]);

  const entries = useMemo(
    () => conversationStatusEntries(instances, runSignatures, unreadInstanceIds),
    [instances, runSignatures, unreadInstanceIds],
  );

  if (entries.length === 0) return null;

  return (
    <div className="flex h-full shrink-0 items-center gap-0.5" aria-label={t('status.agent.running')}>
      {entries.map(({ instance, run }) => {
        const agent = getAgentType(instance.agentType);
        const title = instance.title?.trim() || t('common.untitled');
        const isRunning = run.status === 'running';
        const isUnread = unreadInstanceIds.has(instance.instanceId);
        return (
          <Tooltip key={instance.instanceId} content={title} side="top">
            <button
              type="button"
              onClick={() => openConversation(instance)}
              className="relative inline-flex h-full w-6 items-center justify-center px-1 hover:bg-[var(--muted)]"
              aria-label={title}
            >
              <AgentIcon
                typeKey={agent.key}
                alt=""
                className="h-3.5 w-3.5 object-contain"
              />
              {(isRunning || isUnread) && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 right-0.5 h-1.5 w-1.5 rounded-full ${
                    isRunning ? 'bg-[var(--success)]' : 'bg-[var(--muted-foreground)]'
                  }`}
                />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { conversationStatusEntries };
