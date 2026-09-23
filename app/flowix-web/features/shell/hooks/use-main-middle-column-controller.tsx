import { useMemoListHoverPreview, type NoteNavigationDrawerPhase } from '@features/memo/public/shell-api';

export interface MainMiddleColumnController {
  memoListPreviewVisible: boolean;
  memoListPreviewPhase: 'closed' | 'opening' | 'open' | 'closing';
  handleMemoListPreviewTriggerEnter(): void;
  handleMemoListPreviewTriggerLeave(): void;
  handleMemoListPreviewEnter(): void;
  handleMemoListPreviewLeave(): void;
  handleMemoListPreviewCompanionEnter(): void;
  handleMemoListPreviewCompanionLeave(): void;
}

export function useMainMiddleColumnController({
  isMemoListHidden,
  noteNavigationPhase,
}: {
  isMemoListHidden: boolean;
  noteNavigationPhase: NoteNavigationDrawerPhase;
}): MainMiddleColumnController {
  const preview = useMemoListHoverPreview(isMemoListHidden, noteNavigationPhase);
  return {
    memoListPreviewVisible: isMemoListHidden && preview.phase !== 'closed',
    memoListPreviewPhase: preview.phase,
    handleMemoListPreviewTriggerEnter: preview.handleTriggerEnter,
    handleMemoListPreviewTriggerLeave: preview.handleTriggerLeave,
    handleMemoListPreviewEnter: preview.handlePreviewEnter,
    handleMemoListPreviewLeave: preview.handlePreviewLeave,
    handleMemoListPreviewCompanionEnter: preview.handleCompanionSurfaceEnter,
    handleMemoListPreviewCompanionLeave: preview.handleCompanionSurfaceLeave,
  };
}
