import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renameMemoTitle = vi.hoisted(() => vi.fn());

vi.mock('@platform/tauri/client', () => ({
  memos: { renameMemoTitle },
}));
vi.mock('@features/document/store/document-session-service', () => ({
  markSelfDocumentPathUpdate: vi.fn(),
  rebaseActiveDocumentPath: vi.fn(),
}));
vi.mock('@features/memo/store/memo-store', () => ({
  useMemoStore: {
    getState: () => ({ handleMemoUpdated: vi.fn() }),
  },
}));
vi.mock('@features/workspace/use-cases/browser-column-navigation', () => ({
  replaceBrowserColumnMemoPath: vi.fn(),
}));
vi.mock('@features/workspace/use-cases/workspace-navigation', () => ({
  replaceActiveMemoPath: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/utils', () => ({
  displayTitleFromFilename: (filename: string) => filename.replace(/\.md$/i, ''),
}));

import {
  TITLE_SAVE_DEBOUNCE_MS,
  useMemoTitleSession,
} from './memo-title-session';

describe('useMemoTitleSession', () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: ReturnType<typeof useMemoTitleSession> | null;

  function Harness({ memoId }: { memoId: string }) {
    const currentSession = useMemoTitleSession(memoId, 'Original.md');
    session = currentSession;
    return createElement('div', { 'data-title': currentSession.snapshot.draft });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    session = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(Harness, { memoId: `memo-title-${Math.random()}` }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps an empty draft local when the automatic timer fires', async () => {
    expect(session).not.toBeNull();

    act(() => session?.setDraft(''));
    expect(container.firstElementChild?.getAttribute('data-title')).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TITLE_SAVE_DEBOUNCE_MS);
    });

    expect(renameMemoTitle).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute('data-title')).toBe('');
  });

  it('restores the confirmed title on an explicit empty commit', async () => {
    expect(session).not.toBeNull();

    act(() => session?.setDraft(''));
    await act(async () => session?.commit());

    expect(renameMemoTitle).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute('data-title')).toBe('Original');
  });

  it('waits 1500ms before submitting a non-empty title', async () => {
    expect(session).not.toBeNull();
    renameMemoTitle.mockResolvedValue({
      memo: { filename: 'Renamed.md' },
      path: '/notes/Renamed.md',
    });

    act(() => session?.setDraft('Renamed'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TITLE_SAVE_DEBOUNCE_MS - 1);
    });
    expect(renameMemoTitle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(renameMemoTitle).toHaveBeenCalledWith({
      id: expect.any(String),
      title: 'Renamed',
      expectedFilename: 'Original.md',
    });
  });
});
