import type { ExtractedTable } from "./tableExtraction.js";

export type TableSelection = {
  rowIndexes: number[];
  columnIndexes: number[];
};

export function createFullTableSelection(table: ExtractedTable): TableSelection {
  return {
    rowIndexes: table.rows.map((_row, index) => index),
    columnIndexes: table.headers.map((_header, index) => index)
  };
}

export function applyTableSelection(
  table: ExtractedTable,
  selection: TableSelection
): ExtractedTable {
  const rowIndexSet = boundedIndexSet(selection.rowIndexes, table.rows.length);
  const columnIndexSet = boundedIndexSet(
    selection.columnIndexes,
    table.headers.length
  );
  const rowIndexes = table.rows.flatMap((_row, index) =>
    rowIndexSet.has(index) ? [index] : []
  );
  const columnIndexes = table.headers.flatMap((_header, index) =>
    columnIndexSet.has(index) ? [index] : []
  );
  const headers = columnIndexes.map((index) => table.headers[index] ?? "");
  const rows =
    columnIndexes.length === 0
      ? []
      : rowIndexes.map((rowIndex) =>
          columnIndexes.map(
            (columnIndex) => table.rows[rowIndex]?.[columnIndex] ?? ""
          )
        );

  return {
    ...table,
    headers,
    rows,
    records: rows.map((row) =>
      Object.fromEntries(
        headers.map((header, column) => [header, row[column] ?? ""])
      )
    )
  };
}

function boundedIndexSet(indexes: number[], upperBound: number): Set<number> {
  return new Set(
    indexes.filter(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < upperBound
    )
  );
}
