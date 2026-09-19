import type { RefObject } from 'react';
import { useAppLanguage } from '@features/preferences/public/runtime-api';
import { translate } from '@/lib/i18n';

import {
  MemoTitleEditor,
  type MemoTitleBodyNavigation,
  type MemoTitleEditorHandle,
} from './memo-title-editor';
import type { ClipboardSnapshot } from '@features/editor/extensions/paste-rules/clipboard';
import type { DocumentEditorMode } from '@features/document/store/document-editor-view-store';

interface MemoDocumentHeaderProps {
  memoId: string;
  filename: string;
  updatedAt: Date | null;
  editable: boolean;
  autoFocus?: boolean;
  onMoveToBody: (request: MemoTitleBodyNavigation) => void;
  onPasteToBody?: (snapshot: ClipboardSnapshot) => void;
  editorMode?: DocumentEditorMode;
  onToggleEditorMode?: () => void;
  titleRef?: RefObject<MemoTitleEditorHandle | null>;
}

function formatDocumentDateTime(date: Date, language: 'zh-CN' | 'en-US'): string {
  if (language === 'en-US') {
    const datePart = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    return `${datePart} ${timePart}`;
  }

  return translate(language, 'editor.dateTime.fullFormat', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours().toString().padStart(2, '0'),
    minute: date.getMinutes().toString().padStart(2, '0'),
  });
}

export function MemoDocumentHeader({
  memoId,
  filename,
  updatedAt,
  editable,
  autoFocus = false,
  onMoveToBody,
  onPasteToBody,
  editorMode,
  onToggleEditorMode,
  titleRef,
}: MemoDocumentHeaderProps) {
  const language = useAppLanguage();

  return (
    <div className="memo-document-header">
      {updatedAt && (
        <div className="memo-date-line">
          {formatDocumentDateTime(updatedAt, language)}
        </div>
      )}
      <MemoTitleEditor
        ref={titleRef}
        memoId={memoId}
        filename={filename}
        editable={editable}
        autoFocus={autoFocus}
        allowReadOnlyBoundaryNavigation
        onMoveToBody={onMoveToBody}
        onPasteToBody={onPasteToBody}
        editorMode={editorMode}
        onToggleEditorMode={onToggleEditorMode}
      />
    </div>
  );
}
