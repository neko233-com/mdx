import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { createElement as createReactElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { translate, type I18nKey } from '@/lib/i18n';
import { MEMO_COLORS, MEMO_COLOR_HEX } from '@features/memo';
import type { MemoColor } from '@/types/memo-item';
import {
  deleteVisibleFrontmatterProperty,
  FrontmatterPropertyError,
  formatFrontmatterPropertyValue,
  isFrontmatterPropertyFlowSequence,
  moveVisibleFrontmatterProperty,
  parseVisibleFrontmatter,
  toFrontmatterPropertyInput,
  updateVisibleFrontmatterProperty,
} from '@features/document/properties/frontmatter-model';
import {
  PROPERTY_ICON_OPTIONS,
  getPropertyIconOption,
} from '@features/document/properties/property-icons';
import { resolvePreset, type PropertyKind } from '@features/document/properties/presets';
import { DateValueInput } from '@features/document/components/note-properties/date-value-input';
import { getCurrentAppLanguage, subscribeAppLanguage } from '@features/preferences/public/runtime-api';
import { canonicalizePropertyKey } from '@features/document/properties/property-key';

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

type PropertyDisplayKind =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'boolean'
  | 'array'
  | 'list'
  | 'icon';

const PROPERTY_URL_RE = /^https?:\/\/\S+$/i;
const PROPERTY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROPERTY_EDIT_POPOVER_WIDTH = 320;
const PROPERTY_EDIT_KINDS = [
  'Text',
  'Number',
  'MultiSelect',
  'Date',
  'Select',
  'List',
] as const satisfies readonly PropertyKind[];

type PropertyEditKind = typeof PROPERTY_EDIT_KINDS[number] | 'Icon';

const PROPERTY_EDIT_KIND_LABEL_KEYS = {
  Text: 'document.properties.type.text',
  Number: 'document.properties.type.number',
  MultiSelect: 'document.properties.category.tags',
  List: 'document.properties.type.list',
  Date: 'document.properties.type.date',
  Select: 'document.properties.type.select',
  Icon: 'document.properties.category.icon',
} as const;

const FIXED_PROPERTY_EDIT_KINDS: Partial<Record<string, PropertyEditKind>> = {
  name: 'Text',
  description: 'Text',
  tags: 'MultiSelect',
  flowix_colors: 'MultiSelect',
  flowix_icon: 'Icon',
};

const COMMON_PROPERTY_KEYS = [
  { key: 'name', labelKey: 'document.properties.commonKey.name' },
  { key: 'description', labelKey: 'document.properties.commonKey.description' },
  { key: 'tags', labelKey: 'document.properties.category.tags' },
  // Flowix note colors are managed by the product color palette and are
  // persisted under the internal frontmatter key, not a generic `color` key.
  { key: 'flowix_colors', labelKey: 'document.properties.commonKey.color' },
  { key: 'flowix_icon', labelKey: 'document.properties.category.icon' },
] as const;

const PROPERTY_DISPLAY_KEY_LABEL_KEYS: Partial<Record<string, I18nKey>> = {
  flowix_colors: 'document.properties.commonKey.color',
  name: 'document.properties.commonKey.name',
  description: 'document.properties.commonKey.description',
  tags: 'document.properties.category.tags',
  flowix_icon: 'document.properties.category.icon',
  flowix_favorited: 'document.action.pin',
};

const FLOWIX_COLOR_LABEL_KEYS: Record<MemoColor, I18nKey> = {
  red: 'document.color.red',
  orange: 'document.color.orange',
  yellow: 'document.color.yellow',
  green: 'document.color.green',
  cyan: 'document.color.cyan',
  blue: 'document.color.blue',
  gray: 'document.color.gray',
};

function isMultiSelectProperty(key: string, isFlowSequence = false): boolean {
  const canonicalKey = canonicalizePropertyKey(key);
  return canonicalKey === 'tags'
    || canonicalKey === 'flowix_colors'
    || isFlowSequence
    || resolvePreset(canonicalKey)?.kind === 'MultiSelect';
}

function getPropertyDisplayKind(
  key: string,
  value: unknown,
  isFlowSequence = false,
): PropertyDisplayKind {
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return isMultiSelectProperty(key, isFlowSequence) ? 'array' : 'list';
  const canonicalKey = canonicalizePropertyKey(key);
  if (canonicalKey === 'icon' || canonicalKey === 'flowix_icon') return 'icon';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && PROPERTY_DATE_RE.test(value)) return 'date';
  if (typeof value === 'string' && PROPERTY_URL_RE.test(value)) return 'url';
  return 'text';
}

function getPropertyEditKind(
  key: string,
  value: unknown,
  isFlowSequence = false,
): PropertyEditKind {
  const fixedKind = FIXED_PROPERTY_EDIT_KINDS[canonicalizePropertyKey(key)];
  if (fixedKind) return fixedKind;
  if (isMultiSelectProperty(key, isFlowSequence)) return 'MultiSelect';
  if (
    value === null
    || value === undefined
    || (typeof value === 'string' && !value.trim())
  ) {
    return 'Text';
  }
  if (typeof value === 'boolean') return 'Select';
  if (Array.isArray(value)) return 'List';
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'string' && PROPERTY_DATE_RE.test(value)) return 'Date';

  const presetKind = resolvePreset(canonicalizePropertyKey(key))?.kind;
  return presetKind === 'MultiSelect' ? 'MultiSelect' : 'Text';
}

function createPropertySvgIcon(
  kind: PropertyDisplayKind | 'properties' | 'add',
): SVGSVGElement {
  if (kind === 'number') return createNumberPropertySvgIcon();

  const paths: Record<Exclude<PropertyDisplayKind, 'number'> | 'properties' | 'add', string> = {
    properties: 'M5 6h14M5 12h14M5 18h14M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    add: 'M12 5v14M5 12h14',
    text: 'M5 6h14M5 12h14M5 18h9',
    date: 'M5 5h14v14H5zM8 3v4M16 3v4M5 9h14',
    url: 'm9 15 6-6M7 17H6a4 4 0 0 1 0-8h3M17 7h1a4 4 0 0 1 0 8h-3',
    boolean: 'M5 6h14M5 12h14M5 18h9',
    array: 'M8 5v14M16 5v14M5 8h14M5 16h14',
    list: 'M7 6h12M7 12h12M7 18h12M4 6h.01M4 12h.01M4 18h.01',
    icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 10h.01M15 10h.01M8.5 14a5 5 0 0 0 7 0',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('frontmatter-property__svg-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[kind]);
  svg.append(path);
  return svg;
}

function createNumberPropertySvgIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('frontmatter-property__svg-icon', 'frontmatter-property__svg-icon--number');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // A compact 12 mark makes this type distinct from the text/list icons while
  // remaining legible at the small size used by each property row.
  path.setAttribute(
    'd',
    'M5.5 8 7.5 6h1v12M5.5 18h4M12.5 8a2.5 2.5 0 1 1 4.5 1.5l-4.5 9h5',
  );
  svg.append(path);
  return svg;
}

function createPropertyTypeChevron(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm4 6 4 4 4-4');
  svg.append(path);
  return svg;
}

function createTextValue(value: unknown): HTMLElement {
  const text = createElement('span', 'frontmatter-property__value-text');
  // Keep the complete value here; the value cell controls wrapping within its
  // available width instead of silently losing content in the view layer.
  text.textContent = formatFrontmatterPropertyValue(value, Number.POSITIVE_INFINITY);
  return text;
}

function getPropertyEditValue(value: unknown, kind?: PropertyEditKind): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(String).join(kind === 'List' ? '\n' : ', ');
  }
  return toFrontmatterPropertyInput(value);
}

function resizePropertyEditInput(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

function InlineDateValueInput({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return createReactElement(DateValueInput, {
    value,
    onChange: (nextValue: string) => {
      setValue(nextValue);
      onChange(nextValue);
    },
  });
}

type PropertyEditTarget = 'key' | 'value';

interface PropertyEditControl {
  dom: HTMLElement;
  focusTarget: HTMLElement;
  getValue: () => string;
  storageKind: PropertyKind | 'Boolean';
  destroy?: () => void;
}

interface ActivePropertyEdit {
  property: { key: string; value: unknown };
  target: PropertyEditTarget;
  initialValue: string;
  initialKind?: PropertyEditKind;
  kind?: PropertyEditKind;
  popover: HTMLElement;
  control: PropertyEditControl;
}

export class FrontmatterPropertyNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseMirrorNode;
  private readonly memoId?: string;
  private validationError: string | null = null;
  private activePropertyEdit: ActivePropertyEdit | null = null;
  private activePropertyMenu: HTMLElement | null = null;
  private activePropertyMenuAnchor: HTMLElement | null = null;
  private readonly unsubscribeSettings: () => void;
  private readonly handleDocumentPointerDown = (event: Event) => {
    const target = event.target;
    const targetElement = target instanceof Element ? target : null;
    if (
      this.activePropertyMenu
      && target instanceof globalThis.Node
      && !this.activePropertyMenu.contains(target)
    ) {
      this.closePropertyMenu();
    }
    if (
      this.activePropertyEdit
      && target instanceof globalThis.Node
      && !this.activePropertyEdit.popover.contains(target)
      && !targetElement?.closest('.frontmatter-property__date-picker-popover')
    ) {
      this.savePropertyEdit();
    }
  };

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    memoId?: string,
  ) {
    this.node = node;
    this.memoId = memoId;
    this.dom = createElement('div', 'frontmatter-property-node');
    this.dom.contentEditable = 'false';
    this.unsubscribeSettings = subscribeAppLanguage(() => this.render());
    this.dom.ownerDocument.addEventListener(
      'pointerdown',
      this.handleDocumentPointerDown,
      true,
    );
    this.render();
  }

  private t(key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) {
    return translate(getCurrentAppLanguage(), key, params);
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof FrontmatterPropertyError)) {
      return error instanceof Error ? error.message : String(error);
    }
    switch (error.code) {
      case 'empty-key':
        return this.t('document.properties.emptyKey');
      case 'duplicate-key':
        return this.t('document.properties.duplicateKey');
      case 'reserved-key':
        return this.t('document.properties.picker.reservedKeyError', { key: 'key' });
      case 'invalid-tag':
        return this.t('document.properties.invalidTag');
      case 'invalid-color':
        return this.t('document.properties.invalidColor');
      default:
        return error.message;
    }
  }

  private closePropertyEditor() {
    this.activePropertyEdit?.control.destroy?.();
    this.activePropertyEdit?.popover.remove();
    this.activePropertyEdit = null;
  }

  private closePropertyMenu() {
    this.activePropertyMenu?.remove();
    this.activePropertyMenuAnchor?.setAttribute('aria-expanded', 'false');
    this.activePropertyMenu = null;
    this.activePropertyMenuAnchor = null;
  }

  private updatePropertyStructure(
    propertyKey: string,
    action: 'up' | 'down' | 'delete',
  ) {
    const yamlContent = String(this.node.attrs.yamlContent ?? '');
    try {
      const nextYamlContent = action === 'delete'
        ? deleteVisibleFrontmatterProperty(yamlContent, propertyKey)
        : moveVisibleFrontmatterProperty(yamlContent, propertyKey, action);
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.closePropertyMenu();
      this.validationError = null;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          yamlContent: nextYamlContent,
        }),
      );
    } catch (error) {
      this.closePropertyMenu();
      this.validationError = this.errorMessage(error);
      this.render();
    }
  }

  private openPropertyMenu(
    property: { key: string; value: unknown },
    anchor: HTMLElement,
  ) {
    if (!this.view.editable) return;
    this.closePropertyMenu();
    const ownerDocument = this.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;

    const parsed = parseVisibleFrontmatter(String(this.node.attrs.yamlContent ?? ''));
    const propertyIndex = parsed.properties.findIndex((item) => item.key === property.key);
    const menu = createElement('div', 'frontmatter-property__item-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', property.key);

    const addAction = (
      action: 'up' | 'down' | 'delete',
      labelKey: Parameters<typeof translate>[1],
      disabled = false,
    ) => {
      const button = createElement('button', 'frontmatter-property__item-menu-button', this.t(labelKey));
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.disabled = disabled;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (button.disabled) return;
        this.updatePropertyStructure(property.key, action);
      });
      menu.append(button);
    };

    addAction('up', 'document.properties.moveUp', propertyIndex <= 0);
    addAction(
      'down',
      'document.properties.moveDown',
      propertyIndex < 0 || propertyIndex >= parsed.properties.length - 1,
    );
    addAction('delete', 'document.properties.deleteProperty');

    const anchorRect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(8, anchorRect.left)}px`;
    menu.style.top = `${Math.max(8, anchorRect.bottom + 4)}px`;
    ownerDocument.body.append(menu);
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > ownerWindow.innerWidth - 8) {
      menu.style.left = `${Math.max(8, ownerWindow.innerWidth - menuRect.width - 8)}px`;
    }
    if (menuRect.bottom > ownerWindow.innerHeight - 8) {
      menu.style.top = `${Math.max(8, anchorRect.top - menuRect.height - 4)}px`;
    }
    anchor.setAttribute('aria-expanded', 'true');
    this.activePropertyMenu = menu;
    this.activePropertyMenuAnchor = anchor;
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.closePropertyMenu();
      anchor.focus();
    });
  }

  private savePropertyEdit() {
    const activeEdit = this.activePropertyEdit;
    if (!activeEdit) return;

    const nextInputValue = activeEdit.control.getValue();
    const nextKeyInput = activeEdit.target === 'key'
      ? nextInputValue
      : activeEdit.property.key;
    const nextValueInput = activeEdit.target === 'value'
      && typeof activeEdit.property.value === 'boolean'
      ? nextInputValue.trim()
      : activeEdit.target === 'value'
        ? nextInputValue
        : getPropertyEditValue(activeEdit.property.value);
    const propertyKey = canonicalizePropertyKey(activeEdit.property.key);
    const kind = activeEdit.target === 'value' ? activeEdit.kind : undefined;
    const storageKind = activeEdit.target === 'value'
      ? activeEdit.control.storageKind
      : undefined;
    this.closePropertyEditor();
    if (
      activeEdit.target === 'key'
        ? nextKeyInput === activeEdit.initialValue
        : nextValueInput === activeEdit.initialValue && kind === activeEdit.initialKind
    ) return;

    try {
      const nextYamlContent = updateVisibleFrontmatterProperty(
        String(this.node.attrs.yamlContent ?? ''),
        activeEdit.property.key,
        nextKeyInput,
        nextValueInput,
        activeEdit.target === 'value' && propertyKey === 'tags' ? 'MultiSelect' : storageKind,
      );
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.validationError = null;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          yamlContent: nextYamlContent,
        }),
      );
    } catch (error) {
      this.validationError = this.errorMessage(error);
      this.render();
    }
  }

  private updateBooleanProperty(
    property: { key: string; value: unknown },
    nextValue: boolean,
  ) {
    try {
      const nextYamlContent = updateVisibleFrontmatterProperty(
        String(this.node.attrs.yamlContent ?? ''),
        property.key,
        property.key,
        String(nextValue),
        'Boolean',
      );
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.validationError = null;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          yamlContent: nextYamlContent,
        }),
      );
    } catch (error) {
      this.validationError = this.errorMessage(error);
      this.render();
    }
  }

  private openPropertyEditor(
    property: { key: string; value: unknown },
    anchor: HTMLElement,
    target: PropertyEditTarget,
  ) {
    if (!this.view.editable) return;
    this.closePropertyEditor();

    const ownerDocument = this.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popover = createElement('div', 'frontmatter-property__edit-popover');
    const isFlowSequence = isFrontmatterPropertyFlowSequence(
      String(this.node.attrs.yamlContent ?? ''),
      property.key,
    );
    const initialKind = target === 'value'
      ? getPropertyEditKind(property.key, property.value, isFlowSequence)
      : undefined;
    const initialValue = target === 'key'
      ? property.key
      : getPropertyEditValue(property.value, initialKind);

    popover.style.position = 'fixed';
    popover.style.left = `${anchorRect.left}px`;
    popover.style.top = `${anchorRect.top}px`;
    const availableWidth = Math.max(180, ownerWindow.innerWidth - anchorRect.left - 16);
    popover.style.width = `${Math.min(
      PROPERTY_EDIT_POPOVER_WIDTH,
      availableWidth,
    )}px`;

    const handleKeyDown = (event: KeyboardEvent) => {
      const keyboardEvent = event;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault();
        this.closePropertyEditor();
        return;
      }
      if (
        keyboardEvent.key === 'Enter'
        && (target === 'key' || keyboardEvent.metaKey || keyboardEvent.ctrlKey)
      ) {
        keyboardEvent.preventDefault();
        this.savePropertyEdit();
      }
    };

    const focusControl = (control: PropertyEditControl) => {
      control.focusTarget.focus();
      if (
        control.focusTarget instanceof HTMLInputElement
        && control.focusTarget.type === 'text'
      ) {
        control.focusTarget.setSelectionRange(
          control.focusTarget.value.length,
          control.focusTarget.value.length,
        );
      }
      if (control.focusTarget instanceof HTMLTextAreaElement) {
        resizePropertyEditInput(control.focusTarget);
        control.focusTarget.setSelectionRange(
          control.focusTarget.value.length,
          control.focusTarget.value.length,
        );
      }
    };

    const createControl = (kind: PropertyEditKind, value: string): PropertyEditControl => {
      if (kind === 'Number') {
        const numberControl = createElement('div', 'frontmatter-property__edit-number-control');
        const input = createElement('input', 'frontmatter-property__edit-input');
        input.type = 'number';
        input.step = '1';
        input.inputMode = 'numeric';
        input.value = value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
        input.spellcheck = false;
        input.setAttribute('aria-label', property.key);
        input.setAttribute('data-property-key', property.key);
        input.setAttribute('inputmode', 'numeric');
        input.addEventListener('input', () => {
          const negative = input.value.startsWith('-');
          const digits = input.value.replace(/\D/g, '');
          const nextValue = negative ? `-${digits}` : digits;
          if (input.value !== nextValue) input.value = nextValue;
        });
        input.addEventListener('keydown', (event) => {
          if (event.key.length === 1) {
            if (
              event.key === '-'
              && (
                input.value.includes('-')
                || (input.selectionStart !== null && input.selectionStart !== 0)
              )
            ) {
              event.preventDefault();
              return;
            }
            if (!/\d/.test(event.key) && event.key !== '-') {
              event.preventDefault();
              return;
            }
          }
          handleKeyDown(event);
        });
        const stepper = createElement('div', 'frontmatter-property__edit-number-stepper');
        const addStepButton = createElement('button', 'frontmatter-property__edit-number-step', '+');
        const subtractStepButton = createElement('button', 'frontmatter-property__edit-number-step', '−');
        addStepButton.type = 'button';
        subtractStepButton.type = 'button';
        addStepButton.setAttribute('aria-label', 'Increase value');
        subtractStepButton.setAttribute('aria-label', 'Decrease value');
        const stepValue = (direction: 'up' | 'down') => {
          if (direction === 'up') input.stepUp();
          else input.stepDown();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        };
        addStepButton.addEventListener('click', () => stepValue('up'));
        subtractStepButton.addEventListener('click', () => stepValue('down'));
        stepper.append(addStepButton, subtractStepButton);
        numberControl.append(input, stepper);
        return {
          dom: numberControl,
          focusTarget: input,
          getValue: () => input.value,
          storageKind: 'Number',
        };
      }

      if (kind === 'Date') {
        const dateControl = createElement('div', 'frontmatter-property__edit-date');
        dateControl.tabIndex = -1;
        dateControl.setAttribute('data-property-key', property.key);
        let dateValue = PROPERTY_DATE_RE.test(value) ? value : '';
        const root: Root = createRoot(dateControl);
        root.render(createReactElement(InlineDateValueInput, {
          initialValue: dateValue,
          onChange: (nextValue: string) => {
            dateValue = nextValue;
          },
        }));
        dateControl.addEventListener('keydown', handleKeyDown);
        return {
          dom: dateControl,
          focusTarget: dateControl,
          getValue: () => dateValue,
          storageKind: 'Date',
          destroy: () => root.unmount(),
        };
      }

      if (kind === 'Icon') {
        const iconControl = createElement('div', 'frontmatter-property__edit-icon');
        let iconValue = value.trim().replace(/\.svg$/i, '');
        const trigger = createElement('button', 'frontmatter-property__edit-icon-trigger');
        const menu = createElement('div', 'frontmatter-property__edit-icon-menu');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', property.key);
        menu.hidden = true;

        const closeMenu = () => {
          menu.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
        };
        const renderTrigger = () => {
          trigger.replaceChildren();
          const iconBox = createElement('span', 'frontmatter-property__edit-icon-box');
          const selected = getPropertyIconOption(iconValue);
          if (!selected) iconBox.classList.add('frontmatter-property__edit-icon-box--empty');
          if (selected) {
            const image = createElement('img', 'frontmatter-property__edit-icon-image');
            image.src = selected.src;
            image.alt = '';
            image.draggable = false;
            image.title = selected.label;
            trigger.title = selected.label;
            iconBox.append(image);
          } else {
            trigger.title = '';
            iconBox.append(createElement('span', 'frontmatter-property__edit-icon-placeholder'));
          }
          trigger.append(iconBox);
          if (iconValue) {
            const clear = createElement('span', 'frontmatter-property__edit-icon-clear', '×');
            clear.setAttribute('role', 'button');
            clear.tabIndex = -1;
            clear.setAttribute('aria-label', this.t('document.properties.icon.clear'));
            clear.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              iconValue = '';
              renderTrigger();
              trigger.focus();
            });
            trigger.append(clear);
          }
        };

        menu.setAttribute('role', 'listbox');
        PROPERTY_ICON_OPTIONS.forEach((option) => {
          const item = createElement('button', 'frontmatter-property__edit-icon-option');
          item.type = 'button';
          item.dataset.value = option.value;
          item.setAttribute('role', 'option');
          item.setAttribute('aria-label', option.label);
          item.setAttribute('aria-selected', String(option.value === iconValue));
          const image = createElement('img', 'frontmatter-property__edit-icon-image');
          image.src = option.src;
          image.alt = '';
          image.draggable = false;
          item.append(image);
          item.addEventListener('click', () => {
            iconValue = option.value;
            menu.querySelectorAll<HTMLElement>('[role="option"]').forEach((entry) => {
              entry.setAttribute('aria-selected', String(entry === item));
            });
            renderTrigger();
            closeMenu();
            trigger.focus();
          });
          menu.append(item);
        });

        trigger.addEventListener('click', () => {
          const open = menu.hidden;
          menu.hidden = !open;
          trigger.setAttribute('aria-expanded', String(open));
        });
        trigger.addEventListener('keydown', handleKeyDown);
        menu.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          closeMenu();
          trigger.focus();
        });
        renderTrigger();
        iconControl.append(trigger, menu);
        return {
          dom: iconControl,
          focusTarget: trigger,
          getValue: () => iconValue,
          storageKind: 'Icon',
        };
      }

      if (
        kind === 'MultiSelect'
        && canonicalizePropertyKey(property.key) === 'flowix_colors'
      ) {
        const colorControl = createElement('div', 'frontmatter-property__edit-colors');
        colorControl.tabIndex = 0;
        colorControl.setAttribute('role', 'group');
        colorControl.setAttribute('aria-label', this.t('document.color.button'));
        const selected = new Set<MemoColor>(
          value
            .split(',')
            .map((item) => item.trim())
            .filter((item): item is MemoColor => MEMO_COLORS.includes(item as MemoColor)),
        );

        const renderColors = () => {
          colorControl.replaceChildren();
          const clear = createElement('button', 'frontmatter-property__edit-color-clear');
          clear.type = 'button';
          clear.setAttribute('aria-label', this.t('document.color.clear'));
          clear.setAttribute('aria-pressed', String(selected.size === 0));
          clear.addEventListener('click', () => {
            selected.clear();
            renderColors();
          });
          colorControl.append(clear);

          MEMO_COLORS.forEach((color) => {
            const option = createElement(
              'button',
              'frontmatter-property__edit-color-option',
            );
            const isSelected = selected.has(color);
            option.type = 'button';
            option.dataset.value = color;
            option.setAttribute('aria-label', this.t(FLOWIX_COLOR_LABEL_KEYS[color]));
            option.setAttribute('aria-pressed', String(isSelected));
            option.title = this.t(FLOWIX_COLOR_LABEL_KEYS[color]);
            option.append(createElement('span', 'frontmatter-property__edit-color-swatch'));
            option.style.setProperty('--frontmatter-edit-color', MEMO_COLOR_HEX[color]);
            if (isSelected) option.dataset.selected = 'true';
            option.addEventListener('click', () => {
              if (selected.has(color)) selected.delete(color);
              else selected.add(color);
              renderColors();
            });
            colorControl.append(option);
          });
        };

        colorControl.addEventListener('keydown', handleKeyDown);
        renderColors();
        return {
          dom: colorControl,
          focusTarget: colorControl,
          getValue: () => MEMO_COLORS.filter((color) => selected.has(color)).join(', '),
          storageKind: 'MultiSelect',
        };
      }

      if (kind === 'Select') {
        const label = createElement('label', 'frontmatter-property__edit-checkbox-label');
        const checkbox = createElement('input', 'frontmatter-property__edit-checkbox');
        checkbox.type = 'checkbox';
        checkbox.checked = value.trim() === 'true';
        checkbox.setAttribute('aria-label', property.key);
        checkbox.setAttribute('data-property-key', property.key);
        checkbox.addEventListener('keydown', handleKeyDown);
        label.append(checkbox);
        return {
          dom: label,
          focusTarget: checkbox,
          getValue: () => String(checkbox.checked),
          storageKind: 'Boolean',
        };
      }

      if (kind === 'MultiSelect') {
        const tagControl = createElement('div', 'frontmatter-property__edit-tags');
        const chips = createElement('div', 'frontmatter-property__edit-tags-chips');
        const input = createElement(
          'input',
          'frontmatter-property__edit-input frontmatter-property__edit-tags-input',
        );
        let tags = value.split(',').map((item) => item.trim()).filter(Boolean);

        const renderTags = () => {
          chips.replaceChildren();
          tags.forEach((tag, index) => {
            const chip = createElement('span', 'frontmatter-property__edit-tag-chip', tag);
            const remove = createElement('button', 'frontmatter-property__edit-tag-remove', '×');
            remove.type = 'button';
            remove.setAttribute(
              'aria-label',
              this.t('document.properties.deleteTag', { tag }),
            );
            remove.addEventListener('click', () => {
              tags = tags.filter((_, tagIndex) => tagIndex !== index);
              renderTags();
              input.focus();
            });
            chip.append(remove);
            chips.append(chip);
          });
        };

        input.type = 'text';
        input.spellcheck = false;
        input.setAttribute('aria-label', this.t('document.properties.tagInputPlaceholder'));
        input.setAttribute('data-property-key', property.key);
        input.addEventListener('keydown', (event) => {
          if (
            event.key !== 'Enter'
            && event.key !== ','
          ) {
            handleKeyDown(event);
            return;
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            handleKeyDown(event);
            return;
          }
          const draft = input.value.trim();
          if (!draft) return;
          event.preventDefault();
          if (!tags.includes(draft)) tags = [...tags, draft];
          input.value = '';
          renderTags();
        });
        renderTags();
        tagControl.append(chips, input);
        return {
          dom: tagControl,
          focusTarget: input,
          getValue: () => [...tags, input.value.trim()].filter(Boolean).join(', '),
          storageKind: 'MultiSelect',
        };
      }

      if (kind === 'List') {
        const listInput = createElement('textarea', 'frontmatter-property__edit-input frontmatter-property__edit-list-input');
        listInput.value = value;
        listInput.rows = Math.max(2, Math.min(6, value.split(/\r?\n/).length));
        listInput.spellcheck = false;
        listInput.wrap = 'soft';
        listInput.setAttribute('aria-label', property.key);
        listInput.setAttribute('data-property-key', property.key);
        listInput.addEventListener('input', () => resizePropertyEditInput(listInput));
        listInput.addEventListener('keydown', handleKeyDown);
        return {
          dom: listInput,
          focusTarget: listInput,
          getValue: () => listInput.value,
          storageKind: 'List',
        };
      }

      const textarea = createElement('textarea', 'frontmatter-property__edit-input');
      textarea.value = value;
      textarea.rows = 1;
      textarea.spellcheck = false;
      textarea.wrap = 'soft';
      textarea.setAttribute('aria-label', property.key);
      textarea.setAttribute('data-property-key', property.key);
      textarea.addEventListener('input', () => resizePropertyEditInput(textarea));
      textarea.addEventListener('keydown', handleKeyDown);
      return {
        dom: textarea,
        focusTarget: textarea,
        getValue: () => textarea.value,
        storageKind: 'Text',
      };
    };

    let control: PropertyEditControl;
    if (target === 'key') {
      const input = createElement('input', 'frontmatter-property__edit-input');
      const keyControl = createElement('div', 'frontmatter-property__edit-key-control');
      const keyTrigger = createElement('button', 'frontmatter-property__edit-key-trigger');
      const keyMenu = createElement('div', 'frontmatter-property__edit-key-menu');

      input.value = initialValue;
      input.spellcheck = false;
      input.setAttribute('aria-label', 'key');
      input.setAttribute('data-property-key', property.key);
      keyTrigger.type = 'button';
      keyTrigger.setAttribute('aria-haspopup', 'listbox');
      keyTrigger.setAttribute('aria-expanded', 'false');
      keyTrigger.setAttribute(
        'aria-label',
        this.t('document.properties.commonKey.triggerLabel'),
      );
      keyTrigger.append(createPropertyTypeChevron());

      keyMenu.hidden = true;
      keyMenu.setAttribute('role', 'listbox');
      const parsedFrontmatter = parseVisibleFrontmatter(
        String(this.node.attrs.yamlContent ?? ''),
      );
      const occupiedKeys = new Set(
        parsedFrontmatter.properties
          .filter(({ key }) => key !== property.key)
          .map(({ key }) => canonicalizePropertyKey(key)),
      );
      const closeKeyMenu = () => {
        keyMenu.hidden = true;
        keyTrigger.setAttribute('aria-expanded', 'false');
      };
      const openKeyMenu = () => {
        keyMenu.hidden = false;
        keyTrigger.setAttribute('aria-expanded', 'true');
      };

      COMMON_PROPERTY_KEYS.forEach(({ key, labelKey }) => {
        const option = createElement('button', 'frontmatter-property__edit-key-option', this.t(labelKey));
        const alreadyExists = occupiedKeys.has(canonicalizePropertyKey(key));
        option.type = 'button';
        option.dataset.value = key;
        option.setAttribute('role', 'option');
        option.disabled = alreadyExists;
        if (alreadyExists) option.title = this.t('document.properties.commonKey.alreadyExists');
        option.addEventListener('click', (event) => {
          event.preventDefault();
          if (option.disabled) return;
          input.value = key;
          closeKeyMenu();
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        });
        keyMenu.append(option);
      });

      input.addEventListener('focus', closeKeyMenu);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openKeyMenu();
          return;
        }
        handleKeyDown(event);
      });
      keyTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (keyMenu.hidden) openKeyMenu();
        else closeKeyMenu();
      });
      keyMenu.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeKeyMenu();
        keyTrigger.focus();
      });

      keyControl.append(keyTrigger, input, keyMenu);
      control = {
        dom: keyControl,
        focusTarget: input,
        getValue: () => input.value,
        storageKind: 'Text',
      };
    } else {
      control = createControl(initialKind ?? 'Text', initialValue);
    }

    popover.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;
      const nextTargetElement = nextTarget instanceof Element ? nextTarget : null;
      if (
        !(nextTarget instanceof globalThis.Node)
        || popover.contains(nextTarget)
        || nextTargetElement?.closest('.frontmatter-property__date-picker-popover')
      ) return;
      queueMicrotask(() => {
        if (
          this.activePropertyEdit?.popover === popover
          && !popover.contains(ownerDocument.activeElement)
        ) {
          this.savePropertyEdit();
        }
      });
    });
    if (initialKind) {
      const typeRow = createElement('div', 'frontmatter-property__edit-type-row');
      const typeTrigger = createElement('button', 'frontmatter-property__edit-type-trigger');
      const isFixedPropertyKind = target === 'value'
        && FIXED_PROPERTY_EDIT_KINDS[canonicalizePropertyKey(property.key)] !== undefined;
      typeTrigger.type = 'button';
      typeTrigger.disabled = isFixedPropertyKind;
      typeTrigger.setAttribute('aria-haspopup', 'listbox');
      typeTrigger.setAttribute('aria-expanded', 'false');
      typeTrigger.setAttribute('aria-disabled', String(isFixedPropertyKind));
      typeTrigger.setAttribute('aria-label', this.t('document.properties.typeColumn'));
      const typeLabel = createElement(
        'span',
        'frontmatter-property__edit-type-label',
        this.t(PROPERTY_EDIT_KIND_LABEL_KEYS[initialKind]),
      );
      const typeChevron = createElement('span', 'frontmatter-property__edit-type-chevron');
      typeChevron.append(createPropertyTypeChevron());
      typeTrigger.append(typeLabel, typeChevron);

      const typeMenu = createElement('div', 'frontmatter-property__edit-type-menu');
      typeMenu.hidden = true;
      typeMenu.setAttribute('role', 'listbox');
      const closeTypeMenu = () => {
        typeMenu.hidden = true;
        typeTrigger.setAttribute('aria-expanded', 'false');
      };
      control.focusTarget.addEventListener('focus', closeTypeMenu);
      PROPERTY_EDIT_KINDS.forEach((kind) => {
        const option = createElement(
          'button',
          'frontmatter-property__edit-type-option',
          this.t(PROPERTY_EDIT_KIND_LABEL_KEYS[kind]),
        );
        option.type = 'button';
        option.dataset.value = kind;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(kind === initialKind));
        option.addEventListener('click', () => {
          const activeEdit = this.activePropertyEdit;
          if (activeEdit?.popover !== popover || activeEdit.target !== 'value') return;
          const nextValue = activeEdit.control.getValue();
          const nextControl = createControl(kind, nextValue);
          activeEdit.kind = kind;
          activeEdit.control.destroy?.();
          activeEdit.control.dom.replaceWith(nextControl.dom);
          activeEdit.control = nextControl;
          typeLabel.textContent = this.t(PROPERTY_EDIT_KIND_LABEL_KEYS[kind]);
          typeMenu.querySelectorAll<HTMLElement>('[role="option"]').forEach((item) => {
            item.setAttribute('aria-selected', String(item === option));
          });
          closeTypeMenu();
          focusControl(nextControl);
        });
        typeMenu.append(option);
      });
      typeTrigger.addEventListener('click', () => {
        const open = typeMenu.hidden;
        typeMenu.hidden = !open;
        typeTrigger.setAttribute('aria-expanded', String(open));
      });
      typeTrigger.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (!typeMenu.hidden) {
          closeTypeMenu();
          return;
        }
        this.closePropertyEditor();
      });
      typeMenu.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeTypeMenu();
        typeTrigger.focus();
      });
      typeRow.append(typeTrigger, typeMenu);
      popover.append(typeRow);
    }
    popover.append(control.dom);
    ownerDocument.body.append(popover);
    this.activePropertyEdit = {
      property,
      target,
      initialValue,
      initialKind,
      kind: initialKind,
      popover,
      control,
    };
    focusControl(control);
  }

  private renderPropertyValue(
    property: { key: string; value: unknown },
    isFlowSequence = false,
  ): HTMLElement {
    const valueContainer = createElement('div', 'frontmatter-property__display-value');
    const kind = getPropertyDisplayKind(property.key, property.value, isFlowSequence);

    if (
      property.value === ''
      || property.value === null
      || property.value === undefined
      || (Array.isArray(property.value) && property.value.length === 0)
    ) {
      valueContainer.append(createElement(
        'span',
        'frontmatter-property__value-text frontmatter-property__value-text--fallback',
        this.t('document.properties.notSet'),
      ));
      return valueContainer;
    }

    if (kind === 'boolean') {
      const checkbox = createElement('input', 'frontmatter-property__value-checkbox');
      checkbox.type = 'checkbox';
      checkbox.checked = property.value === true;
      checkbox.disabled = !this.view.editable;
      checkbox.setAttribute('aria-label', property.key);
      checkbox.setAttribute('data-property-key', property.key);
      checkbox.setAttribute('data-property-type', 'Select');
      checkbox.addEventListener('change', () => {
        this.updateBooleanProperty(property, checkbox.checked);
      });
      valueContainer.classList.add('frontmatter-property__display-value--checkbox');
      valueContainer.append(checkbox);
      return valueContainer;
    }

    if (kind === 'array') {
      const values = Array.isArray(property.value) ? property.value : [];
      if (values.length === 0) {
        valueContainer.append(createTextValue('[]'));
        return valueContainer;
      }

      if (canonicalizePropertyKey(property.key) === 'flowix_colors') {
        const colorDots = createElement('div', 'frontmatter-property__value-color-dots');
        values.forEach((item) => {
          const color = String(item).trim();
          if (!MEMO_COLORS.includes(color as MemoColor)) return;
          const dot = createElement('span', 'frontmatter-property__value-color-dot');
          const label = this.t(FLOWIX_COLOR_LABEL_KEYS[color as MemoColor]);
          dot.dataset.value = color;
          dot.setAttribute('role', 'img');
          dot.setAttribute('aria-label', label);
          dot.title = label;
          dot.style.setProperty('--frontmatter-color', MEMO_COLOR_HEX[color as MemoColor]);
          colorDots.append(dot);
        });
        valueContainer.append(colorDots);
        return valueContainer;
      }

      const chips = createElement('div', 'frontmatter-property__value-chips');
      const isNoteTags = canonicalizePropertyKey(property.key) === 'tags';
      values.forEach((item) => {
        const displayValue = formatFrontmatterPropertyValue(item, 32);
        const chip = createElement(
          'span',
          `${isNoteTags ? 'tag-node ' : ''}frontmatter-property__value-chip${getPropertyDisplayKind(property.key, item) === 'text' ? '' : ' frontmatter-property__value-chip--typed'}`,
          isNoteTags ? `#${displayValue}` : displayValue,
        );
        chip.title = formatFrontmatterPropertyValue(item, Number.POSITIVE_INFINITY);
        chips.append(chip);
      });
      valueContainer.append(chips);
      return valueContainer;
    }

    if (kind === 'list') {
      const values = Array.isArray(property.value) ? property.value : [];
      if (values.length === 0) {
        valueContainer.append(createTextValue('[]'));
        return valueContainer;
      }

      const list = createElement('ul', 'frontmatter-property__value-list');
      values.forEach((item) => {
        const listItem = createElement('li', 'frontmatter-property__value-list-item');
        listItem.append(createTextValue(item));
        list.append(listItem);
      });
      valueContainer.append(list);
      return valueContainer;
    }

    if (kind === 'icon') {
      const iconOption = getPropertyIconOption(String(property.value ?? ''));
      if (iconOption) {
        const image = document.createElement('img');
        image.className = 'frontmatter-property__value-icon';
        image.src = iconOption.src;
        image.alt = iconOption.label;
        image.title = iconOption.label;
        valueContainer.append(image);
        return valueContainer;
      }
    }

    if (kind === 'url' && typeof property.value === 'string') {
      const link = createElement('a', 'frontmatter-property__value-text frontmatter-property__value-text--url', property.value);
      link.href = property.value;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.title = property.value;
      valueContainer.append(link);
      return valueContainer;
    }

    valueContainer.append(createTextValue(property.value));
    return valueContainer;
  }

  private bindPropertyEdit(
    cell: HTMLElement,
    property: { key: string; value: unknown },
    target: PropertyEditTarget,
  ) {
    if (!this.view.editable) return;
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.addEventListener('click', (event) => {
      const eventTarget = event.target;
      if (
        eventTarget instanceof Element
        && eventTarget.closest('button, input, textarea, select')
      ) {
        return;
      }
      if (eventTarget instanceof HTMLAnchorElement) event.preventDefault();
      this.openPropertyEditor(property, cell, target);
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.openPropertyEditor(property, cell, target);
    });
  }

  private renderPropertyRow(
    property: { key: string; value: unknown },
    isFlowSequence = false,
  ): HTMLElement {
    const kind = getPropertyDisplayKind(property.key, property.value, isFlowSequence);
    const row = createElement('div', 'frontmatter-property__display');
    row.dataset.propertyKey = property.key;

    const icon = createElement(
      'span',
      `frontmatter-property__type-icon frontmatter-property__type-icon--${kind}`,
    );
    if (this.view.editable) {
      icon.tabIndex = 0;
      icon.setAttribute('role', 'button');
      icon.setAttribute('aria-haspopup', 'menu');
      icon.setAttribute('aria-expanded', 'false');
      icon.setAttribute('aria-label', property.key);
      icon.addEventListener('click', () => this.openPropertyMenu(property, icon));
      icon.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.openPropertyMenu(property, icon);
      });
    }
    icon.append(createPropertySvgIcon(kind));

    const key = createElement('span', 'frontmatter-property__display-key');
    key.title = property.key;
    const displayKey = PROPERTY_DISPLAY_KEY_LABEL_KEYS[canonicalizePropertyKey(property.key)];
    key.append(createElement(
      'span',
      'frontmatter-property__key',
      displayKey ? this.t(displayKey) : property.key,
    ));
    const value = this.renderPropertyValue(property, isFlowSequence);

    this.bindPropertyEdit(key, property, 'key');
    this.bindPropertyEdit(value, property, 'value');

    row.append(icon, key, value);
    return row;
  }

  private addEmptyProperty() {
    const yamlContent = String(this.node.attrs.yamlContent ?? '');
    const parsed = parseVisibleFrontmatter(yamlContent);
    const existingKeys = new Set(Object.keys(parsed.data));
    let index = 1;
    let nextKey = `key${index}`;
    while (existingKeys.has(nextKey)) {
      index += 1;
      nextKey = `key${index}`;
    }

    try {
      const nextYamlContent = updateVisibleFrontmatterProperty(
        yamlContent,
        null,
        nextKey,
        '',
        'Text',
      );
      const pos = this.getPos();
      if (typeof pos !== 'number') return;
      this.validationError = null;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          yamlContent: nextYamlContent,
        }),
      );
    } catch (error) {
      this.validationError = this.errorMessage(error);
      this.render();
    }
  }

  private renderAddProperty(container: HTMLElement) {
    if (!this.memoId || !this.view.editable) return;
    const add = createElement('button', 'frontmatter-property__add-property');
    add.type = 'button';
    add.title = this.t('document.properties.addField');
    add.setAttribute('aria-label', this.t('document.properties.addField'));
    const addIcon = createElement('span', 'frontmatter-property__add-property-icon');
    addIcon.append(createPropertySvgIcon('add'));
    add.append(
      addIcon,
      createElement('span', '', this.t('document.action.properties')),
    );
    add.addEventListener('click', () => this.addEmptyProperty());
    container.append(add);
  }

  private render() {
    this.closePropertyMenu();
    this.closePropertyEditor();
    const parsed = parseVisibleFrontmatter(String(this.node.attrs.yamlContent ?? ''));
    const container = createElement('div', 'frontmatter-property');

    if (parsed.parseError) {
      const error = createElement(
        'div',
        'frontmatter-property__error',
        this.t('document.properties.yamlParseError'),
      );
      error.title = parsed.parseError;
      container.append(error);
    } else {
      const list = createElement('div', 'frontmatter-property__list');
      parsed.properties.forEach((property) => {
        list.append(this.renderPropertyRow(
          property,
          isFrontmatterPropertyFlowSequence(String(this.node.attrs.yamlContent ?? ''), property.key),
        ));
      });
      if (this.validationError) {
        const validation = createElement(
          'span',
          'frontmatter-property__validation',
          this.validationError,
        );
        validation.title = this.validationError;
        list.append(validation);
      }
      container.append(list);
      this.renderAddProperty(container);
    }

    this.dom.replaceChildren(container);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    const yamlChanged = node.attrs.yamlContent !== this.node.attrs.yamlContent;
    this.node = node;
    if (yamlChanged) this.validationError = null;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as globalThis.Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.closePropertyMenu();
    this.closePropertyEditor();
    this.dom.ownerDocument.removeEventListener(
      'pointerdown',
      this.handleDocumentPointerDown,
      true,
    );
    this.unsubscribeSettings();
  }
}
