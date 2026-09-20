import { describe, expect, it } from 'vitest';

import { conversationStatusEntries } from './agent-conversation-status-bar';
import type { AgentConversationInstance } from '@features/agent/store/agent-conversation-types';

function instance(
  instanceId: string,
  threadId: string,
  updatedAt: number,
): AgentConversationInstance {
  return {
    instanceId,
    agentType: 'codex',
    title: instanceId,
    threadId,
    source: { kind: 'dedicated' },
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('agent conversation status bar entries', () => {
  it('shows running conversations and explicitly unread completed conversations only', () => {
    const active = instance('active', 'thread-active', 10);
    const unread = instance('unread', 'thread-unread', 20);
    const idle = instance('idle', 'thread-idle', 30);

    const entries = conversationStatusEntries(
      { active, unread, idle },
      {
        'thread-active': 'running\u001frun-active\u001f10\u001f-\u001f-\u001f-\u001f0',
        'thread-unread': 'completed\u001frun-unread\u001f20\u001f-\u001f-\u001f-\u001f0',
        'thread-idle': '-',
      },
      new Set(['unread']),
    );

    expect(entries.map(({ instance: item }) => item.instanceId)).toEqual(['active', 'unread']);
    expect(entries[0]?.run.status).toBe('running');
    expect(entries[1]?.run.status).toBe('completed');
  });
});
