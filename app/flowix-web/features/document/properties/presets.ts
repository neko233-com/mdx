/**
 * Note property preset catalog.
 *
 * Single source of truth for the guided property input in
 * `note-properties-dialog.tsx`. The catalog is render-time only — preset
 * metadata (category, icon, mapped label) is never written to the YAML
 * frontmatter. The storage layer (`properties: Value` in Rust, opaque
 * `Record<string, unknown>` in TypeScript) is unchanged.
 *
 * Adding a built-in preset:
 *  1. Append an entry to `BUILTIN_PRESETS`.
 *  2. Add its label / hint / option i18n keys to `locales.ts` (both
 *     `zh-CN` and `en-US`).
 *  3. If the preset's kind needs a new value, extend `PropertyKind`
 *     and the dialog's value-column switch.
 */

import type { Icon } from '@phosphor-icons/react';
import {
  PaletteIcon,
  PushPinIcon,
  SmileyIcon,
  TagIcon,
  TextAlignLeftIcon,
  TextTIcon,
} from '@phosphor-icons/react';
import type { I18nKey } from '@/lib/i18n';
import type { PropertyFieldConfig } from '@/lib/constants';
import { canonicalizePropertyKey } from './property-key';

/** UI-side data types. PascalCase to match the existing `PROPERTY_TYPES` array.
 *  'Tags' 已移除 — 多选统一走 'MultiSelect' (YAML 都是 array, UI 上 chips
 *  也一致), 旧 Tags 行加载时 inferType 直接映射到 MultiSelect。 */
export type PropertyKind =
  | 'Text'
  | 'Boolean'
  | 'Number'
  | 'Date'
  | 'URL'
  | 'Icon'
  | 'Select'
  | 'MultiSelect'
  | 'List';

/** Field types in display order. Single source for both the dialog's type
 *  column and the Custom popup's type chip group. */
export const PROPERTY_KINDS: readonly PropertyKind[] = [
  'Text',
  'Boolean',
  'Number',
  'Date',
  'Icon',
  'Select',
  'MultiSelect',
  'List',
];

/**
 * Categories that drive the picker grouping. Values are camelCase to align
 * 1:1 with `document.properties.category.<value>` i18n keys in `locales.ts`.
 * Note that the YAML key for a preset (`preset.key`) is independently
 * kebab-case — category and key are separate concepts.
 */
export type PropertyCategory =
  | 'name'
  | 'description'
  | 'tags'
  | 'color'
  | 'icon'
  | 'favorite'
  | 'custom';

export type PropertyPresetSource = 'builtin' | 'custom';

/** Unified runtime definition consumed by every property picker/editor. */
export interface PropertyPreset {
  source: PropertyPresetSource;
  /** Built-in category slot. Custom presets do not require a category. */
  category: PropertyCategory;
  /** The literal key written to YAML. */
  key: string;
  /** Resolved display name. Built-ins resolve this from i18n at runtime. */
  label: string;
  /** Default UI kind. User can still override via the type column. */
  kind: PropertyKind;
  /** Option values for `Select` / `MultiSelect`. */
  options?: readonly string[];
  /** Optional description / hint (i18n key). */
  hintKey?: I18nKey;
  /** Phosphor icon rendered in the picker item and the trigger button. */
  icon?: Icon;
}

interface BuiltinPropertyPreset {
  source: 'builtin';
  category: Exclude<PropertyCategory, 'custom'>;
  key: string;
  labelKey: I18nKey;
  kind: PropertyKind;
  options?: readonly string[];
  icon: Icon;
}

export const BUILTIN_PRESETS: readonly BuiltinPropertyPreset[] = [
  {
    source: 'builtin',
    category: 'name',
    key: 'name',
    labelKey: 'document.properties.commonKey.name',
    kind: 'Text',
    icon: TextTIcon,
  },
  {
    source: 'builtin',
    category: 'description',
    key: 'description',
    labelKey: 'document.properties.commonKey.description',
    kind: 'Text',
    icon: TextAlignLeftIcon,
  },
  {
    source: 'builtin',
    category: 'tags',
    key: 'tags',
    labelKey: 'document.properties.category.tags',
    kind: 'MultiSelect',
    icon: TagIcon,
  },
  {
    source: 'builtin',
    category: 'color',
    key: 'flowix_colors',
    labelKey: 'document.properties.commonKey.color',
    kind: 'MultiSelect',
    icon: PaletteIcon,
  },
  {
    source: 'builtin',
    category: 'icon',
    key: 'flowix_icon',
    labelKey: 'document.properties.category.icon',
    kind: 'Icon',
    icon: SmileyIcon,
  },
  {
    source: 'builtin',
    category: 'favorite',
    key: 'flowix_favorited',
    labelKey: 'document.action.pin',
    kind: 'Select',
    icon: PushPinIcon,
  },
];

function comparablePresetKey(key: string): string {
  return canonicalizePropertyKey(key).toLowerCase();
}

const BUILTIN_PRESET_KEY_SET: ReadonlySet<string> = new Set(
  BUILTIN_PRESETS.map((preset) => comparablePresetKey(preset.key)),
);

export function isBuiltinPresetKey(key: string): boolean {
  return BUILTIN_PRESET_KEY_SET.has(comparablePresetKey(key));
}

export function getBuiltinPresets(labelResolver: (key: I18nKey) => string): PropertyPreset[] {
  return BUILTIN_PRESETS.map((preset) => ({
    ...preset,
    label: labelResolver(preset.labelKey),
  }));
}

export function getCustomPresets(fields: readonly PropertyFieldConfig[]): PropertyPreset[] {
  const seenKeys = new Set(BUILTIN_PRESET_KEY_SET);
  return fields.flatMap((field) => {
    const key = field.key.trim();
    const comparableKey = comparablePresetKey(key);
    if (!key || seenKeys.has(comparableKey)) return [];
    seenKeys.add(comparableKey);
    return [{
      source: 'custom' as const,
      category: 'custom' as const,
      key,
      label: field.name,
      kind: field.type,
      options: field.options,
    }];
  });
}

export function getAllPresets(
  fields: readonly PropertyFieldConfig[],
  labelResolver: (key: I18nKey) => string,
): PropertyPreset[] {
  return [...getBuiltinPresets(labelResolver), ...getCustomPresets(fields)];
}

export function resolvePropertyPreset(
  key: string,
  fields: readonly PropertyFieldConfig[] = [],
  labelResolver?: (key: I18nKey) => string,
): PropertyPreset | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const builtin = BUILTIN_PRESETS.find(
    (preset) => comparablePresetKey(preset.key) === comparablePresetKey(trimmed),
  );
  if (builtin) {
    return {
      ...builtin,
      label: labelResolver?.(builtin.labelKey) ?? builtin.labelKey,
    };
  }
  return getCustomPresets(fields).find(
    (preset) => comparablePresetKey(preset.key) === comparablePresetKey(trimmed),
  ) ?? null;
}
