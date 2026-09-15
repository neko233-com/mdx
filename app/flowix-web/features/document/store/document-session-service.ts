import {
  applyLoadedContent,
  discardUnsavedLocalChanges,
  flushDocument,
  getBuffer,
  getCurrentIdentity,
  getCurrentPath,
  getOrCreateBuffer,
  hasUnsavedLocalChanges,
  notifyDocumentBufferChanged,
  rebaseCurrentDocumentPath,
  setCurrentDocument,
  type FlushCallbacks,
} from '@features/document/store/buffer-registry';
import { isDocumentContentEqual } from '@features/document/store/buffer-equality';
import type { DocumentBuffer } from '@features/document/store/document-buffer';
import {
  documentIdentityKey,
  type DocumentIdentity,
} from '@features/document/store/document-identity';
import { canonicalPath } from '@/lib/path';
import { persistRecoveryDraft } from '@features/document/store/recovery-draft-store';

const RECOVERY_DRAFT_WRITE_TIMEOUT_MS = 3_000;

type DocumentCapture = () => string | null;
interface RegisteredDocumentCapture {
  hostId?: string;
  capture: DocumentCapture;
}
const documentCaptures = new Map<string, Set<RegisteredDocumentCapture>>();

/** Register a mounted editor capable of publishing its latest content. */
export function registerDocumentCapture(
  identity: DocumentIdentity,
  capture: DocumentCapture,
  hostId?: string,
): () => void {
  const key = documentIdentityKey(identity);
  const registration = { hostId, capture } satisfies RegisteredDocumentCapture;
  const captures = documentCaptures.get(key) ?? new Set<RegisteredDocumentCapture>();
  captures.add(registration);
  documentCaptures.set(key, captures);
  return () => {
    captures.delete(registration);
    if (captures.size === 0) documentCaptures.delete(key);
  };
}

/** Publish all mounted surfaces before the save barrier reads the buffer. */
export function captureLatestDocumentContent(identity: DocumentIdentity, hostId?: string): void {
  const captures = documentCaptures.get(documentIdentityKey(identity));
  if (!captures) return;
  for (const registration of [...captures]) {
    if (hostId !== undefined && registration.hostId !== hostId) continue;
    registration.capture();
  }
}

export async function protectDocumentDraft(
  identity: DocumentIdentity,
  path: string,
  reason: 'autosave' | 'save-timeout' | 'save-error' | 'shutdown',
): Promise<boolean> {
  const buffer = getOrCreateBuffer(identity);
  if (!hasUnsavedLocalChanges(identity)) return true;
  const protectedByDraft = await waitWithTimeout(persistRecoveryDraft({
    identity,
    originalPath: canonicalPath(path),
    revision: buffer.capturedRevision,
    content: buffer.content,
    baseContent: buffer.lastSavedContent,
    reason,
  }), RECOVERY_DRAFT_WRITE_TIMEOUT_MS);
  if (protectedByDraft !== true) return false;
  buffer.durableRevision = Math.max(buffer.durableRevision, buffer.capturedRevision);
  if (buffer.savedRevision < buffer.capturedRevision) buffer.saveState = 'protected';
  notifyDocumentBufferChanged(identity, 'save_settled');
  return true;
}

export function applyRecoveryDraftContent(
  identity: DocumentIdentity,
  content: string,
  revision: number,
): DocumentBuffer {
  const buffer = getOrCreateBuffer(identity);
  buffer.content = content;
  buffer.pendingContent = content;
  buffer.editRevision = Math.max(buffer.editRevision, revision);
  buffer.capturedRevision = Math.max(buffer.capturedRevision, revision);
  buffer.durableRevision = Math.max(buffer.durableRevision, revision);
  buffer.pendingRevision = buffer.capturedRevision;
  buffer.saveState = 'protected';
  notifyDocumentBufferChanged(identity, 'loaded');
  return buffer;
}

function waitWithTimeout(promise: Promise<boolean>, timeoutMs: number): Promise<boolean | 'timeout'> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve('timeout'), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(false);
      },
    );
  });
}


interface DocumentDraftSnapshot {
  identity: DocumentIdentity;
  path: string;
  content: string;
}

interface DocumentEditResult {
  changed: boolean;
  buffer: DocumentBuffer;
}

interface StagedDocumentSnapshot {
  path: string;
  content: string;
}

const stagedDocumentSnapshots = new Map<string, StagedDocumentSnapshot>();

/** One-shot authoritative content returned together with memo metadata. */
export function stageDocumentSnapshot(
  identity: DocumentIdentity,
  path: string,
  content: string,
): void {
  stagedDocumentSnapshots.set(documentIdentityKey(identity), {
    path: canonicalPath(path),
    content,
  });
}

export function consumeStagedDocumentSnapshot(
  identity: DocumentIdentity,
  path: string,
): string | null {
  const key = documentIdentityKey(identity);
  const snapshot = stagedDocumentSnapshots.get(key);
  if (!snapshot || snapshot.path !== canonicalPath(path)) return null;
  stagedDocumentSnapshots.delete(key);
  return snapshot.content;
}

interface SaveDocumentContentOptions {
  path: string;
  identity: DocumentIdentity;
  content: string;
  /**
   * `internal` (内部 memo 文档) 或 `external` (外部文本文件)。后端
   * 据此分流: 内部走 key 反查 + 派生改名 + memo index 同步, 外部只
   * 做 fs::write + CAS, 不改名不动 memo index。
   */
  channel: 'internal' | 'external';
  /**
   * 内部 memo 文档的 memoId ── closure 期间稳定, 后端用它反查 memo index
   * 拿当前 entry.filename, 走新路径写。外部文件可传 null。
   */
  key: string | null;
  /** Authorized file-tree root for external code/text documents. */
  scopePath?: string | null;
  force?: boolean;
  callbacks?: FlushCallbacks;
}

const selfPathUpdates = new Set<string>();

function selfPathUpdateKey(memoId: string, path: string): string {
  return `${memoId}:${canonicalPath(path)}`;
}

export function markSelfDocumentPathUpdate(memoId: string, path: string): void {
  selfPathUpdates.add(selfPathUpdateKey(memoId, path));
}

export function consumeSelfDocumentPathUpdate(memoId: string, path: string): boolean {
  const key = selfPathUpdateKey(memoId, path);
  const exists = selfPathUpdates.has(key);
  if (exists) {
    selfPathUpdates.delete(key);
  }
  return exists;
}

export function getActiveDocumentDraft(): DocumentDraftSnapshot | null {
  const identity = getCurrentIdentity();
  const path = getCurrentPath();
  return identity && path ? getDocumentDraft(identity, path) : null;
}

export function getDocumentDraft(
  identity: DocumentIdentity,
  path: string,
): DocumentDraftSnapshot | null {
  const buffer = getBuffer(identity);
  if (!path || !buffer || buffer.content == null) return null;
  return { identity, path, content: buffer.content };
}

/**
 * 记录用户敲字产生的编辑。
 *
 * 行为不变量 ── 在双 Map 索引 (memoId / canonicalPath) 下, 物理 rename
 * 期间 memo 路径对应的 buffer 不会被换出, recordDocumentEdit 内部
 * 永远命中同一个 buffer object。race 自然消失, 不再需要 P1 修复 (O)
 * 那 3 层防御兜底。
 *
 * dirty 判定改用语义比较 ── 详见 [buffer-equality.ts]。原 byte equality
 * 在 Windows 上会被 Tiptap mount 阶段把磁盘 CRLF 重写为 LF 的"伪编辑"误
 * 判为真实编辑, 1s 后触发 write_document → 后端 emit `user_edit` →
 * 出现"打开即写盘"的现象。语义比较抹掉行尾 / frontmatter / trailing
 * 空白等归一化差异, 只把"实质不同的内容" 标 dirty。
 */
export function recordDocumentEdit(identity: DocumentIdentity, content: string): DocumentEditResult {
  const buffer = getOrCreateBuffer(identity);
  if (content === buffer.content) {
    return { changed: !isDocumentContentEqual(identity, content, buffer.lastSavedContent), buffer };
  }
  buffer.editRevision += 1;
  buffer.capturedRevision = buffer.editRevision;
  if (isDocumentContentEqual(identity, content, buffer.lastSavedContent)) {
    buffer.content = content;
    buffer.pendingContent = null;
    buffer.pendingRevision = null;
    buffer.savedRevision = buffer.capturedRevision;
    buffer.durableRevision = buffer.capturedRevision;
    buffer.saveState = 'clean';
    notifyDocumentBufferChanged(identity, 'edited');
    return { changed: false, buffer };
  }
  buffer.content = content;
  buffer.pendingContent = content;
  buffer.pendingRevision = buffer.capturedRevision;
  buffer.saveState = 'dirty';
  notifyDocumentBufferChanged(identity, 'edited');
  return { changed: true, buffer };
}

/**
 * 把 content 写盘。
 *
 * 跟 recordDocumentEdit 同形 ── buffer key 在双索引下永不漂移, 直接
 * getOrCreateBuffer 拿到当前 memo 对应的 buffer 即可。
 */
export async function saveDocumentContent({
  path,
  identity,
  content,
  channel,
  key,
  scopePath,
  force,
  callbacks,
}: SaveDocumentContentOptions): Promise<boolean> {
  if (!path) return true;
  const buffer = getOrCreateBuffer(identity);

  if (content !== buffer.content) {
    recordDocumentEdit(identity, content);
  }

  return flushDocument(identity, path, { key, channel, scopePath, force, ...callbacks });
}

export function flushDocumentPath(
  identity: DocumentIdentity,
  path: string,
  scopePath: string | null = null,
): Promise<boolean> {
  return prepareDocumentLeave(identity, path, scopePath);
}

/**
 * Capture the outgoing editor and make its latest revision durable without
 * putting canonical disk/index latency on the navigation critical path.
 * Canonical saves continue in the background; a small recovery draft is the
 * only bounded, non-destructive navigation barrier.
 */
export async function prepareDocumentLeave(
  identity: DocumentIdentity,
  path: string,
  scopePath: string | null = null,
): Promise<boolean> {
  captureLatestDocumentContent(identity);
  const buffer = getOrCreateBuffer(identity);
  if (!hasUnsavedLocalChanges(identity)) return true;

  const revision = buffer.capturedRevision;
  const content = buffer.content;
  const baseContent = buffer.lastSavedContent;
  const save = flushDocument(identity, path, { scopePath });
  if (buffer.durableRevision >= revision) {
    // The revision is already recoverable. Keep the canonical write alive,
    // but do not make navigation wait for it again.
    void save;
    return true;
  }

  // Preserve the exact captured snapshot immediately. Waiting for the full
  // memo write here can include filesystem, index and watcher latency and used
  // to freeze every document switch for up to five seconds.
  const protectedByDraft = await waitWithTimeout(persistRecoveryDraft({
    identity,
    originalPath: canonicalPath(path),
    revision,
    content,
    baseContent,
    reason: 'autosave',
  }), RECOVERY_DRAFT_WRITE_TIMEOUT_MS);
  if (protectedByDraft !== true) return false;

  // The canonical save may have won the race while the draft was being
  // persisted. Do not regress an already-clean buffer back to `protected`.
  if (buffer.savedRevision >= revision) return true;

  buffer.durableRevision = Math.max(buffer.durableRevision, revision);
  buffer.saveState = 'protected';
  notifyDocumentBufferChanged(identity, 'save_settled');
  return true;
}

export function getDocumentBuffer(identity: DocumentIdentity): DocumentBuffer {
  return getOrCreateBuffer(identity);
}

export function hasDocumentUnsavedChanges(identity?: DocumentIdentity): boolean {
  return hasUnsavedLocalChanges(identity);
}

export function discardDocumentDraft(identity: DocumentIdentity): void {
  discardUnsavedLocalChanges(identity);
}

export function applyLoadedDocumentContent(
  identity: DocumentIdentity,
  path: string,
  fullContent: string,
  options?: { preservePending?: boolean; setAsCurrent?: boolean },
): DocumentBuffer {
  return applyLoadedContent(identity, path, fullContent, options);
}

export function setActiveDocumentPath(identity: DocumentIdentity | null, path: string | null): void {
  setCurrentDocument(identity, path);
}

export function rebaseActiveDocumentPath(identity: DocumentIdentity, path: string): void {
  rebaseCurrentDocumentPath(identity, path);
}
