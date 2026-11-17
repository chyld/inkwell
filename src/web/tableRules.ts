// Header cells only in a table's first row, as the validator requires (SPEC 6.2, DEVIATIONS 5). Some edits put them
// lower: "Row above" on the header row, or header cells pasted into a lower row; the server would then refuse every
// save. A rule applied to every change turns such cells into plain cells (BUGFIX-LIST item 5).
import { Extension } from '@tiptap/core';
import { Plugin, type Transaction } from '@tiptap/pm/state';

export const HeaderCellsInFirstRow = Extension.create({
  name: 'headerCellsInFirstRow',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return true;
            node.forEach((row, rowOffset, rowIndex) => {
              if (rowIndex === 0) return;
              row.forEach((cell, cellOffset) => {
                if (cell.type.name !== 'tableHeader') return;
                tr ??= state.tr;
                // Same size, so the other positions stay valid.
                tr.setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, state.schema.nodes.tableCell, cell.attrs, cell.marks);
              });
            });
            return true; // tables inside cells too
          });
          return tr;
        },
      }),
    ];
  },
});
