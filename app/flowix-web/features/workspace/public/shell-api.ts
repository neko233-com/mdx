import { useShallow } from 'zustand/react/shallow';
import { useWorkColumnStore } from '@features/workspace/store/work-column-store';
import { useBrowserColumnStore } from '@features/workspace/store/browser-column-store';
import { useWorkspaceFocusStore } from '@features/workspace/store/workspace-focus-store';

export {
  BROWSER_COLUMN_DEFAULT_SPLIT_RATIO,
  BROWSER_COLUMN_MIN_WIDTH,
} from '@features/workspace/store/browser-column-store';
export type { WorkColumnTarget } from '@features/workspace/store/work-column-target';

export function useShellWorkspaceViewModel() {
  const navigation = useWorkColumnStore((state) => state.navigation);
  const focus = useWorkspaceFocusStore(useShallow((state) => ({
    focusWorkspaceHost: state.focusHost,
    focusedHostId: state.focusedHostId,
  })));
  return { navigation, ...focus };
}

export function useNotebookSwitching() {
  return useWorkColumnStore((state) => state.notebookSwitchesInFlight > 0);
}

/** Discard the legacy second editor pane after upgrading to the single-pane layout. */
export function clearLegacyBrowserColumn(): void {
  useBrowserColumnStore.getState().closeAllTabs();
}
