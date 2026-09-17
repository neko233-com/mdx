import { canonicalizePropertyKey } from './property-key';
import {
  PROPERTY_KINDS,
  resolvePreset,
  type PropertyKind,
} from './presets';

export type PropertyDisplayKind =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'boolean'
  | 'array'
  | 'list'
  | 'icon';

export interface ResolvedPropertyType {
  kind: PropertyKind;
  displayKind: PropertyDisplayKind;
}

export const FIXED_PROPERTY_KINDS: Readonly<Record<string, PropertyKind>> = {
  name: 'Text',
  description: 'Text',
  tags: 'MultiSelect',
  flowix_colors: 'MultiSelect',
  flowix_icon: 'Icon',
};

export const PROPERTY_URL_RE = /^https?:\/\/\S+$/i;
export const PROPERTY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inferValueKind(value: unknown, isFlowSequence: boolean): PropertyKind {
  if (typeof value === 'boolean') return 'Select';
  if (Array.isArray(value)) return isFlowSequence ? 'MultiSelect' : 'List';
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'string' && PROPERTY_DATE_RE.test(value)) return 'Date';
  if (typeof value === 'string' && PROPERTY_URL_RE.test(value)) return 'URL';
  return 'Text';
}

function toDisplayKind(kind: PropertyKind, value: unknown): PropertyDisplayKind {
  switch (kind) {
    case 'Number':
      return 'number';
    case 'Date':
      return 'date';
    case 'URL':
      return 'url';
    case 'Icon':
      return 'icon';
    case 'Select':
      return typeof value === 'boolean' ? 'boolean' : 'text';
    case 'MultiSelect':
      return 'array';
    case 'List':
      return 'list';
    case 'Text':
    default:
      return 'text';
  }
}

export function resolvePropertyType(
  key: string,
  value: unknown,
  isFlowSequence = false,
): ResolvedPropertyType {
  const canonicalKey = canonicalizePropertyKey(key);
  const kind = FIXED_PROPERTY_KINDS[canonicalKey]
    ?? resolvePreset(canonicalKey)?.kind
    ?? inferValueKind(value, isFlowSequence);

  return {
    kind,
    displayKind: toDisplayKind(kind, value),
  };
}

export { PROPERTY_KINDS };
