import type { Editor } from '@tiptap/core';
import type { Fragment, Node as ProseMirrorNode } from '@tiptap/pm/model';

const PRINT_ROOT_ID = 'flowix-pdf-print-root';
const PRINTING_CLASS = 'flowix-pdf-exporting';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Agent thread cards are persisted as a directive, not regular Markdown:
 * `::agent-thread-card{...}`. Remove only standalone directives outside fenced
 * code blocks, so an example of the directive in a code sample remains intact.
 */
export function stripAgentThreadCards(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  let fenced = false;
  let fenceMarker = '';

  return lines.filter((line) => {
    if (/^\s*(?:```+|~~~+)/.test(line)) {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? '';
      if (!fenced) {
        fenced = true;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        fenced = false;
        fenceMarker = '';
      }
      return true;
    }

    if (!fenced && /^\s{0,3}::agent-thread-card\{[^}\r\n]*\}[ \t]*(?:\r?\n)?$/.test(line)) {
      return false;
    }

    return true;
  }).join('');
}

const NON_PRINTABLE_NODE_TYPES = new Set(['frontmatter', 'agentThreadCard']);

function isEmptyParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0;
}

function filterPrintableNode(
  node: ProseMirrorNode,
  FragmentConstructor: typeof Fragment,
): ProseMirrorNode | null {
  if (NON_PRINTABLE_NODE_TYPES.has(node.type.name)) return null;
  if (!node.content.size) return node;

  const children: ProseMirrorNode[] = [];
  let removeFollowingEmptyParagraph = false;
  node.content.forEach((child) => {
    const printable = filterPrintableNode(child, FragmentConstructor);
    if (!printable) {
      removeFollowingEmptyParagraph = child.type.name === 'agentThreadCard';
      return;
    }
    if (removeFollowingEmptyParagraph && isEmptyParagraph(printable)) {
      removeFollowingEmptyParagraph = false;
      return;
    }
    removeFollowingEmptyParagraph = false;
    children.push(printable);
  });

  return node.copy(FragmentConstructor.from(children));
}

async function waitForPrintResources(root: HTMLElement): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();

    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

/**
 * Mount a clean Markdown print view in the current WebView.
 *
 * The editor DOM is intentionally not reused here. It contains application
 * chrome, editor-only dates and interactive Agent thread-card NodeViews. PDF
 * output should be a stable document representation of the saved Markdown.
 */
export async function preparePdfPrint(
  editor: Editor | null,
  markdown: string,
): Promise<() => void> {
  document.getElementById(PRINT_ROOT_ID)?.remove();

  const root = document.createElement('main');
  root.id = PRINT_ROOT_ID;
  root.className = 'flowix-pdf-print-root';

  if (editor && !editor.isDestroyed) {
    const { DOMSerializer, Fragment } = await import('@tiptap/pm/model');
    const printableDocument = filterPrintableNode(editor.state.doc, Fragment);
    if (printableDocument) {
      const serializer = DOMSerializer.fromSchema(editor.schema);
      root.appendChild(serializer.serializeFragment(printableDocument.content));
    }
  } else {
    // Source-mode documents and external text files do not have a Tiptap
    // instance. Keep them exportable with the same Markdown fallback.
    const printableMarkdown = stripAgentThreadCards(markdown);
    const { markdownToHtml } = await import('@/lib/export');
    root.innerHTML = markdownToHtml(printableMarkdown);
  }
  document.body.appendChild(root);
  document.documentElement.classList.add(PRINTING_CLASS);
  try {
    await nextFrame();
    await waitForPrintResources(root);
  } catch (error) {
    document.documentElement.classList.remove(PRINTING_CLASS);
    root.remove();
    throw error;
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    document.documentElement.classList.remove(PRINTING_CLASS);
    root.remove();
  };
}
