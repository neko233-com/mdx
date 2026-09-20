import { Extension } from '@tiptap/core';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';

import { createTableEdgeInsertPlugin } from '@features/editor/extensions/table/table-edge-insert-plugin';
import { FlowixTable } from '@features/editor/extensions/table/flowix-table';

const TABLE_RESIZE_HANDLE_WIDTH = 8;
const TABLE_CELL_MIN_WIDTH = 80;

export const TablePlugin = Extension.create({
  name: 'tablePlugin',

  addExtensions() {
    return [
      FlowixTable.configure({
        resizable: true,
        handleWidth: TABLE_RESIZE_HANDLE_WIDTH,
        cellMinWidth: TABLE_CELL_MIN_WIDTH,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ];
  },

  addProseMirrorPlugins() {
    return [createTableEdgeInsertPlugin(this.editor)];
  },
});
