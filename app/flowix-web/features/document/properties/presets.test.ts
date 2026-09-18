import { describe, expect, it } from 'vitest';

import type { PropertyFieldConfig } from '@/lib/constants';
import {
  getAllPresets,
  getCustomPresets,
  isBuiltinPresetKey,
  PROPERTY_KINDS,
  resolvePropertyPreset,
} from './presets';
import {
  convertRowValue,
  rowsFromData,
} from '@features/document/components/note-properties/property-row-model';

const label = (key: string) => key;

describe('property preset runtime model', () => {
  const fields: PropertyFieldConfig[] = [
    { key: 'priority', name: '优先级', type: 'Select', options: ['高', '低'] },
    { key: 'labels', name: '标签组', type: 'MultiSelect', options: ['前端', '后端'] },
    { key: 'archived', name: '是否归档', type: 'Boolean' },
  ];

  it('exposes custom presets with the same shape as built-ins', () => {
    expect(getCustomPresets(fields)).toEqual([
      {
        source: 'custom',
        category: 'custom',
        key: 'priority',
        label: '优先级',
        kind: 'Select',
        options: ['高', '低'],
      },
      {
        source: 'custom',
        category: 'custom',
        key: 'labels',
        label: '标签组',
        kind: 'MultiSelect',
        options: ['前端', '后端'],
      },
      {
        source: 'custom',
        category: 'custom',
        key: 'archived',
        label: '是否归档',
        kind: 'Boolean',
        options: undefined,
      },
    ]);
    expect(getAllPresets(fields, label).find((preset) => preset.key === 'priority'))
      .toMatchObject({ source: 'custom', label: '优先级', kind: 'Select' });
  });

  it('keeps built-in keys authoritative over conflicting custom settings', () => {
    expect(isBuiltinPresetKey('NAME')).toBe(true);
    expect(isBuiltinPresetKey('tag')).toBe(true);
    expect(getCustomPresets([
      { key: 'name', name: '自定义名称', type: 'Text' },
      { key: 'TAG', name: '自定义标签', type: 'Text' },
      { key: 'Priority', name: '优先级', type: 'Number' },
      { key: 'priority', name: '重复优先级', type: 'Text' },
    ])).toEqual([
      {
        source: 'custom',
        category: 'custom',
        key: 'Priority',
        label: '优先级',
        kind: 'Number',
        options: undefined,
      },
    ]);
    expect(resolvePropertyPreset('name', [
      { key: 'name', name: '自定义名称', type: 'Number' },
    ], label)).toMatchObject({ source: 'builtin', key: 'name' });
  });

  it('uses custom kind and options when materializing note rows', () => {
    const rows = rowsFromData(
      { priority: '高', labels: ['前端'], archived: true },
      new Map(fields.map((field) => [field.key, field])),
      label,
    );

    expect(rows.map((row) => [row.key, row.preset?.label, row.type])).toEqual([
      ['priority', '优先级', 'Select'],
      ['labels', '标签组', 'MultiSelect'],
      ['archived', '是否归档', 'Boolean'],
    ]);
    expect(rows[0]?.preset?.options).toEqual(['高', '低']);
    expect(rows[1]?.preset?.options).toEqual(['前端', '后端']);
    expect(convertRowValue(rows[2]!)).toBe(true);
  });

  it('does not expose URL as a configurable custom type', () => {
    expect(PROPERTY_KINDS).not.toContain('URL');
  });
});
