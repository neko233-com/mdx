'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { basicSetup } from 'codemirror';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tagHighlighter, tags } from '@lezer/highlight';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import {
  closeSearchPanel,
  openSearchPanel,
  searchPanelOpen,
} from '@codemirror/search';

import { cn } from '@/lib/utils';

import { isMarkdownFilePath } from '@features/editor/code-file';
import { shikiHighlighting, shikiLanguageIdForPath } from '@features/editor/code-editor-shiki';
import { pushHandler, useShortcutScope } from '@features/shortcuts';

export interface CodeEditorHandle {
  flushPendingChanges: () => string | null;
  focusStart?: () => void;
  moveTitleToBody?: (trailingContent: string) => void;
}

interface CodeEditorProps {
  filePath: string;
  content: string;
  editable?: boolean;
  onChange: (content: string) => void;
  className?: string;
  autoFocus?: boolean;
  searchPanelOpen?: boolean;
  onSearchPanelOpenChange?: (open: boolean) => void;
  onEditorScroll?: (scrollTop: number) => void;
  onEditingFinished?: () => void;
  /** React content mounted inside CodeMirror's actual scroll surface. */
  scrollHeader?: ReactNode;
}

function getSourceBodyStart(content: string): number {
  const frontmatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return frontmatter?.[0].length ?? 0;
}

type SourceHeaderMountHandler = (dom: HTMLDivElement, mounted: boolean) => void;

/**
 * The source title is a CodeMirror block widget instead of a sibling of
 * `.cm-content`. This keeps its height in CodeMirror's height map, which is
 * required for virtual viewport updates and scroll anchoring to remain valid.
 */
class SourceHeaderWidget extends WidgetType {
  constructor(private readonly onMount: SourceHeaderMountHandler) {
    super();
  }

  eq(other: SourceHeaderWidget): boolean {
    return other.onMount === this.onMount;
  }

  toDOM(): HTMLDivElement {
    const dom = document.createElement('div');
    dom.className = 'cm-source-header';
    this.onMount(dom, true);
    return dom;
  }

  destroy(dom: HTMLElement): void {
    if (dom instanceof HTMLDivElement) this.onMount(dom, false);
  }

  ignoreEvent(): boolean {
    return true;
  }

  // This is only used before the widget has been measured. The ResizeObserver
  // below replaces it with the exact height once the title is in the DOM.
  get estimatedHeight(): number {
    return 54;
  }
}

const setSourceHeaderDecoration = StateEffect.define<DecorationSet>();

const sourceHeaderField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSourceHeaderDecoration)) return effect.value;
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function sourceHeaderDecoration(onMount: SourceHeaderMountHandler): DecorationSet {
  const widget = new SourceHeaderWidget(onMount);
  return Decoration.set([
    Decoration.widget({ widget, side: -1, block: true }).range(0),
  ]);
}

const codeEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--document-foreground, var(--foreground, #1f2937))',
    backgroundColor: 'transparent',
    fontSize: 'var(--code-editor-font-size, 13px)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    lineHeight: 'var(--code-editor-line-height, 1.65)',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: 'var(--code-editor-content-padding-top, 14px) 0 var(--code-editor-content-padding-bottom, 28px)',
    // Keep the document text color on the actual content layer. Relying on
    // inheritance from `.cm-editor` makes text disappear in WebKit when a
    // theme variable is unavailable during the production-app startup.
    color: 'var(--document-foreground, var(--foreground, #1f2937))',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': {
    padding: '0 var(--code-editor-line-padding-right, 20px) 0 var(--code-editor-line-padding-left, 10px)',
    color: 'var(--document-foreground, var(--foreground, #1f2937))',
  },
  '.cm-gutters': {
    border: 'none',
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--document-bg)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'color-mix(in oklch, var(--muted-foreground) 40%, transparent)',
  },
  '.cm-foldGutter .cm-gutterElement > span': {
    opacity: 0,
    transition: 'opacity 120ms ease',
  },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement > span': {
    opacity: 0.5,
  },
  '.cm-foldGutter .cm-gutterElement > span[title="Fold line"]': {
    display: 'inline-block',
    position: 'relative',
    top: '-3px',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 58%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--brand, var(--primary)) 26%, transparent)',
    color: 'inherit',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--brand, var(--primary)) 26%, transparent)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '.cm-panels': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--card)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border)',
  },
  '.cm-search': {
    padding: '6px 10px',
  },
  '.cm-textfield': {
    height: '26px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
  },
  '.cm-button': {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--foreground)',
    backgroundImage: 'none',
    backgroundColor: 'var(--muted)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
    backgroundColor: 'var(--popover)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--muted)',
  },
});

// Fixed class names keep syntax colors in the compiled application CSS.
// HighlightStyle.define() emits a runtime <style> sheet with generated class
// names, which can be absent during packaged WebView startup.
const codeHighlighter = tagHighlighter([
  { tag: tags.comment, class: 'cm-code-comment' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: 'cm-code-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-code-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'cm-code-constant' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'cm-code-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'cm-code-type' },
  { tag: [tags.regexp, tags.escape], class: 'cm-code-regexp' },
  { tag: tags.invalid, class: 'cm-code-invalid' },
]);

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  filePath,
  content,
  editable = true,
  onChange,
  className,
  autoFocus = false,
  searchPanelOpen: controlledSearchPanelOpen = false,
  onSearchPanelOpenChange,
  onEditorScroll,
  onEditingFinished,
  scrollHeader,
}, ref) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [scrollHeaderMount, setScrollHeaderMount] = useState<HTMLDivElement | null>(null);
  const syncingContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onSearchPanelOpenChangeRef = useRef(onSearchPanelOpenChange);
  const onEditorScrollRef = useRef(onEditorScroll);
  const onEditingFinishedRef = useRef(onEditingFinished);
  const languageCompartment = useMemo(() => new Compartment(), []);
  const editableCompartment = useMemo(() => new Compartment(), []);
  const hasScrollHeader = Boolean(scrollHeader);
  const handleSourceHeaderMount = useCallback<SourceHeaderMountHandler>((dom, mounted) => {
    if (mounted) {
      setScrollHeaderMount(dom);
    } else {
      setScrollHeaderMount((current) => current === dom ? null : current);
    }
  }, []);

  onChangeRef.current = onChange;
  onSearchPanelOpenChangeRef.current = onSearchPanelOpenChange;
  onEditorScrollRef.current = onEditorScroll;
  onEditingFinishedRef.current = onEditingFinished;

  useShortcutScope('editor');

  useImperativeHandle(ref, () => ({
    flushPendingChanges: () => {
      const content = viewRef.current?.state.doc.toString() ?? null;
      return content;
    },
    focusStart: () => {
      const view = viewRef.current;
      if (!view) return;
      const bodyStart = getSourceBodyStart(view.state.doc.toString());
      view.focus();
      view.dispatch({
        selection: { anchor: bodyStart, head: bodyStart },
        effects: EditorView.scrollIntoView(bodyStart, { y: 'nearest' }),
      });
    },
    moveTitleToBody: (trailingContent: string) => {
      const view = viewRef.current;
      if (!view || !editable) return;

      const content = view.state.doc.toString();
      const bodyStart = getSourceBodyStart(content);
      const lineBreak = content.includes('\r\n') ? '\r\n' : '\n';
      const insertion = trailingContent.length > 0
        ? `${trailingContent}${lineBreak}${lineBreak}`
        : lineBreak;

      view.dispatch({
        changes: { from: bodyStart, to: bodyStart, insert: insertion },
        // Keep the caret at the split point, before the title tail that was
        // moved into the first body paragraph.
        selection: { anchor: bodyStart, head: bodyStart },
        effects: EditorView.scrollIntoView(bodyStart, { y: 'nearest' }),
      });
      view.focus();
    },
  }), [editable]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let lastSearchPanelOpen = false;
    // Files whose extension maps to a preloaded Shiki language are colored by
    // the shared Shiki highlighter (see code-editor-shiki.ts) instead of the
    // Lezer tagHighlighter path. Anything else falls back to the 8-class
    // tagHighlighter. The Lezer language is still loaded below for structure
    // (folding / indentation / bracket matching).
    const shikiLang = shikiLanguageIdForPath(filePath);
    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        codeEditorTheme,
        sourceHeaderField,
        ...(shikiLang
          ? [shikiHighlighting(shikiLang)]
          : [syntaxHighlighting(codeHighlighter)]),
        EditorView.lineWrapping,
        languageCompartment.of([]),
        editableCompartment.of([
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
        ]),
        EditorView.contentAttributes.of({
          'aria-label': filePath.split(/[\\/]/).pop() ?? filePath,
          spellcheck: 'false',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingContentRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
          const nextSearchPanelOpen = searchPanelOpen(update.state);
          if (nextSearchPanelOpen !== lastSearchPanelOpen) {
            lastSearchPanelOpen = nextSearchPanelOpen;
            onSearchPanelOpenChangeRef.current?.(nextSearchPanelOpen);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;

    const handleScroll = () => onEditorScrollRef.current?.(view.scrollDOM.scrollTop);
    const handleBlur = () => onEditingFinishedRef.current?.();
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    view.contentDOM.addEventListener('blur', handleBlur);

    if (autoFocus) requestAnimationFrame(() => view.focus());

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.contentDOM.removeEventListener('blur', handleBlur);
      view.destroy();
      viewRef.current = null;
      setScrollHeaderMount(null);
    };
  }, [autoFocus, editableCompartment, filePath, handleSourceHeaderMount, languageCompartment]);

  // Install or remove the title as a CodeMirror-managed block widget. This is
  // a separate effect so changing the header does not recreate the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: setSourceHeaderDecoration.of(
        hasScrollHeader ? sourceHeaderDecoration(handleSourceHeaderMount) : Decoration.none,
      ),
    });
  }, [handleSourceHeaderMount, hasScrollHeader]);

  useEffect(() => {
    const editorIsFocused = () => viewRef.current?.hasFocus ?? false;
    return pushHandler('editor.selectAll', () => {
      const view = viewRef.current;
      if (!view || !view.hasFocus) return false;
      view.dispatch({
        selection: { anchor: 0, head: view.state.doc.length },
      });
      return true;
    }, { isActive: editorIsFocused });
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(editable),
      ]),
    });
  }, [editable, editableCompartment]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const headerMount = scrollHeaderMount;
    if (!view || !headerMount || !hasScrollHeader) return;

    view.requestMeasure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(headerMount);
    return () => observer.disconnect();
  }, [hasScrollHeader, scrollHeaderMount]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    syncingContentRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    } finally {
      syncingContentRef.current = false;
    }
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const isOpen = searchPanelOpen(view.state);
    if (controlledSearchPanelOpen && !isOpen) openSearchPanel(view);
    if (!controlledSearchPanelOpen && isOpen) closeSearchPanel(view);
  }, [controlledSearchPanelOpen]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Markdown is rendered by Shiki and does not need a Lezer language loaded.
    if (isMarkdownFilePath(filePath)) return;
    let disposed = false;
    const description = LanguageDescription.matchFilename(languages, filePath);
    if (!description) return;
    void description.load().then((support) => {
      if (disposed || viewRef.current !== view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(support) });
    }).catch((error: unknown) => {
      if (disposed) return;
      console.error('[CodeEditor] Failed to load language support', {
        filePath,
        language: description.name,
        error,
      });
    });
    return () => {
      disposed = true;
    };
  }, [filePath, languageCompartment]);

  return (
    <>
      <div
        ref={mountRef}
        className={cn(
          'code-editor h-full w-full min-h-0 min-w-0 overflow-hidden',
          hasScrollHeader && 'code-editor--with-scroll-header',
          className,
        )}
      />
      {hasScrollHeader && scrollHeaderMount && createPortal(scrollHeader, scrollHeaderMount)}
    </>
  );
});
