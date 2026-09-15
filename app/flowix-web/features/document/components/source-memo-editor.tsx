import { forwardRef } from 'react';
import type { ComponentProps, RefObject } from 'react';

import type { CodeEditorHandle } from '@features/editor/code-editor';
import { LazyCodeEditor } from '@features/document/components/lazy-code-editor';
import type {
  MemoTitleBodyNavigation,
  MemoTitleEditorHandle,
} from './memo-title-editor';
import { SourceMemoTitleRow } from './source-memo-title-row';

type SourceCodeEditorProps = Omit<ComponentProps<typeof LazyCodeEditor>, 'scrollHeader'>;

interface SourceMemoEditorProps extends SourceCodeEditorProps {
  memoId: string;
  filename: string;
  titleAutoFocus?: boolean;
  onMoveToBody: (request: MemoTitleBodyNavigation) => void;
  titleRef?: RefObject<MemoTitleEditorHandle | null>;
}

/**
 * Memo source surface: the title is supplied as a CodeMirror-managed block
 * widget, while CodeMirror remains the only owner of the document buffer and
 * scroll geometry.
 */
export const SourceMemoEditor = forwardRef<CodeEditorHandle, SourceMemoEditorProps>(
  function SourceMemoEditor({
    memoId,
    filename,
    titleAutoFocus = false,
    onMoveToBody,
    titleRef,
    ...codeEditorProps
  }, ref) {
    return (
      <LazyCodeEditor
        {...codeEditorProps}
        ref={ref}
        scrollHeader={(
          <SourceMemoTitleRow
            memoId={memoId}
            filename={filename}
            editable={codeEditorProps.editable ?? true}
            autoFocus={titleAutoFocus}
            onMoveToBody={onMoveToBody}
            titleRef={titleRef}
          />
        )}
      />
    );
  },
);
