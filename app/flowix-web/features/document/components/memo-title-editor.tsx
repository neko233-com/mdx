import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useI18n } from '@/lib/i18n';
import { useComposingValue } from '@shared/hooks/use-composing-value';
import { useMemoTitleSession } from './memo-title-session';

interface MemoTitleEditorProps {
  memoId: string;
  filename: string;
  editable: boolean;
  autoFocus?: boolean;
  /** Source mode uses DOM text selection so WebView does not paint the native textarea blue. */
  useDocumentSelection?: boolean;
  /** Rich-text mode may navigate across the boundary while read-only. */
  allowReadOnlyBoundaryNavigation?: boolean;
  onMoveToBody: (request: MemoTitleBodyNavigation) => void;
}

export interface MemoTitleBodyNavigation {
  trailingContent?: string;
  insertEmptyLine: boolean;
}

export interface MemoTitleEditorHandle {
  focusEnd: () => void;
  appendBodyLine: (title: string) => void;
}

export const MemoTitleEditor = forwardRef<MemoTitleEditorHandle, MemoTitleEditorProps>(function MemoTitleEditor({
  memoId,
  filename,
  editable,
  autoFocus = false,
  useDocumentSelection = false,
  allowReadOnlyBoundaryNavigation = false,
  onMoveToBody,
}: MemoTitleEditorProps, ref) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const documentTitleRef = useRef<HTMLDivElement>(null);
  const documentTitleComposingRef = useRef(false);
  const session = useMemoTitleSession(memoId, filename);
  const { snapshot } = session;
  const titleInput = useComposingValue(
    snapshot.draft,
    (value) => session.setDraft(value.replace(/[\r\n]+/g, ' ')),
  );

  const focusAt = useCallback((position: number) => {
    if (useDocumentSelection) {
      const element = documentTitleRef.current;
      if (!element) return;
      element.focus();
      const textNode = element.firstChild ?? element.appendChild(document.createTextNode(''));
      const caret = Math.max(0, Math.min(position, textNode.textContent?.length ?? 0));
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.setStart(textNode, caret);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    const caret = Math.max(0, Math.min(position, element.value.length));
    element.setSelectionRange(caret, caret);
  }, [useDocumentSelection]);

  const focusEnd = useCallback(() => {
    focusAt(useDocumentSelection
      ? (documentTitleRef.current?.textContent?.length ?? 0)
      : (textareaRef.current?.value.length ?? 0));
  }, [focusAt, useDocumentSelection]);

  const appendBodyLine = useCallback((title: string) => {
    const currentTitle = useDocumentSelection
      ? (documentTitleRef.current?.textContent ?? snapshot.draft)
      : (textareaRef.current?.value ?? snapshot.draft);
    const caretPosition = currentTitle.length;
    session.setDraft(`${currentTitle}${title}`);
    void session.commit().then(() => {
      requestAnimationFrame(() => focusAt(caretPosition));
    });
  }, [focusAt, session, snapshot.draft, useDocumentSelection]);

  useImperativeHandle(ref, () => ({
    focusEnd,
    appendBodyLine,
  }), [appendBodyLine, focusEnd]);

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (useDocumentSelection) return;
    resizeTextarea();
  }, [resizeTextarea, titleInput.value, useDocumentSelection]);

  useLayoutEffect(() => {
    if (!useDocumentSelection || documentTitleComposingRef.current) return;
    const element = documentTitleRef.current;
    if (element && element.textContent !== snapshot.draft) {
      element.textContent = snapshot.draft;
    }
  }, [snapshot.draft, useDocumentSelection]);

  useLayoutEffect(() => {
    if (useDocumentSelection) return;
    const element = textareaRef.current;
    const widthRoot = element?.parentElement;
    if (!element || !widthRoot) return;

    let frame: number | null = null;
    const scheduleResize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        resizeTextarea();
      });
    };

    // A narrower document column can wrap the same title onto additional
    // lines without changing the title draft. Observe the title shell so the
    // textarea is remeasured after the new width has been laid out.
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleResize);
    observer?.observe(widthRoot);
    window.addEventListener('resize', scheduleResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [resizeTextarea, useDocumentSelection]);

  useLayoutEffect(() => {
    if (!autoFocus || !editable) return;
    const element = useDocumentSelection ? documentTitleRef.current : textareaRef.current;
    if (!element) return;
    element.focus();
    if (useDocumentSelection) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      (element as HTMLTextAreaElement).select();
    }
  }, [autoFocus, editable, memoId, useDocumentSelection]);

  const getDocumentSelection = useCallback(() => {
    const element = documentTitleRef.current;
    const selection = window.getSelection();
    const value = element?.textContent ?? snapshot.draft;
    if (!element || !selection || selection.rangeCount === 0) {
      return { value, start: value.length, end: value.length };
    }
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      return { value, start: value.length, end: value.length };
    }
    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(element);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(element);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return {
      value,
      start: beforeStart.toString().length,
      end: beforeEnd.toString().length,
    };
  }, [snapshot.draft]);

  const handleDocumentTitleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (documentTitleComposingRef.current || titleInput.isComposingKeyboardEvent(event.nativeEvent)) return;
    const selection = getDocumentSelection();
    if (event.key === 'ArrowDown' && selection.start === selection.value.length && selection.end === selection.value.length) {
      if (!editable && !allowReadOnlyBoundaryNavigation) return;
      event.preventDefault();
      if (!editable) {
        onMoveToBody({ insertEmptyLine: false });
        return;
      }
      void session.commit().then(() => onMoveToBody({ insertEmptyLine: false }));
    } else if (!editable) {
      return;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const nextTitle = selection.value.slice(0, selection.start);
      const trailingContent = selection.value.slice(selection.end);
      session.setDraft(nextTitle);
      void session.commit().then(() => onMoveToBody({
        trailingContent,
        insertEmptyLine: true,
      }));
    } else if (event.key === 'Escape') {
      session.cancel();
      event.currentTarget.blur();
    }
  }, [allowReadOnlyBoundaryNavigation, editable, getDocumentSelection, onMoveToBody, session, titleInput]);

  return (
    <div className="memo-title-shell">
      {useDocumentSelection ? (
        <div
          ref={documentTitleRef}
          role="textbox"
          aria-label={t('memo.untitled')}
          aria-multiline="false"
          contentEditable={editable ? 'plaintext-only' : false}
          suppressContentEditableWarning
          data-placeholder={t('memo.untitled')}
          data-saving={snapshot.saving || undefined}
          className="memo-title-editor memo-title-editor--document-selection"
          onInput={(event) => {
            if (documentTitleComposingRef.current) return;
            session.setDraft((event.currentTarget.textContent ?? '').replace(/[\r\n]+/g, ' '));
          }}
          onCompositionStart={() => {
            documentTitleComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            documentTitleComposingRef.current = false;
            session.setDraft((event.currentTarget.textContent ?? '').replace(/[\r\n]+/g, ' '));
          }}
          onBlur={() => void session.commit()}
          onKeyDown={handleDocumentTitleKeyDown}
        />
      ) : (
      <textarea
        ref={textareaRef}
        rows={1}
        value={titleInput.value}
        readOnly={!editable}
        aria-label={t('memo.untitled')}
        placeholder={t('memo.untitled')}
        data-saving={snapshot.saving || undefined}
        className="memo-title-editor"
        onChange={titleInput.onChange}
        onCompositionStart={titleInput.onCompositionStart}
        onCompositionEnd={titleInput.onCompositionEnd}
        onBlur={() => void session.commit()}
        onKeyDown={(event) => {
          if (titleInput.isComposingKeyboardEvent(event.nativeEvent)) return;
          if (
            event.key === 'ArrowDown'
            && event.currentTarget.selectionStart === event.currentTarget.value.length
            && event.currentTarget.selectionEnd === event.currentTarget.value.length
          ) {
            if (!editable && !allowReadOnlyBoundaryNavigation) return;
            event.preventDefault();
            if (!editable) {
              onMoveToBody({ insertEmptyLine: false });
              return;
            }
            void session.commit().then(() => onMoveToBody({ insertEmptyLine: false }));
          } else if (!editable) {
            return;
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const value = event.currentTarget.value;
            const selectionStart = event.currentTarget.selectionStart ?? snapshot.draft.length;
            const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
            const nextTitle = value.slice(0, selectionStart);
            const trailingContent = value.slice(selectionEnd);
            session.setDraft(nextTitle);
            void session.commit().then(() => onMoveToBody({
              trailingContent,
              insertEmptyLine: true,
            }));
          } else if (event.key === 'Escape') {
            session.cancel();
            event.currentTarget.blur();
          }
        }}
      />
      )}
    </div>
  );
});
