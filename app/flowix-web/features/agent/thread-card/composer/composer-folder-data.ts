import { resolveNotebookAgentFiles } from "@/lib/agent-access-defaults";
import { useAgentAccessStore } from "@features/agent/store/agent-access-store";
import { useMemoStore } from "@features/memo/store/memo-store";
import type { ComposerFolderReference } from "./composer-folder-controller";

function comparablePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function fallbackFolderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized || path;
}

/** Read the folders configured for the notebook that owns the current note. */
export function getCurrentNotebookComposerFolders(): readonly ComposerFolderReference[] {
  const memoState = useMemoStore.getState();
  const notebook = memoState.selectedNotebook;
  if (!notebook) return [];

  const accessState = useAgentAccessStore.getState();
  const configured = resolveNotebookAgentFiles(
    accessState.config,
    accessState.notebookConfigs,
    notebook.id,
  );
  const entries = accessState.config.entries;
  const entryByPath = new Map(
    entries
      .filter((entry) => entry.kind === "folder")
      .map((entry) => [comparablePath(entry.path), entry]),
  );

  return (configured?.folders ?? []).map((path) => ({
    path,
    name: entryByPath.get(comparablePath(path))?.name || fallbackFolderName(path),
  }));
}
