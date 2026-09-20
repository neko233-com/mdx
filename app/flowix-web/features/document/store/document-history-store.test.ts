import { beforeEach, describe, expect, it } from 'vitest';

import { useDocumentHistoryStore } from '@features/document/store/document-history-store';

describe('document history store', () => {
  beforeEach(() => {
    useDocumentHistoryStore.getState().clear();
  });

  it('keeps agent conversations as navigable history entries', () => {
    const conversation = {
      kind: 'agent-conversation' as const,
      instanceId: 'conversation-1',
      openedAt: 1,
    };
    const memo = {
      kind: 'memo' as const,
      memoId: 'memo-1',
      notebookId: 'notebook-1',
      notebookPath: '/notes',
      path: '/notes/memo-1.md',
      openedAt: 2,
    };

    useDocumentHistoryStore.getState().pushBack(memo);
    useDocumentHistoryStore.getState().commitBackNavigation(conversation);

    expect(useDocumentHistoryStore.getState().peekBack()).toBeNull();
    expect(useDocumentHistoryStore.getState().peekForward()).toEqual(conversation);
  });

  it('does not duplicate the same conversation at the top of a stack', () => {
    const conversation = {
      kind: 'agent-conversation' as const,
      instanceId: 'conversation-1',
      openedAt: 1,
    };

    useDocumentHistoryStore.getState().pushBack(conversation);
    useDocumentHistoryStore.getState().pushBack({ ...conversation, openedAt: 2 });

    expect(useDocumentHistoryStore.getState().backStack).toHaveLength(1);
  });

  it('keeps artifact targets distinct from their pointer memos', () => {
    const artifact = {
      kind: 'artifact' as const,
      pointerMemoId: 'pointer-1',
      notebookId: 'notebook-1',
      notebookPath: '/notes',
      pluginId: 'mindmap',
      renderer: 'markmap' as const,
      openedAt: 1,
    };

    useDocumentHistoryStore.getState().pushBack(artifact);
    useDocumentHistoryStore.getState().pushBack({
      ...artifact,
      pointerMemoId: 'pointer-2',
      openedAt: 2,
    });

    expect(useDocumentHistoryStore.getState().backStack).toEqual([artifact, {
      ...artifact,
      pointerMemoId: 'pointer-2',
      openedAt: 2,
    }]);
  });

  it('keeps image and video resources as distinct history entries', () => {
    const image = {
      kind: 'media' as const,
      filePath: '/notes/image.png',
      notebookId: 'notebook-1',
      notebookPath: '/notes',
      resourceKind: 'image' as const,
      openedAt: 1,
    };
    const video = {
      ...image,
      filePath: '/notes/video.mp4',
      resourceKind: 'video' as const,
      openedAt: 2,
    };

    useDocumentHistoryStore.getState().pushBack(image);
    useDocumentHistoryStore.getState().pushBack({ ...image, openedAt: 3 });
    useDocumentHistoryStore.getState().pushBack(video);

    expect(useDocumentHistoryStore.getState().backStack).toEqual([image, video]);
  });
});
