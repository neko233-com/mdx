import { useCallback } from 'react';

import { toast } from '@/lib/toast';
import {
  markdownPaths as filterMarkdownPaths,
  useMarkdownFileDrop,
} from '@features/document/public/shell-api';
import { useI18n } from '@/lib/i18n';
import { errorMessage } from '@/lib/error-message';
import { createLogger } from '@/lib/logger';
import { FullscreenDragOverlay } from './fullscreen-drag-overlay';
import {
  FLOWIX_EXTERNAL_MARKDOWN_OPEN_EVENT,
  type ExternalMarkdownOpenRequest,
} from '@platform/open-target/types';

const logger = createLogger('markdown-file-drop-overlay');

export function MarkdownFileDropOverlay() {
  const { t } = useI18n();
  const openMarkdownPath = useCallback((paths: string[], destination?: 'main-third' | 'browser-column') => {
    window.dispatchEvent(new CustomEvent<ExternalMarkdownOpenRequest>(
      FLOWIX_EXTERNAL_MARKDOWN_OPEN_EVENT,
      { detail: { filePaths: paths, destination } },
    ));
  }, []);
  const handleDropError = useCallback((error: unknown) => {
    logger.warn('failed to open dropped Markdown', { error });
    toast.error(errorMessage(error));
  }, []);
  const handleDropPaths = useCallback(async (paths: string[], destination?: 'main-third' | 'browser-column') => {
    const markdownOnly = filterMarkdownPaths(paths);
    if (markdownOnly.length === 0) return;
    if (markdownOnly.length > 1) {
      toast.info(t('shell.dropOverlay.manyOpened', { count: markdownOnly.length }));
    }
    let previous: Promise<unknown> = Promise.resolve();
    previous = previous.then(() => openMarkdownPath(markdownOnly, destination));
    await previous;
  }, [openMarkdownPath, t]);
  const { isDraggingMarkdown } = useMarkdownFileDrop({
    onDropPaths: handleDropPaths,
    onDropError: handleDropError,
  });

  return <FullscreenDragOverlay visible={isDraggingMarkdown} />;
}
