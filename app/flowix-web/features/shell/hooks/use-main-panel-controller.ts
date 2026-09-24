import { useCallback, useEffect, useState } from 'react';
import { useResizablePanels } from '@features/shell/hooks/use-resizable-panels';

export type NoteNavigationDrawerPhase = 'closed' | 'open' | 'closing';

interface MainPanelControllerOptions {
  documentPanelMinWidth: number;
  memoListVisible: boolean;
  noteNavigationVisible: boolean;
  setMemoListVisible(visible: boolean): void;
  setNoteNavigationVisible(visible: boolean): void;
}

export function useMainPanelController({
  documentPanelMinWidth,
  memoListVisible,
  noteNavigationVisible,
  setMemoListVisible,
  setNoteNavigationVisible,
}: MainPanelControllerOptions) {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [noteNavigationPhase, setNoteNavigationPhase] = useState<NoteNavigationDrawerPhase>(
    () => noteNavigationVisible ? 'open' : 'closed',
  );

  // The persisted boolean is the semantic setting. The phase is transient
  // layout state used to synchronize the drawer with the list preview.
  useEffect(() => {
    if (noteNavigationVisible && noteNavigationPhase === 'closed') {
      setNoteNavigationPhase('open');
    } else if (!noteNavigationVisible && noteNavigationPhase === 'open') {
      setNoteNavigationPhase('closed');
    }
  }, [noteNavigationPhase, noteNavigationVisible]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    handleListDividerMouseDown,
    isDraggingListDivider,
    isMemoListHidden,
    memoColWidth,
  } = useResizablePanels({
    documentPanelMinWidth,
    layoutWidth: viewportWidth,
    memoListVisible,
    noteNavigationWidth: 0,
  });

  const openNoteNavigation = useCallback(() => {
    setNoteNavigationPhase('open');
    setNoteNavigationVisible(true);
  }, [setNoteNavigationVisible]);
  const closeNoteNavigation = useCallback(() => {
    if (!noteNavigationVisible || noteNavigationPhase === 'closing') return;
    // Start the drawer and list transitions in the same render.
    setNoteNavigationPhase('closing');
    setNoteNavigationVisible(false);
  }, [noteNavigationPhase, noteNavigationVisible, setNoteNavigationVisible]);
  const completeNoteNavigationClose = useCallback(() => {
    setNoteNavigationPhase('closed');
  }, []);
  const handleToggleNoteNavigation = useCallback(() => {
    if (noteNavigationVisible) closeNoteNavigation();
    else openNoteNavigation();
  }, [closeNoteNavigation, noteNavigationVisible, openNoteNavigation]);
  const collapseMemoList = useCallback(() => {
    setMemoListVisible(false);
  }, [setMemoListVisible]);
  const handleToggleMemoList = useCallback(() => {
    const nextVisible = !memoListVisible;
    setMemoListVisible(nextVisible);
    if (!nextVisible && noteNavigationVisible) closeNoteNavigation();
  }, [closeNoteNavigation, memoListVisible, noteNavigationVisible, setMemoListVisible]);

  return {
    collapseMemoList,
    handleListDividerMouseDown,
    handleToggleMemoList,
    handleToggleNoteNavigation,
    closeNoteNavigation,
    completeNoteNavigationClose,
    isDraggingListDivider,
    isMemoListHidden,
    memoColWidth,
    noteNavigationPhase,
  };
}
