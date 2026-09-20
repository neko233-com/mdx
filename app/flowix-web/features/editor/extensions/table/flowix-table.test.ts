import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { afterEach, describe, expect, it } from 'vitest';

import { TablePlugin } from '@features/editor/extensions/table/table-plugin';

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const editor = new Editor({
    extensions: [StarterKit, TablePlugin, Markdown],
    content,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
});

describe('Flowix table column widths', () => {
  it('restores hidden column widths from Markdown metadata', () => {
    const editor = createEditor([
      '<!-- flowix:table {"version":1,"columns":[{"width":120},{"width":240}]} -->',
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | Beta |',
    ].join('\n'));

    const table = editor.state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.firstChild?.firstChild?.attrs.colwidth).toEqual([120]);
    expect(table?.firstChild?.child(1).attrs.colwidth).toEqual([240]);
  });

  it('serializes restored widths back to metadata', () => {
    const editor = createEditor([
      '<!-- flowix:table {"version":1,"columns":[{"width":120},{"width":null}]} -->',
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | Beta |',
    ].join('\n'));

    expect(editor.getMarkdown()).toContain('<!-- flowix:table {"version":1,"columns":[{"width":120},{"width":null}]} -->');
  });

  it('keeps reading the legacy width metadata', () => {
    const editor = createEditor([
      '<!-- flowix:table-widths=120,240 -->',
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | Beta |',
    ].join('\n'));

    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([120]);
    expect(editor.getMarkdown()).toContain('<!-- flowix:table {"version":1,"columns":[{"width":120},{"width":240}]} -->');
    expect(editor.getMarkdown()).not.toContain('flowix:table-widths=');
  });

  it('keeps tables without width metadata compatible', () => {
    const editor = createEditor([
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | Beta |',
    ].join('\n'));

    expect(editor.state.doc.firstChild?.type.name).toBe('table');
    expect(editor.getMarkdown()).not.toContain('flowix:table-widths=');
  });

  it('distinguishes a missing row header from a column header', () => {
    const editor = createEditor([
      '<!-- flowix:table {"version":1,"columns":[{"width":null},{"width":null}],"rowHeader":false,"columnHeader":true} -->',
      '|  |  |',
      '| --- | --- |',
      '| Name | Value |',
      '| Alpha | 1 |',
    ].join('\n'));

    const table = editor.state.doc.firstChild;
    expect(table?.firstChild?.firstChild?.type.name).toBe('tableHeader');
    expect(table?.firstChild?.firstChild?.textContent).toBe('Name');
    expect(table?.child(1).firstChild?.type.name).toBe('tableHeader');
    expect(table?.child(1).firstChild?.textContent).toBe('Alpha');
    expect(editor.getMarkdown()).toContain('"rowHeader":false');
    expect(editor.getMarkdown()).toContain('"columnHeader":true');
  });

  it('preserves a table after its header row is removed', () => {
    const editor = createEditor([
      '<!-- flowix:table {"version":1,"columns":[{"width":null},{"width":null}],"rowHeader":false} -->',
      '|  |  |',
      '| --- | --- |',
      '| Alpha | Beta |',
    ].join('\n'));

    const table = editor.state.doc.firstChild;
    expect(table?.firstChild?.firstChild?.type.name).toBe('tableCell');
    expect(table?.firstChild?.firstChild?.textContent).toBe('Alpha');
    expect(editor.getMarkdown()).toContain('"rowHeader":false');
  });
});
