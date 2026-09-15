import { recoveryDrafts } from '@platform/tauri/client/recovery';
import { documentIdentityKey, type DocumentIdentity } from './document-identity';

const recoveryOperations = new Map<string, Promise<unknown>>();
const RECOVERY_READ_TIMEOUT_MS = 2_000;

function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function enqueueRecoveryOperation<T>(identity: DocumentIdentity, operation: () => Promise<T>): Promise<T> {
  const key = documentIdentityKey(identity);
  const previous = recoveryOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  recoveryOperations.set(key, current);
  const cleanup = () => {
    if (recoveryOperations.get(key) === current) recoveryOperations.delete(key);
  };
  void current.then(cleanup, cleanup);
  return current;
}

export interface RecoveryDraft {
  schemaVersion: 1;
  identity: DocumentIdentity;
  originalPath: string;
  revision: number;
  content: string;
  baseContent: string;
  createdAt: number;
  updatedAt: number;
  reason: 'autosave' | 'save-timeout' | 'save-error' | 'shutdown';
}

export async function persistRecoveryDraft(
  input: Omit<RecoveryDraft, 'schemaVersion' | 'createdAt' | 'updatedAt'>,
): Promise<boolean> {
  return enqueueRecoveryOperation(input.identity, async () => {
    const now = Date.now();
    const previous = await recoveryDrafts.read<RecoveryDraft>(documentIdentityKey(input.identity));
    return recoveryDrafts.write(documentIdentityKey(input.identity), {
      ...input,
      schemaVersion: 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }).catch(() => false);
}

export function readRecoveryDraft(identity: DocumentIdentity): Promise<RecoveryDraft | null> {
  return settleWithin(enqueueRecoveryOperation(identity, () => (
    recoveryDrafts.read<RecoveryDraft>(documentIdentityKey(identity))
  )), RECOVERY_READ_TIMEOUT_MS, null);
}

export async function clearRecoveryDraftThrough(
  identity: DocumentIdentity,
  savedRevision: number,
): Promise<void> {
  await enqueueRecoveryOperation(identity, async () => {
    await recoveryDrafts.clearThrough(documentIdentityKey(identity), savedRevision);
  }).catch(() => undefined);
}

export function listRecoveryDrafts(): Promise<RecoveryDraft[]> {
  return settleWithin(recoveryDrafts.list<RecoveryDraft>(), RECOVERY_READ_TIMEOUT_MS, []);
}
