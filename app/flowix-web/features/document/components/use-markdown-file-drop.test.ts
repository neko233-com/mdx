import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: null as ((event: { payload: Record<string, unknown> }) => void) | null,
  unlisten: vi.fn(),
  onDragDropEvent: vi.fn(),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mocks.onDragDropEvent,
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    scaleFactor: vi.fn().mockResolvedValue(1),
  }),
}));

import {
  EXTERNAL_FILE_DROP_EVENT,
  elementFromExternalDropPosition,
  firstMarkdownPath,
  isMarkdownPath,
  useMarkdownFileDrop,
} from './use-markdown-file-drop';

interface HarnessProps {
  onDropPaths: (paths: string[]) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

function Harness({ onDropPaths, onError }: HarnessProps) {
  const { isDraggingMarkdown } = useMarkdownFileDrop({
    onDropPaths,
    onDropError: onError,
  });
  return createElement('span', null, isDraggingMarkdown ? 'dragging' : 'idle');
}

describe('useMarkdownFileDrop', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.listener = null;
    mocks.onDragDropEvent.mockImplementation(async (listener) => {
      mocks.listener = listener;
      return mocks.unlisten;
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('recognizes Markdown paths case-insensitively and keeps drop order', () => {
    expect(isMarkdownPath('/notes/a.MD')).toBe(true);
    expect(isMarkdownPath('/notes/a.Markdown')).toBe(true);
    expect(isMarkdownPath('/notes/a.txt')).toBe(false);
    expect(firstMarkdownPath(['/notes/a.txt', '/notes/b.md', '/notes/c.md'])).toBe('/notes/b.md');
  });

  it('shows only for external Markdown drags and forwards every Markdown path on drop', async () => {
    const onDropPaths = vi.fn(async () => undefined);
    await act(async () => root.render(createElement(Harness, { onDropPaths })));

    expect(mocks.onDragDropEvent).toHaveBeenCalledOnce();
    expect(mocks.listener).not.toBeNull();

    await act(async () => {
      mocks.listener?.({ payload: { type: 'enter', paths: undefined as unknown as string[] } });
    });
    expect(container.textContent).toBe('idle');

    await act(async () => {
      mocks.listener?.({ payload: { type: 'enter', paths: ['/notes/a.txt'] } });
    });
    expect(container.textContent).toBe('idle');

    await act(async () => {
      mocks.listener?.({ payload: { type: 'enter', paths: ['/notes/a.md'] } });
    });
    expect(container.textContent).toBe('dragging');

    await act(async () => {
      mocks.listener?.({ payload: { type: 'leave' } });
    });
    expect(container.textContent).toBe('idle');

    await act(async () => {
      mocks.listener?.({ payload: { type: 'enter', paths: ['/notes/a.md', '/notes/b.markdown'] } });
    });
    expect(container.textContent).toBe('dragging');

    await act(async () => {
      mocks.listener?.({
        payload: {
          type: 'drop',
          paths: ['/notes/a.txt', '/notes/b.markdown', '/notes/c.md'],
        },
      });
    });
    expect(container.textContent).toBe('idle');
    expect(onDropPaths).toHaveBeenCalledOnce();
    expect(onDropPaths).toHaveBeenCalledWith(['/notes/b.markdown', '/notes/c.md']);
  });

  it('treats empty or undefined paths as a no-op drop', async () => {
    const onDropPaths = vi.fn();
    await act(async () => root.render(createElement(Harness, { onDropPaths })));

    await act(async () => {
      mocks.listener?.({ payload: { type: 'drop', paths: [] } });
    });
    expect(onDropPaths).not.toHaveBeenCalled();

    await act(async () => {
      mocks.listener?.({ payload: { type: 'drop', paths: undefined as unknown as string[] } });
    });
    expect(onDropPaths).not.toHaveBeenCalled();

    await act(async () => {
      mocks.listener?.({ payload: { type: 'drop', paths: ['/notes/a.txt'] } });
    });
    expect(onDropPaths).not.toHaveBeenCalled();
  });

  it('routes supported external files to the notebook drop target', async () => {
    const onDropPaths = vi.fn();
    const target = document.createElement('div');
    target.dataset.notebookExternalDropTarget = 'true';
    document.body.appendChild(target);
    const routedEvents: CustomEvent[] = [];
    const onRoutedEvent = (event: Event) => {
      routedEvents.push(event as CustomEvent);
    };
    window.addEventListener(EXTERNAL_FILE_DROP_EVENT, onRoutedEvent);
    const previousElementFromPoint = document.elementFromPoint;
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    });

    await act(async () => root.render(createElement(Harness, { onDropPaths })));
    await act(async () => {
      mocks.listener?.({
        payload: {
          type: 'enter',
          paths: ['/external/a.md', '/external/image.png', '/external/archive.zip'],
          position: { x: 10, y: 20 },
        },
      });
      mocks.listener?.({
        payload: {
          type: 'drop',
          paths: ['/external/a.md', '/external/image.png', '/external/archive.zip'],
          position: { x: 10, y: 20 },
        },
      });
    });

    expect(routedEvents.map((event) => event.detail.type)).toEqual(['enter', 'drop']);
    expect(routedEvents[0].detail.paths).toEqual(['/external/a.md', '/external/image.png']);
    expect(onDropPaths).not.toHaveBeenCalled();
    window.removeEventListener(EXTERNAL_FILE_DROP_EVENT, onRoutedEvent);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: previousElementFromPoint,
    });
  });

  it('resolves a logical-pixel drop position on a scaled WebView', () => {
    const target = document.createElement('div');
    target.dataset.notebookExternalDropTarget = 'true';
    document.body.appendChild(target);
    const previousElementFromPoint = document.elementFromPoint;
    const previousDevicePixelRatio = window.devicePixelRatio;
    const elementFromPoint = vi.fn((x: number) => (x === 10 ? target : document.body));
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    });
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });

    expect(elementFromExternalDropPosition({ x: 20, y: 20 }, 2)).toBe(target);
    expect(elementFromPoint).toHaveBeenCalledWith(10, 10);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: previousElementFromPoint,
    });
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previousDevicePixelRatio,
    });
  });

  it('does not let an unrelated HTML drag suppress native file events', async () => {
    const onDropPaths = vi.fn();
    await act(async () => root.render(createElement(Harness, { onDropPaths })));

    await act(async () => {
      document.dispatchEvent(new Event('dragstart', { bubbles: true }));
      mocks.listener?.({ payload: { type: 'enter', paths: ['/notes/a.md'] } });
      mocks.listener?.({ payload: { type: 'drop', paths: ['/notes/a.md'] } });
    });

    expect(onDropPaths).toHaveBeenCalledOnce();
    expect(onDropPaths).toHaveBeenCalledWith(['/notes/a.md']);
  });

  it('ignores late native events after the host unmounts', async () => {
    let resolveRegistration: ((unlisten: () => void) => void) | undefined;
    mocks.onDragDropEvent.mockImplementation((listener) => {
      mocks.listener = listener;
      return new Promise<() => void>((resolve) => {
        resolveRegistration = resolve;
      });
    });
    const onDropPaths = vi.fn();
    await act(async () => root.render(createElement(Harness, { onDropPaths })));

    await act(async () => root.unmount());
    mocks.listener?.({ payload: { type: 'drop', paths: ['/notes/a.md'] } });
    resolveRegistration?.(mocks.unlisten);
    await Promise.resolve();

    expect(onDropPaths).not.toHaveBeenCalled();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('reports asynchronous open failures and unregisters the native listener', async () => {
    const failure = new Error('open failed');
    const onError = vi.fn();
    await act(async () => root.render(createElement(Harness, {
      onDropPaths: async () => { throw failure; },
      onError,
    })));

    await act(async () => {
      mocks.listener?.({ payload: { type: 'drop', paths: ['/notes/a.md'] } });
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith(failure);

    await act(async () => root.unmount());
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    root = createRoot(container);
  });
});
