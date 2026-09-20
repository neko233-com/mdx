import { afterEach, describe, expect, it } from 'vitest';

import {
  documentEditorViewKey,
  getDocumentEditorMode,
  setDocumentEditorMode,
  useDocumentEditorViewStore,
} from './document-editor-view-store';

const memoIdentity = { kind: 'memo' as const, id: 'memo-1' };

describe('document editor view store', () => {
  afterEach(() => {
    useDocumentEditorViewStore.getState().reset();
  });

  it('defaults every document host to rich mode', () => {
    expect(getDocumentEditorMode('main-third', memoIdentity)).toBe('rich');
  });

  it('keeps modes isolated by host and document identity', () => {
    setDocumentEditorMode('main-third', memoIdentity, 'source');

    expect(getDocumentEditorMode('main-third', memoIdentity)).toBe('source');
    expect(getDocumentEditorMode('browser-column', memoIdentity)).toBe('rich');
    expect(getDocumentEditorMode('main-third', { kind: 'memo', id: 'memo-2' })).toBe('rich');
  });

  it('uses stable keys for equivalent identity objects', () => {
    expect(documentEditorViewKey('main-third', memoIdentity)).toBe('main-third:memo:memo-1');
    expect(documentEditorViewKey('main-third', { kind: 'memo', id: 'memo-1' })).toBe(
      documentEditorViewKey('main-third', memoIdentity),
    );
  });
});
