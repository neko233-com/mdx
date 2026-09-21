import {
  initializeMemoLibrary,
  restorePersistedMemoSession,
} from '@features/memo/public/app-api';
import { restoreAgentConversationWorkspace } from '@features/workspace/public/startup-api';
import { boot } from '@platform/tauri/client';

/**
 * Run the main-window startup stages in one failure-aware transaction.
 *
 * Memo library initialization is the prerequisite for restoring a persisted
 * memo session. Keeping the stages together means a retry follows the same
 * order as the initial boot and never restores a document against stale
 * notebook state.
 */
export async function initializeMainWindowStartup(): Promise<void> {
  if (isTauriRuntime()) await boot.waitForStartupReady();
  await initializeMemoLibrary();
  await restorePersistedMemoSession();
  await restoreAgentConversationWorkspace();
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}
