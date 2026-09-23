import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flushDocumentPath: vi.fn(),
  stageDocumentSnapshot: vi.fn(),
  pushBack: vi.fn(),
}));

vi.mock('@features/document/store/document-session-service', () => ({
  flushDocumentPath: mocks.flushDocumentPath,
  stageDocumentSnapshot: mocks.stageDocumentSnapshot,
}));
vi.mock('@features/document/store/document-history-store', () => ({
  useDocumentHistoryStore: { getState: () => ({ pushBack: mocks.pushBack }) },
}));
vi.mock('@/lib/document-open-perf', () => ({
  startDocumentOpenTrace: vi.fn(),
  markDocumentOpenTrace: vi.fn(),
}));

import { useDocumentStore } from './document-store';

describe('document navigation responsiveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.flushDocumentPath.mockResolvedValue(true);
    useDocumentStore.setState({
      currentDocumentPath: null,
      currentDocumentSource: null,
      activeAgentConversationId: null,
      activeMemoSession: null,
      activeExternalSession: null,
      isDocumentTransitioning: false,
      documentTransitionId: 0,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('skips an unopened note when another note is selected in the same turn', async () => {
    const first = useDocumentStore.getState().openMemoDocument({
      memoId: 'first', path: '/notes/first.md', initialContent: '# First',
    });
    const last = useDocumentStore.getState().openMemoDocument({
      memoId: 'last', path: '/notes/last.md', initialContent: '# Last',
    });

    await Promise.all([first, last]);

    expect(useDocumentStore.getState().activeMemoSession?.memoId).toBe('last');
    expect(mocks.stageDocumentSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.stageDocumentSnapshot).toHaveBeenCalledWith(
      { kind: 'memo', id: 'last' }, '/notes/last.md', '# Last',
    );
  });

  it('does not commit a stale note after flushing the outgoing document', async () => {
    useDocumentStore.setState({
      currentDocumentPath: '/notes/old.md',
      currentDocumentSource: 'memo',
      activeMemoSession: {
        id: 'memo:old', memoId: 'old', path: '/notes/old.md',
        notebookId: null, notebookPath: null, openedAt: 1, transitionId: 0,
      },
    });

    let completeFlush!: (saved: boolean) => void;
    mocks.flushDocumentPath.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      completeFlush = resolve;
    }));
    const first = useDocumentStore.getState().openMemoDocument({
      memoId: 'first', path: '/notes/first.md', initialContent: '# First',
    });
    await vi.waitFor(() => expect(mocks.flushDocumentPath).toHaveBeenCalledTimes(1));
    const last = useDocumentStore.getState().openMemoDocument({
      memoId: 'last', path: '/notes/last.md', initialContent: '# Last',
    });
    completeFlush(true);

    await Promise.all([first, last]);

    expect(useDocumentStore.getState().activeMemoSession?.memoId).toBe('last');
    expect(mocks.stageDocumentSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.stageDocumentSnapshot).toHaveBeenCalledWith(
      { kind: 'memo', id: 'last' }, '/notes/last.md', '# Last',
    );
    expect(mocks.pushBack).toHaveBeenCalledTimes(1);
  });

  it('lets a later external file replace an unopened notebook note', async () => {
    const note = useDocumentStore.getState().openMemoDocument({
      memoId: 'note', path: '/notes/note.md', initialContent: '# Note',
    });
    const external = useDocumentStore.getState().openExternalDocument(
      '/other/readme.md', { scopePath: '/other' },
    );

    await Promise.all([note, external]);

    expect(useDocumentStore.getState().activeMemoSession).toBeNull();
    expect(useDocumentStore.getState().activeExternalSession?.path).toBe('/other/readme.md');
    expect(mocks.stageDocumentSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the current note when it is reselected during a pending switch', async () => {
    useDocumentStore.setState({
      currentDocumentPath: '/notes/current.md',
      currentDocumentSource: 'memo',
      activeMemoSession: {
        id: 'memo:current', memoId: 'current', path: '/notes/current.md',
        notebookId: null, notebookPath: null, openedAt: 1, transitionId: 0,
      },
    });
    let completeFlush!: (saved: boolean) => void;
    mocks.flushDocumentPath.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      completeFlush = resolve;
    }));

    const away = useDocumentStore.getState().openMemoDocument({
      memoId: 'away', path: '/notes/away.md', initialContent: '# Away',
    });
    await vi.waitFor(() => expect(mocks.flushDocumentPath).toHaveBeenCalledTimes(1));
    await useDocumentStore.getState().openMemoDocument({
      memoId: 'current', path: '/notes/current.md',
    });
    completeFlush(true);
    await away;

    expect(useDocumentStore.getState().activeMemoSession?.memoId).toBe('current');
    expect(useDocumentStore.getState().isDocumentTransitioning).toBe(false);
    expect(mocks.stageDocumentSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the current external file when it is reselected during a pending switch', async () => {
    useDocumentStore.setState({
      currentDocumentPath: '/other/current.md',
      currentDocumentSource: 'external',
      activeExternalSession: {
        id: 'external:/other/current.md', path: '/other/current.md',
        scopePath: '/other', openedAt: 1, transitionId: 0,
      },
    });
    let completeFlush!: (saved: boolean) => void;
    mocks.flushDocumentPath.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      completeFlush = resolve;
    }));

    const away = useDocumentStore.getState().openExternalDocument(
      '/other/away.md', { scopePath: '/other' },
    );
    await vi.waitFor(() => expect(mocks.flushDocumentPath).toHaveBeenCalledTimes(1));
    await useDocumentStore.getState().openExternalDocument(
      '/other/current.md', { scopePath: '/other' },
    );
    completeFlush(true);
    await away;

    expect(useDocumentStore.getState().activeExternalSession?.path).toBe('/other/current.md');
    expect(useDocumentStore.getState().isDocumentTransitioning).toBe(false);
  });

  it('does not hydrate a pending note when the document view closes', async () => {
    useDocumentStore.setState({
      currentDocumentPath: '/notes/current.md',
      currentDocumentSource: 'memo',
      activeMemoSession: {
        id: 'memo:current', memoId: 'current', path: '/notes/current.md',
        notebookId: null, notebookPath: null, openedAt: 1, transitionId: 0,
      },
    });
    let completeFlush!: (saved: boolean) => void;
    mocks.flushDocumentPath.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      completeFlush = resolve;
    }));

    const pending = useDocumentStore.getState().openMemoDocument({
      memoId: 'pending', path: '/notes/pending.md', initialContent: '# Pending',
    });
    await vi.waitFor(() => expect(mocks.flushDocumentPath).toHaveBeenCalledTimes(1));
    const close = useDocumentStore.getState().clearDocument();
    completeFlush(true);
    await Promise.all([pending, close]);

    expect(useDocumentStore.getState().activeMemoSession).toBeNull();
    expect(useDocumentStore.getState().isDocumentTransitioning).toBe(false);
    expect(mocks.stageDocumentSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the current document and clears the busy state if closing cannot save', async () => {
    useDocumentStore.setState({
      currentDocumentPath: '/notes/current.md',
      currentDocumentSource: 'memo',
      activeMemoSession: {
        id: 'memo:current', memoId: 'current', path: '/notes/current.md',
        notebookId: null, notebookPath: null, openedAt: 1, transitionId: 0,
      },
    });
    mocks.flushDocumentPath.mockResolvedValueOnce(false);

    await expect(useDocumentStore.getState().clearDocument()).rejects.toThrow(
      'Document close cancelled because saving did not complete',
    );

    expect(useDocumentStore.getState().activeMemoSession?.memoId).toBe('current');
    expect(useDocumentStore.getState().isDocumentTransitioning).toBe(false);
  });
});
