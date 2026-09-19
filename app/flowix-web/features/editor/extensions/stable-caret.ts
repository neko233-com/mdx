import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const stableCaretKey = new PluginKey('stableCaret');
const ACTIVE_CLASS = 'has-stable-caret';

function elementAtPosition(view: EditorView, position: number): HTMLElement {
  const { node } = view.domAtPos(position, -1);
  if (node instanceof HTMLElement) return node;
  return node.parentElement ?? view.dom;
}

function caretHeightAt(view: EditorView, position: number): number {
  const element = elementAtPosition(view, position);
  const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
  const resolvedFontSize = Number.isFinite(fontSize) ? fontSize : 15;

  // Native carets expand to the line box in editable pre-wrap content. Keep
  // the visual caret tied to glyph size instead, independently of line-height.
  return Math.max(12, resolvedFontSize * 1.15);
}

class StableCaretView {
  private readonly caret = document.createElement('span');
  private frame: number | null = null;
  private lastGeometry: { left: number; top: number; height: number } | null = null;

  constructor(private readonly view: EditorView) {
    this.caret.className = 'stable-editor-caret';
    this.caret.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.caret);

    view.dom.addEventListener('focus', this.schedule, true);
    view.dom.addEventListener('blur', this.schedule, true);
    view.dom.addEventListener('compositionstart', this.handleCompositionStart);
    view.dom.addEventListener('compositionend', this.schedule);
    document.addEventListener('selectionchange', this.schedule);
    window.addEventListener('resize', this.schedule);
    window.addEventListener('scroll', this.schedule, true);
    this.schedule();
  }

  update(): void {
    this.schedule();
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.view.dom.classList.remove(ACTIVE_CLASS);
    this.view.dom.removeEventListener('focus', this.schedule, true);
    this.view.dom.removeEventListener('blur', this.schedule, true);
    this.view.dom.removeEventListener('compositionstart', this.handleCompositionStart);
    this.view.dom.removeEventListener('compositionend', this.schedule);
    document.removeEventListener('selectionchange', this.schedule);
    window.removeEventListener('resize', this.schedule);
    window.removeEventListener('scroll', this.schedule, true);
    this.caret.remove();
  }

  private readonly handleCompositionStart = (): void => {
    this.hide();
  };

  private readonly schedule = (): void => {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  };

  private render(): void {
    const { selection } = this.view.state;
    if (
      !this.view.editable
      || !this.view.hasFocus()
      || this.view.composing
      || !(selection instanceof TextSelection)
      || !selection.empty
    ) {
      this.hide();
      return;
    }

    try {
      const rect = this.view.coordsAtPos(selection.head);
      const scrollViewport = this.view.dom.closest('.editor-content');
      const viewportRect = scrollViewport instanceof HTMLElement
        ? scrollViewport.getBoundingClientRect()
        : this.view.dom.getBoundingClientRect();
      const isVisible = (
        rect.bottom >= viewportRect.top
        && rect.top <= viewportRect.bottom
        && rect.left >= viewportRect.left - 1
        && rect.left <= viewportRect.right + 1
      );
      if (!isVisible) {
        this.hide();
        return;
      }

      const height = caretHeightAt(this.view, selection.head);
      const lineHeight = Math.max(0, rect.bottom - rect.top);
      const top = rect.top + Math.max(0, (lineHeight - height) / 2);
      const geometry = { left: rect.left, top, height };
      const geometryChanged = (
        this.lastGeometry === null
        || Math.abs(this.lastGeometry.left - geometry.left) > 0.1
        || Math.abs(this.lastGeometry.top - geometry.top) > 0.1
        || Math.abs(this.lastGeometry.height - geometry.height) > 0.1
      );

      this.caret.style.left = `${rect.left}px`;
      this.caret.style.top = `${top}px`;
      this.caret.style.height = `${height}px`;
      this.caret.hidden = false;
      this.view.dom.classList.add(ACTIVE_CLASS);
      this.lastGeometry = geometry;

      if (geometryChanged) {
        this.caret.style.animation = 'none';
        void this.caret.offsetWidth;
        this.caret.style.animation = '';
      }
    } catch {
      this.hide();
    }
  }

  private hide(): void {
    this.caret.hidden = true;
    this.lastGeometry = null;
    this.view.dom.classList.remove(ACTIVE_CLASS);
  }
}

export const StableCaret = Extension.create({
  name: 'stableCaret',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: stableCaretKey,
        view: (view) => new StableCaretView(view),
      }),
    ];
  },
});
