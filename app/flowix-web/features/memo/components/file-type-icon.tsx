import type { Icon } from '@phosphor-icons/react';
import {
  FileCodeIcon,
  FileDocIcon,
  FileHtmlIcon,
  FileImageIcon,
  FileMdIcon,
  FilePdfIcon,
  FilePptIcon,
  FileTextIcon,
  FileVideoIcon,
  FileXlsIcon,
  FileZipIcon,
} from '@phosphor-icons/react';
import {
  fileExtension,
  isCodeTextFilePath,
  isImageFilePath,
  isMarkdownFilePath,
  isVideoFilePath,
} from '@features/editor/code-file';

const DOCUMENT_EXTENSIONS = new Set(['doc', 'docm', 'docx', 'dot', 'dotx', 'odt', 'rtf']);
const HTML_EXTENSIONS = new Set(['htm', 'html', 'xhtml']);
const PRESENTATION_EXTENSIONS = new Set(['key', 'odp', 'pot', 'potx', 'ppt', 'pptm', 'pptx']);
const ARCHIVE_EXTENSIONS = new Set([
  '7z', 'bz', 'bz2', 'cab', 'gz', 'iso', 'lz', 'lzma', 'rar', 'tar', 'tgz', 'xz', 'zip', 'zst',
]);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsb', 'xlsm', 'xlsx', 'xlt', 'xltx']);

/** Resolve the Phosphor file icon used by a file-tree row. */
export function getFileIcon(path: string): Icon {
  const extension = fileExtension(path);

  if (isMarkdownFilePath(path)) return FileMdIcon;
  if (HTML_EXTENSIONS.has(extension)) return FileHtmlIcon;
  if (DOCUMENT_EXTENSIONS.has(extension)) return FileDocIcon;
  if (PRESENTATION_EXTENSIONS.has(extension)) return FilePptIcon;
  if (SPREADSHEET_EXTENSIONS.has(extension)) return FileXlsIcon;
  if (extension === 'pdf') return FilePdfIcon;
  if (isVideoFilePath(path)) return FileVideoIcon;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileZipIcon;
  if (isImageFilePath(path)) return FileImageIcon;
  if (isCodeTextFilePath(path)) return FileCodeIcon;

  return FileTextIcon;
}

export function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const IconComponent = getFileIcon(path);
  return <IconComponent aria-hidden="true" className={className} />;
}
