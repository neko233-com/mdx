'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { File } from 'lucide-react';
import { FolderPlus } from 'lucide-react';

import {
  canonicalDirectoryPath,
  canonicalPath,
  parentDirectoryPath,
  pathInDirectory,
  samePath,
  uniquePaths,
} from '@/lib/path';
import { createLogger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { cn, displayTitleFromFilename } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useComposingValue } from '@shared/hooks/use-composing-value';
import { OverlayScrollbar } from '@shared/ui/overlay-scrollbar';
import { FileTypeIcon } from '@features/memo/components/file-type-icon';
import { useMemoStore } from '@features/memo';
import { useDocumentStore } from '@features/document/store';
import {
  elementFromExternalDropPosition,
  EXTERNAL_FILE_DROP_EVENT,
  type ExternalDropPosition,
  type ExternalFileDropDetail,
} from '@features/document/components/use-markdown-file-drop';
import { resolveMemoByPath } from '@features/memo/use-cases/open-by-target';
import folderIcon from '@/assets/folder-outline.svg?raw';
import {
  flattenLoadedTree,
  flattenVisibleTree,
  type FolderTreeController,
} from '@features/memo/components/use-folder-tree';
import { NotebookTreeRow } from '@features/memo/components/notebook-tree-row';
import { files, memos, type DocTreeItem, type DocTreeResourceKind } from '@platform/tauri/client';
import { resourceKindFromPath } from '@features/editor/code-file';

const TREE_EDGE_GUTTER = 6;
const INDENT_PER_LEVEL = 20;
const logger = createLogger('notebook-file-tree');
// Row gutter (6px) + inline padding (6px) + half of the 12px caret.
const FOLDER_CARET_CENTER_OFFSET = 12;

function resolveDropDirectory(
  hit: Element | null,
  treeRoot: HTMLElement,
  notebookPath: string,
): string | null {
  if (!hit || !treeRoot.contains(hit)) return null;

  // A folder group (or a note row inside it) is more specific than the tree
  // root. Only fall back to root when no concrete drop target was hit.
  const concreteTarget = hit.closest<HTMLElement>('[data-notebook-drop-path]');
  return concreteTarget?.dataset.notebookDropPath ?? notebookPath;
}

function resolveExternalDropDirectory(
  position: ExternalDropPosition | null,
  treeRoot: HTMLElement,
  notebookPath: string,
): string | null {
  const hit = elementFromExternalDropPosition(position);
  return hit ? resolveDropDirectory(hit, treeRoot, notebookPath) : null;
}


export interface NotebookFolderCreateRequest {
  id: number;
  parentPath: string;
}

export interface NotebookNoteCreateRequest {
  id: number;
  parentPath: string;
}

export interface NotebookMoveResult {
  movedPaths: string[];
  failedPaths: string[];
}

export interface NotebookMoveSource {
  path: string;
  memoId?: string;
  resourceKind?: DocTreeResourceKind | null;
}

interface NotebookFileTreeProps {
  notebookPath: string;
  notebookName: string;
  activeFilePath?: string | null;
  tree: FolderTreeController;
  createFolderRequest?: NotebookFolderCreateRequest | null;
  createNoteRequest?: NotebookNoteCreateRequest | null;
  onCreateFolder?: () => void;
  onNoteSelect: (filePath: string) => void;
  onNoteOpenInNewTab?: (filePath: string) => void;
  onCreateNote: (parentPath: string, title: string) => Promise<void> | void;
  onMoveNote: (
    sources: NotebookMoveSource[],
    targetDirectoryPath: string,
  ) => Promise<NotebookMoveResult>;
  onDeleteFolder?: (folderPath: string) => Promise<void>;
}

interface PointerNoteDrag {
  sourcePath: string;
  sourcePaths: string[];
  sourceItems: NotebookMoveSource[];
  sourceName: string;
  pointerId: number;
  captureElement: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  targetDirectoryPath: string | null;
}

interface NotebookTreeDraftState {
  requestId: number;
  parentPath: string;
  kind: 'note' | 'folder';
  value: string;
}

interface NotebookMoveFeedback {
  paths: string[];
  targetDirectoryPath: string;
  status: 'moving' | 'success';
}


/**
 * Notebook file tree with selection, pointer dragging, and external drops.
 */
export function NotebookFileTree({
  notebookPath,
  notebookName,
  activeFilePath = null,
  tree,
  createFolderRequest,
  createNoteRequest,
  onCreateFolder,
  onNoteSelect,
  onNoteOpenInNewTab,
  onCreateNote,
  onMoveNote,
  onDeleteFolder,
}: NotebookFileTreeProps) {
  const { t } = useI18n();
  const [showScrollTopHint, setShowScrollTopHint] = useState(false);
  const [draft, setDraft] = useState<NotebookTreeDraftState | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [focusedTreePath, setFocusedTreePath] = useState<string | null>(null);
  const selectedFilePathsRef = useRef<string[]>([]);
  const selectionAnchorPathRef = useRef<string | null>(null);
  const pointerDragRef = useRef<PointerNoteDrag | null>(null);
  const dropPendingRef = useRef(false);
  const externalDropTargetPathRef = useRef<string | null>(null);
  const treeScrollerRef = useRef<HTMLDivElement | null>(null);
  const externalDropSurfaceRef = useRef<HTMLDivElement | null>(null);
  const treeRootRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewPositionRef = useRef({ x: 0, y: 0 });
  const moveFeedbackTimerRef = useRef<number | null>(null);
  const suppressOpenPathsRef = useRef<Set<string>>(new Set());
  const handledFolderRequestIdRef = useRef<number | null>(null);
  const handledNoteRequestIdRef = useRef<number | null>(null);
  const cancelledDraftRequestIdRef = useRef<number | null>(null);
  const submittingDraftRef = useRef(false);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    name: string;
    path: string;
    count: number;
  } | null>(null);
  const [moveFeedback, setMoveFeedback] = useState<NotebookMoveFeedback | null>(null);

  const clearMoveFeedbackTimer = useCallback(() => {
    if (moveFeedbackTimerRef.current === null) return;
    window.clearTimeout(moveFeedbackTimerRef.current);
    moveFeedbackTimerRef.current = null;
  }, []);

  useEffect(() => clearMoveFeedbackTimer, [clearMoveFeedbackTimer]);

  const updateDragPreviewPosition = useCallback((x: number, y: number) => {
    dragPreviewPositionRef.current = { x, y };
    dragPreviewRef.current?.style.setProperty(
      'transform',
      `translate3d(${x}px, ${y}px, 0)`,
    );
  }, []);
  const selectedFilePathSet = useMemo(
    () => new Set(selectedFilePaths.map((path) => canonicalPath(path))),
    [selectedFilePaths],
  );
  const loadedTreeItems = useMemo(() => flattenLoadedTree(tree), [tree]);
  const visibleTreeItems = useMemo(() => flattenVisibleTree(tree), [tree]);
  const visibleNotePaths = useMemo(
    () => visibleTreeItems
      .filter(({ item }) => item.type === 'document')
      .map(({ item }) => item.fullPath),
    [visibleTreeItems],
  );
  const memoIdByPath = useMemo(
    () => new Map(
      loadedTreeItems
        .filter((item) => item.memoMeta?.id)
        .map((item) => [canonicalPath(item.fullPath), item.memoMeta!.id] as const),
    ),
    [loadedTreeItems],
  );
  const treeItemByPath = useMemo(() => {
    return new Map(loadedTreeItems.map((item) => [canonicalPath(item.fullPath), item] as const));
  }, [loadedTreeItems]);
  const treeItemPaths = useMemo(() => new Set(treeItemByPath.keys()), [treeItemByPath]);
  const updateSelection = useCallback((paths: string[], anchorPath: string | null) => {
    const nextPaths = uniquePaths(paths);
    selectedFilePathsRef.current = nextPaths;
    selectionAnchorPathRef.current = anchorPath;
    setSelectedFilePaths(nextPaths);
  }, []);
  useEffect(() => {
    const currentPaths = selectedFilePathsRef.current;
    const nextPaths = currentPaths.filter((path) => treeItemPaths.has(canonicalPath(path)));
    if (nextPaths.length === currentPaths.length) return;
    const anchorPath = selectionAnchorPathRef.current;
    updateSelection(
      nextPaths,
      anchorPath && nextPaths.some((path) => samePath(path, anchorPath))
        ? anchorPath
        : nextPaths[nextPaths.length - 1] ?? null,
    );
  }, [treeItemPaths, updateSelection]);
  const focusTreeItem = useCallback((path: string) => {
    setFocusedTreePath(path);
    const row = Array.from(
      treeRootRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    ).find((candidate) => samePath(candidate.dataset.notebookTreePath ?? '', path));
    row?.focus();
  }, []);
  const handleTreeItemKeyDown = useCallback((
    path: string,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const currentIndex = visibleTreeItems.findIndex(({ item }) => samePath(item.fullPath, path));
    if (currentIndex < 0) return;
    const current = visibleTreeItems[currentIndex];
    const nextVisibleItem = (step: number) => visibleTreeItems[currentIndex + step];

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const target = nextVisibleItem(event.key === 'ArrowDown' ? 1 : -1);
      if (!target) return;
      event.preventDefault();
      focusTreeItem(target.item.fullPath);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      const target = event.key === 'Home'
        ? visibleTreeItems[0]
        : visibleTreeItems[visibleTreeItems.length - 1];
      if (!target) return;
      event.preventDefault();
      focusTreeItem(target.item.fullPath);
      return;
    }

    if (event.key === 'ArrowRight' && current.item.type === 'folder') {
      const expanded = tree.expanded.has(canonicalPath(current.item.fullPath));
      if (!expanded) {
        event.preventDefault();
        tree.toggle(current.item.fullPath);
        return;
      }
      const child = nextVisibleItem(1);
      if (child && child.depth > current.depth) {
        event.preventDefault();
        focusTreeItem(child.item.fullPath);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (current.item.type === 'folder'
        && tree.expanded.has(canonicalPath(current.item.fullPath))) {
        event.preventDefault();
        tree.toggle(current.item.fullPath);
        return;
      }
      const parent = visibleTreeItems
        .slice(0, currentIndex)
        .reverse()
        .find(({ item, depth }) => item.type === 'folder' && depth < current.depth);
      if (parent) {
        event.preventDefault();
        focusTreeItem(parent.item.fullPath);
      }
    }
  }, [focusTreeItem, tree, visibleTreeItems]);
  useEffect(() => {
    const hasFocusedItem = focusedTreePath
      && visibleTreeItems.some(({ item }) => samePath(item.fullPath, focusedTreePath));
    if (hasFocusedItem) return;
    const fallback = activeFilePath && visibleTreeItems.some(({ item }) => samePath(item.fullPath, activeFilePath))
      ? activeFilePath
      : visibleTreeItems[0]?.item.fullPath ?? null;
    if (fallback !== focusedTreePath) setFocusedTreePath(fallback);
  }, [activeFilePath, focusedTreePath, visibleTreeItems]);
  const selectNote = useCallback((filePath: string, event?: ReactMouseEvent<HTMLDivElement>) => {
    const currentPaths = selectedFilePathsRef.current;
    const isToggle = Boolean(event?.ctrlKey || event?.metaKey);
    const anchorPath = selectionAnchorPathRef.current;
    const targetIndex = visibleNotePaths.findIndex((path) => samePath(path, filePath));
    const anchorIndex = anchorPath
      ? visibleNotePaths.findIndex((path) => samePath(path, anchorPath))
      : -1;

    if (event?.shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const range = visibleNotePaths.slice(start, end + 1);
      updateSelection(isToggle ? [...currentPaths, ...range] : range, filePath);
    } else if (isToggle) {
      const nextPaths = currentPaths.some((path) => samePath(path, filePath))
        ? currentPaths.filter((path) => !samePath(path, filePath))
        : [...currentPaths, filePath];
      updateSelection(nextPaths, filePath);
    } else {
      updateSelection([filePath], filePath);
      onNoteSelect(filePath);
    }
  }, [onNoteSelect, updateSelection, visibleNotePaths]);
  const hasVisibleItems = tree.rootChildren.length > 0;
  const isRootDropTarget = dragOverFolderPath !== null
    && canonicalDirectoryPath(dragOverFolderPath) === canonicalDirectoryPath(notebookPath);
  const treeFocusPath = focusedTreePath
    ?? (activeFilePath && visibleTreeItems.some(({ item }) => samePath(item.fullPath, activeFilePath))
      ? activeFilePath
      : visibleTreeItems[0]?.item.fullPath ?? null);

  useEffect(() => {
    if (!activeFilePath || tree.loading) return;
    void tree.expandTo(activeFilePath);
  }, [activeFilePath, tree.expandTo, tree.loading]);

  useEffect(() => {
    if (!createFolderRequest || handledFolderRequestIdRef.current === createFolderRequest.id) return;
    handledFolderRequestIdRef.current = createFolderRequest.id;
    void tree.expandTo(`${createFolderRequest.parentPath}/__new-folder__`);
    setDraft({
      requestId: createFolderRequest.id,
      parentPath: createFolderRequest.parentPath,
      kind: 'folder',
      value: '',
    });
  }, [createFolderRequest, tree.expandTo]);

  useEffect(() => {
    if (!createNoteRequest || handledNoteRequestIdRef.current === createNoteRequest.id) return;
    handledNoteRequestIdRef.current = createNoteRequest.id;
    void tree.expandTo(`${createNoteRequest.parentPath}/__new-note__`);
    setDraft({
      requestId: createNoteRequest.id,
      parentPath: createNoteRequest.parentPath,
      kind: 'note',
      value: '',
    });
  }, [createNoteRequest, tree.expandTo]);

  const submitDraft = useCallback(async () => {
    if (!draft) return;
    if (cancelledDraftRequestIdRef.current === draft.requestId) {
      cancelledDraftRequestIdRef.current = null;
      return;
    }
    if (submittingDraftRef.current) return;
    submittingDraftRef.current = true;
    const { parentPath, kind, value } = draft;
    const name = value.trim();
    if (!name) {
      setDraft(null);
      submittingDraftRef.current = false;
      return;
    }
    try {
      if (kind === 'note') {
        await onCreateNote(parentPath, name);
        await tree.refresh(parentPath);
        setDraft(null);
        return;
      }
      const created = await files.createFolder(parentPath, name);
      if (!created) {
        toast.error(t('memo.fileTree.createFailed'));
        return;
      }
      await tree.refresh(parentPath);
      setDraft(null);
    } catch (error) {
      toast.error(t(
        String(error).includes('FILE_EXISTS')
          ? 'memo.fileTree.nameConflict'
          : 'memo.fileTree.createFailed',
      ));
    } finally {
      submittingDraftRef.current = false;
    }
  }, [draft, onCreateNote, t, tree.refresh]);

  const cancelDraft = useCallback(() => {
    if (!draft) return;
    cancelledDraftRequestIdRef.current = draft.requestId;
    setDraft(null);
  }, [draft]);

  const requestCreateDraft = useCallback((parentPath: string, kind: 'note' | 'folder') => {
    void tree.expandTo(`${parentPath}/__new-${kind}__`);
    setDraft({ requestId: Date.now(), parentPath, kind, value: '' });
  }, [tree.expandTo]);

  const handleRename = useCallback(async (item: DocTreeItem, nextName: string) => {
    const trimmed = nextName.trim();
    const isNote = item.type === 'document'
      && (item.resourceKind ?? resourceKindFromPath(item.name)) === 'note';
    const currentName = item.type === 'folder'
      ? item.name
      : isNote ? displayTitleFromFilename(item.name) : item.name;
    if (!trimmed || trimmed === currentName) return;

    try {
      if (item.type === 'folder') {
        await files.renameFolder(item.fullPath, trimmed, notebookPath);
      } else {
        const memoId = isNote
          ? item.memoMeta?.id ?? (await resolveMemoByPath(item.fullPath))?.memoId
          : null;
        if (memoId) {
          // Indexed notes use the memo path so the index and active editor
          // keep the same identity after the rename. Unindexed Markdown files
          // still use the generic file rename API.
          const result = await memos.renameMemoTitle({
            id: memoId,
            title: trimmed,
            expectedFilename: item.name,
          });
          useMemoStore.getState().handleMemoUpdated(result.memo);
          useDocumentStore.getState().replaceActiveMemoPath(result.memo.id, result.path);
        } else {
          const extension = isNote ? item.name.match(/\.(md|markdown)$/i)?.[0] ?? '' : '';
          await files.rename(item.fullPath, `${trimmed}${extension}`, notebookPath);
        }
      }

      const normalizedPath = canonicalPath(item.fullPath);
      const parent = normalizedPath.slice(0, normalizedPath.lastIndexOf('/'));
      await tree.refresh(parent || notebookPath);
      toast.success(t('memo.fileTree.renamed', { name: trimmed }));
    } catch (error) {
      toast.error(t(String(error).includes('FILE_EXISTS')
        ? 'memo.fileTree.nameConflict'
        : 'memo.fileTree.renameFailed'));
    }
  }, [notebookPath, t, tree.refresh]);

  const renderDraft = (draftState: NotebookTreeDraftState, depth: number, key?: string) => (
    <NotebookTreeDraft
      key={key}
      draft={draftState}
      depth={depth}
      data-notebook-tree-depth={depth}
      onChange={(value) => setDraft({ ...draftState, value })}
      onSubmit={() => void submitDraft()}
      onCancel={cancelDraft}
    />
  );

  const renderTreeItem = (item: DocTreeItem, depth: number) => {
    const expanded = item.type === 'folder' && tree.expanded.has(canonicalPath(item.fullPath));
    const childItems = item.type === 'folder'
      ? tree.nodes.get(canonicalPath(item.fullPath))?.children ?? []
      : [];
    const hasDraftChild = item.type === 'folder'
      && draft !== null
      && canonicalDirectoryPath(draft.parentPath) === canonicalDirectoryPath(item.fullPath);
    // Folder groups own the drop target so child rows do not intercept it.
    const hasSubtreeContent = childItems.length > 0 || hasDraftChild;
    const isDropTarget = item.type === 'folder'
      && dragOverFolderPath !== null
      && canonicalDirectoryPath(item.fullPath) === canonicalDirectoryPath(dragOverFolderPath);
    const isMovingTarget = item.type === 'folder'
      && moveFeedback !== null
      && samePath(item.fullPath, moveFeedback.targetDirectoryPath);
    const isMovingSource = item.type === 'document'
      && moveFeedback !== null
      && moveFeedback.paths.some((path) => samePath(path, item.fullPath));
    const moveStatus = isMovingTarget || isMovingSource ? moveFeedback?.status : undefined;

    return (
      <div
        key={item.id}
        className={cn(
          item.type === 'folder' && 'folder-file-tree__group notebook-file-tree__folder-group relative',
        )}
        data-notebook-tree-depth={depth}
        data-drag-over={isDropTarget ? 'true' : 'false'}
        data-notebook-drop-path={item.type === 'folder' ? item.fullPath : undefined}
        style={{
          '--folder-file-tree-drop-left': `${TREE_EDGE_GUTTER + depth * INDENT_PER_LEVEL}px`,
          '--folder-file-tree-drop-right': `${TREE_EDGE_GUTTER}px`,
        } as CSSProperties}
      >
        {depth > 0 && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {Array.from({ length: depth }, (_, level) => (
              <span
                key={level}
                className="absolute inset-y-0 w-px"
                style={{
                  left: TREE_EDGE_GUTTER + level * INDENT_PER_LEVEL + FOLDER_CARET_CENTER_OFFSET,
                  backgroundColor: 'color-mix(in srgb, var(--border) 72%, transparent)',
                }}
              />
            ))}
          </div>
        )}
        <NotebookTreeRow
          item={item}
          depth={depth}
          expanded={expanded}
          active={item.type === 'document' && Boolean(activeFilePath)
            && canonicalPath(item.fullPath) === canonicalPath(activeFilePath!)}
          selected={item.type === 'document' && selectedFilePathSet.has(canonicalPath(item.fullPath))}
          moveStatus={moveStatus}
          onToggle={() => tree.toggle(item.fullPath)}
          onOpen={(event) => {
            if (suppressOpenPathsRef.current.has(canonicalPath(item.fullPath))) {
              return;
            }
            selectNote(item.fullPath, event);
          }}
          onOpenInNewTab={onNoteOpenInNewTab
            ? () => onNoteOpenInNewTab(item.fullPath)
            : undefined}
          onCreateNote={() => requestCreateDraft(isFolderParent(item, notebookPath), 'note')}
          onCreateFolder={() => requestCreateDraft(isFolderParent(item, notebookPath), 'folder')}
          onRename={(nextName) => handleRename(item, nextName)}
          tabIndex={treeFocusPath && samePath(treeFocusPath, item.fullPath) ? 0 : -1}
          onFocus={() => setFocusedTreePath(item.fullPath)}
          onKeyDown={(event) => handleTreeItemKeyDown(item.fullPath, event)}
          onDeleteFolder={item.type === 'folder' && onDeleteFolder
            ? () => onDeleteFolder(item.fullPath)
            : undefined}
          onPointerDown={(event) => {
            if (item.type !== 'document' || dropPendingRef.current) return;
            const currentPaths = selectedFilePathsRef.current;
            const isSelected = currentPaths.some((path) => samePath(path, item.fullPath));
            const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey;
            const sourcePaths = isSelected ? currentPaths : [item.fullPath];
            const sourceItems = sourcePaths.map((path) => {
              const sourceItem = path === item.fullPath ? item : treeItemByPath.get(canonicalPath(path));
              const memoId = memoIdByPath.get(canonicalPath(path));
              const resourceMetadata = sourceItem?.resourceKind
                ? { resourceKind: sourceItem.resourceKind }
                : {};
              return memoId
                ? { path, memoId, ...resourceMetadata }
                : { path, ...resourceMetadata };
            });
            if (!isSelected && !hasModifier) {
              updateSelection([item.fullPath], item.fullPath);
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            pointerDragRef.current = {
              sourcePath: item.fullPath,
              sourcePaths,
              sourceItems,
              sourceName: displayTitleFromFilename(item.name),
              pointerId: event.pointerId,
              captureElement: event.currentTarget,
              startX: event.clientX,
              startY: event.clientY,
              active: false,
              targetDirectoryPath: null,
            };
          }}
        />
        {item.type === 'folder' && (
          <div
            className="folder-file-tree__subtree"
            data-expanded={expanded}
            data-empty={!hasSubtreeContent ? 'true' : undefined}
            aria-hidden={!expanded}
            style={{
              '--folder-file-tree-guide-left': `${TREE_EDGE_GUTTER + depth * INDENT_PER_LEVEL + FOLDER_CARET_CENTER_OFFSET}px`,
            } as CSSProperties}
          >
            <div className="folder-file-tree__subtree-inner">
              <div className="folder-file-tree__subtree-items notebook-file-tree__subtree-items">
                {expanded ? renderTreeItems(
                  childItems,
                  depth + 1,
                  item.fullPath,
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTreeItems = (items: DocTreeItem[], depth: number, parentPath: string) => {
    const draftForList = draft
      && canonicalDirectoryPath(draft.parentPath) === canonicalDirectoryPath(parentPath)
      ? draft
      : null;
    const draftType = draftForList?.kind === 'folder' ? 'folder' : 'document';
    const firstMatchingIndex = draftForList
      ? items.findIndex((item) => item.type === draftType)
      : -1;
    const draftInsertionIndex = draftForList
      ? firstMatchingIndex >= 0 ? firstMatchingIndex : draftForList.kind === 'folder' ? 0 : items.length
      : -1;

    return items.flatMap((item, index) => [
      ...(index === draftInsertionIndex && draftForList
        ? [renderDraft(draftForList, depth, `draft-${draftForList.requestId}`)]
        : []),
      renderTreeItem(item, depth),
    ].filter(Boolean));
  };

  const handleDrop = useCallback(async (
    targetDirectoryPath: string,
    sourceItemsOverride?: NotebookMoveSource[],
  ) => {
    if (dropPendingRef.current) return;
    const sourceItems = sourceItemsOverride ?? pointerDragRef.current?.sourceItems ?? [];
    const sourcePaths = sourceItems.map((source) => source.path);
    if (sourcePaths.length === 0) return;
    const targetPath = canonicalDirectoryPath(targetDirectoryPath);
    const movableSourceItems = sourceItems.filter(
      (source) => parentDirectoryPath(source.path, notebookPath) !== targetPath,
    );
    const movableSourcePaths = movableSourceItems.map((source) => source.path);
    pointerDragRef.current = null;
    setDragOverFolderPath(null);
    setDragPreview(null);
    if (movableSourcePaths.length === 0) return;
    dropPendingRef.current = true;
    clearMoveFeedbackTimer();
    setMoveFeedback({
      paths: movableSourcePaths,
      targetDirectoryPath: targetPath,
      status: 'moving',
    });
    try {
      const startedAt = performance.now();
      const moveResult = await onMoveNote(movableSourceItems, targetDirectoryPath);
      const moveFinishedAt = performance.now();
      const rootPath = canonicalDirectoryPath(notebookPath);
      const sourceParents = uniquePaths(
        movableSourcePaths.map((sourcePath) => parentDirectoryPath(sourcePath, notebookPath)),
      ).filter((path) => (
        path === rootPath || path.startsWith(`${rootPath}/`)
      ));
      const refreshPaths = moveResult.movedPaths.length > 0
        ? [...sourceParents, targetDirectoryPath]
        : sourceParents;
      await Promise.all(uniquePaths(refreshPaths).map((path) => tree.refresh(path)));
      const refreshFinishedAt = performance.now();
      logger.debug('notebook tree drop completed', {
        requestedCount: movableSourcePaths.length,
        movedCount: moveResult.movedPaths.length,
        failedCount: moveResult.failedPaths.length,
        moveDurationMs: Math.round(moveFinishedAt - startedAt),
        refreshDurationMs: Math.round(refreshFinishedAt - moveFinishedAt),
        totalDurationMs: Math.round(refreshFinishedAt - startedAt),
      });

      const unchangedSelection = sourcePaths.filter((sourcePath) => (
        parentDirectoryPath(sourcePath, notebookPath) === targetPath
      ));
      const nextSelection = uniquePaths([
        ...moveResult.movedPaths,
        ...moveResult.failedPaths,
        ...unchangedSelection,
      ]);
      const selectedAnchor = selectionAnchorPathRef.current;
      const movedAnchor = selectedAnchor
        ? moveResult.movedPaths.find((path) => (
          samePath(path, pathInDirectory(targetPath, selectedAnchor))
        ))
        : null;
      const nextAnchor = movedAnchor
        ?? (selectedAnchor && moveResult.failedPaths.some((path) => samePath(path, selectedAnchor))
          ? selectedAnchor
          : selectedAnchor && unchangedSelection.some((path) => samePath(path, selectedAnchor))
            ? selectedAnchor
            : nextSelection[nextSelection.length - 1] ?? null);
      updateSelection(nextSelection, nextAnchor);
      if (moveResult.movedPaths.length > 0) {
        setMoveFeedback({
          paths: moveResult.movedPaths,
          targetDirectoryPath: targetPath,
          status: 'success',
        });
        moveFeedbackTimerRef.current = window.setTimeout(() => {
          moveFeedbackTimerRef.current = null;
          setMoveFeedback(null);
        }, 450);
      } else {
        setMoveFeedback(null);
      }
      if (moveResult.failedPaths.length > 0) {
        toast.error(t('memo.fileTree.movePartialFailed', {
          moved: moveResult.movedPaths.length,
          failed: moveResult.failedPaths.length,
        }));
      }
    } catch (error) {
      clearMoveFeedbackTimer();
      setMoveFeedback(null);
      toast.error(t(String(error).includes('FILE_EXISTS')
        ? 'memo.fileTree.nameConflict'
        : 'memo.fileTree.moveFailed'));
    } finally {
      dropPendingRef.current = false;
    }
  }, [clearMoveFeedbackTimer, notebookPath, onMoveNote, t, tree.refresh, updateSelection]);

  useEffect(() => {
    const dropSurface = externalDropSurfaceRef.current;
    if (!dropSurface) return;

    const updateExternalDropTarget = (detail: ExternalFileDropDetail) => {
      if (dropPendingRef.current) {
        externalDropTargetPathRef.current = null;
        setDragOverFolderPath(null);
        return;
      }
      if (detail.type === 'leave' || detail.paths.length === 0) {
        externalDropTargetPathRef.current = null;
        if (!pointerDragRef.current) setDragOverFolderPath(null);
        return;
      }

      const targetDirectoryPath = resolveExternalDropDirectory(
        detail.position,
        dropSurface,
        notebookPath,
      );
      const targetPath = targetDirectoryPath
        ? canonicalDirectoryPath(targetDirectoryPath)
        : null;
      const canDrop = targetPath !== null && detail.paths.some((path) => (
        parentDirectoryPath(path, notebookPath) !== targetPath
      ));
      const nextTargetPath = canDrop ? targetPath : null;
      const previousTargetPath = externalDropTargetPathRef.current;
      externalDropTargetPathRef.current = nextTargetPath;
      if (previousTargetPath !== nextTargetPath) {
        setDragOverFolderPath(nextTargetPath);
      }

      if (detail.type !== 'drop' || !nextTargetPath) return;
      externalDropTargetPathRef.current = null;
      void handleDrop(nextTargetPath, detail.paths.map((path) => ({
        path,
        resourceKind: resourceKindFromPath(path),
      })));
    };

    const onExternalFileDrop = (event: Event) => {
      const detail = (event as CustomEvent<ExternalFileDropDetail>).detail;
      if (!detail) return;
      updateExternalDropTarget(detail);
    };

    window.addEventListener(EXTERNAL_FILE_DROP_EVENT, onExternalFileDrop);
    return () => {
      window.removeEventListener(EXTERNAL_FILE_DROP_EVENT, onExternalFileDrop);
      externalDropTargetPathRef.current = null;
    };
  }, [handleDrop, notebookPath]);

  return (
    <div
      ref={externalDropSurfaceRef}
      data-notebook-external-drop-target="true"
      className="relative flex h-full min-h-0 flex-col select-none bg-[var(--card)] text-[var(--foreground)]"
    >
      <div className="relative min-h-0 flex-1">
        <OverlayScrollbar
          className="h-full"
          scrollerClassName="h-full overflow-y-auto pb-1"
          scrollerRef={treeScrollerRef}
          onScroll={(event) => {
            setShowScrollTopHint(event.currentTarget.scrollTop > 0);
          }}
        >
          <div className="flex h-6 items-center gap-1 px-3">
            <h3 className="text-xs font-medium leading-6 text-[var(--muted-foreground)] opacity-90">
              {t('memo.fileTree.sectionTitle')}
            </h3>
            {onCreateFolder && (
              <button
                type="button"
                onClick={onCreateFolder}
                aria-label={t('memo.fileTree.newFolder')}
                title={t('memo.fileTree.newFolder')}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand)]"
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            ref={treeRootRef}
            role="tree"
            aria-multiselectable="true"
            aria-label={notebookName}
            data-notebook-tree-root="true"
            className={cn(
              'relative rounded-lg transition-colors duration-150',
              isRootDropTarget && 'bg-[color-mix(in_oklch,var(--brand)_10%,transparent)]',
            )}
            onPointerMove={(event) => {
              const drag = pointerDragRef.current;
              if (!drag || event.pointerId !== drag.pointerId) return;
              if (!drag.active) {
                const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
                if (distance < 5) return;
                drag.active = true;
                setDragPreview({
                  name: drag.sourceName,
                  path: drag.sourcePath,
                  count: drag.sourcePaths.length,
                });
              }
              event.preventDefault();
              updateDragPreviewPosition(event.clientX + 12, event.clientY + 12);
              const hit = document.elementFromPoint(event.clientX, event.clientY);
              const treeRoot = treeRootRef.current;
              const hitTree = hit?.closest<HTMLElement>('[data-notebook-tree-root="true"]');
              const candidateDirectoryPath = hitTree === treeRoot
                ? treeRoot ? resolveDropDirectory(hit, treeRoot, notebookPath) : null
                : null;
              const targetDirectoryPath = candidateDirectoryPath
                && drag.sourcePaths.some(
                  (sourcePath) => parentDirectoryPath(sourcePath, notebookPath)
                    !== canonicalDirectoryPath(candidateDirectoryPath),
                )
                ? candidateDirectoryPath
                : null;
              if (drag.targetDirectoryPath !== targetDirectoryPath) {
                drag.targetDirectoryPath = targetDirectoryPath;
                setDragOverFolderPath(targetDirectoryPath);
              }
            }}
            onPointerUp={(event) => {
              const drag = pointerDragRef.current;
              if (!drag || event.pointerId !== drag.pointerId) return;
              if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
                drag.captureElement.releasePointerCapture(drag.pointerId);
              }
              pointerDragRef.current = null;
              setDragOverFolderPath(null);
              setDragPreview(null);
              if (!drag.active || !drag.targetDirectoryPath) return;
              event.preventDefault();
              const suppressedPaths = new Set(
                drag.sourcePaths.map((sourcePath) => canonicalPath(sourcePath)),
              );
              suppressOpenPathsRef.current = suppressedPaths;
              window.setTimeout(() => {
                if (suppressOpenPathsRef.current === suppressedPaths) {
                  suppressOpenPathsRef.current = new Set();
                }
              }, 0);
              void handleDrop(drag.targetDirectoryPath, drag.sourceItems);
            }}
            onPointerCancel={(event) => {
              const drag = pointerDragRef.current;
              if (!drag || event.pointerId !== drag.pointerId) return;
              pointerDragRef.current = null;
              setDragOverFolderPath(null);
              setDragPreview(null);
            }}
          >
            {!hasVisibleItems && !tree.loading && !draft && (
              <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
                {tree.error ? t('memo.fileTree.unreadableHint') : t('memo.fileTree.empty')}
              </div>
            )}
            <div className="notebook-file-tree__items">
              {renderTreeItems(tree.rootChildren, 0, notebookPath)}
            </div>
          </div>
        </OverlayScrollbar>
        {dragPreview && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[100] flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-[var(--border-popup)] bg-[color-mix(in_oklch,var(--card)_88%,transparent)] px-2 text-sm text-[var(--foreground)] opacity-90 shadow-[0_4px_16px_-4px_rgb(0_0_0_/_0.35)] backdrop-blur-sm will-change-transform"
            ref={(node) => {
              dragPreviewRef.current = node;
              if (node) {
                const { x, y } = dragPreviewPositionRef.current;
                node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
              }
            }}
          >
            <FileTypeIcon path={dragPreview.path} className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <span className="truncate">
              {dragPreview.count > 1 ? t('memo.fileTree.draggingNotes', { count: dragPreview.count }) : dragPreview.name}
            </span>
          </div>
        )}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-[3] h-3 bg-gradient-to-b from-[color-mix(in_oklch,var(--foreground)_3%,transparent)] to-transparent transition-opacity',
            showScrollTopHint ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </div>
  );
}

function NotebookTreeDraft({
  draft,
  depth,
  onChange,
  onSubmit,
  onCancel,
  style,
  'data-notebook-tree-depth': dataDepth,
}: {
  draft: { requestId: number; kind: 'note' | 'folder'; value: string };
  depth: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  style?: CSSProperties;
  'data-notebook-tree-depth'?: number;
}) {
  const { t } = useI18n();
  const draftInput = useComposingValue(draft.value, onChange);
  return (
    <div
      data-notebook-tree-depth={dataDepth}
      className="flex h-8 items-center px-1.5"
      style={{
        marginLeft: TREE_EDGE_GUTTER
          + depth * INDENT_PER_LEVEL,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        data-notebook-tree-draft-icon={draft.kind}
        className={cn(
          'relative flex h-[15px] w-[15px] shrink-0 items-center justify-center',
          draft.kind === 'folder'
            ? 'text-[var(--brand)]'
            : 'text-[color-mix(in_oklch,var(--foreground)_90%,white_10%)]',
        )}
      >
        {draft.kind === 'folder' ? (
          <span
            className="absolute inset-0 flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: folderIcon }}
          />
        ) : (
          <File className="h-[15px] w-[15px]" strokeWidth={1.3} />
        )}
      </span>
      <input
        key={draft.requestId}
        autoFocus
        value={draftInput.value}
        placeholder={draft.kind === 'folder' ? t('memo.fileTree.newFolder') : t('memo.fileTree.newNote')}
        onChange={draftInput.onChange}
        onCompositionStart={draftInput.onCompositionStart}
        onCompositionEnd={draftInput.onCompositionEnd}
        onBlur={onSubmit}
        onKeyDown={(event) => {
          if (draftInput.isComposingKeyboardEvent(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="ml-1.5 h-5 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm outline-none"
      />
    </div>
  );
}

function isFolderParent(item: DocTreeItem, notebookPath: string): string {
  if (item.type === 'folder') return item.fullPath;
  return item.fullPath.slice(0, item.fullPath.lastIndexOf('/')) || notebookPath;
}
