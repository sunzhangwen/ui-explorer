import type { ElementSnapshot } from "./ipc.js";
import { extractPseudoTableForSelection } from "./pseudoTableExtraction.js";

export type TableSourceKind = "html" | "css-grid" | "flex";
export type TableConfidenceLevel = "high" | "medium" | "low";

export type TableDiagnostic = {
  code: string;
  kind: "evidence" | "warning";
  messageKey: string;
  detail: string;
  scoreDelta: number;
};

export type ExtractedTable = {
  tableId: string;
  caption: string | null;
  headerDepth: number;
  headers: string[];
  rows: string[][];
  records: Record<string, string>[];
  sourceKind: TableSourceKind;
  confidence: number;
  confidenceLevel: TableConfidenceLevel;
  diagnostics: TableDiagnostic[];
};

type RawCell = {
  text: string;
  rowSpan: number;
  columnSpan: number;
  header: boolean;
};

type RawRow = {
  cells: RawCell[];
  section: "thead" | "tbody" | "tfoot" | "table";
};

type GridCell = {
  text: string;
  header: boolean;
};

export function findContainingTable(
  root: ElementSnapshot | null,
  selectedId: string | null
): ElementSnapshot | null {
  if (!root || !selectedId) {
    return null;
  }

  const path: ElementSnapshot[] = [];
  if (!findPath(root, selectedId, path)) {
    return null;
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (!node) {
      continue;
    }
    if (node.kind === "page" || node.kind === "frame" || node.kind === "shadow") {
      break;
    }
    if (node.tagName === "table") {
      return node;
    }
  }
  return null;
}

export function extractTableForSelection(
  root: ElementSnapshot | null,
  selectedId: string | null
): ExtractedTable | null {
  const table = findContainingTable(root, selectedId);
  return table
    ? extractTable(table)
    : extractPseudoTableForSelection(root, selectedId);
}

export function extractTable(table: ElementSnapshot): ExtractedTable {
  if (table.tagName !== "table") {
    throw new Error("Table extraction requires a table element.");
  }

  const rawRows = collectRows(table);
  const grid = expandRows(rawRows);
  const width = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const paddedGrid = grid.map((row) =>
    Array.from({ length: width }, (_, column) => row[column] ?? { text: "", header: false })
  );
  const headerIndexes = getHeaderRowIndexes(rawRows);
  const headerIndexSet = new Set(headerIndexes);
  const headers = buildHeaders(paddedGrid, headerIndexes, width);
  const rows = paddedGrid
    .filter((_row, index) => !headerIndexSet.has(index))
    .map((row) => row.map((cell) => cell.text));

  return {
    tableId: table.id,
    caption: getCaption(table),
    headerDepth: headerIndexes.length,
    headers,
    rows,
    records: rows.map((row) =>
      Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]))
    ),
    sourceKind: "html",
    confidence: 100,
    confidenceLevel: "high",
    diagnostics: []
  };
}

function findPath(node: ElementSnapshot, selectedId: string, path: ElementSnapshot[]): boolean {
  path.push(node);
  if (node.id === selectedId) {
    return true;
  }
  for (const child of node.children) {
    if (findPath(child, selectedId, path)) {
      return true;
    }
  }
  path.pop();
  return false;
}

function collectRows(table: ElementSnapshot): RawRow[] {
  const rows: RawRow[] = [];
  for (const child of table.children) {
    if (child.tagName === "tr") {
      rows.push(readRow(child, "table"));
      continue;
    }
    if (child.tagName === "thead" || child.tagName === "tbody" || child.tagName === "tfoot") {
      for (const row of child.children) {
        if (row.tagName === "tr") {
          rows.push(readRow(row, child.tagName));
        }
      }
    }
  }
  return rows;
}

function readRow(row: ElementSnapshot, section: RawRow["section"]): RawRow {
  return {
    section,
    cells: row.children
      .filter((child) => child.tagName === "th" || child.tagName === "td")
      .map((cell) => ({
        text: getCellText(cell),
        rowSpan: readSpan(cell.attributes.rowspan),
        columnSpan: readSpan(cell.attributes.colspan),
        header: cell.tagName === "th"
      }))
  };
}

function readSpan(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function expandRows(rows: RawRow[]): GridCell[][] {
  const grid: GridCell[][] = [];

  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let columnIndex = 0;

    for (const cell of row.cells) {
      while (grid[rowIndex]?.[columnIndex]) {
        columnIndex += 1;
      }

      for (let rowOffset = 0; rowOffset < cell.rowSpan; rowOffset += 1) {
        const targetRowIndex = rowIndex + rowOffset;
        grid[targetRowIndex] ??= [];
        for (let columnOffset = 0; columnOffset < cell.columnSpan; columnOffset += 1) {
          grid[targetRowIndex]![columnIndex + columnOffset] = {
            text: cell.text,
            header: cell.header
          };
        }
      }
      columnIndex += cell.columnSpan;
    }
  });

  return grid;
}

function getHeaderRowIndexes(rows: RawRow[]): number[] {
  const theadIndexes = rows.flatMap((row, index) => (row.section === "thead" ? [index] : []));
  if (theadIndexes.length > 0) {
    return theadIndexes;
  }

  const indexes: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.cells.length === 0 || row.cells.some((cell) => !cell.header)) {
      break;
    }
    indexes.push(index);
  }
  return indexes;
}

function buildHeaders(grid: GridCell[][], headerIndexes: number[], width: number): string[] {
  const candidates = Array.from({ length: width }, (_, column) => {
    const levels: string[] = [];
    for (const rowIndex of headerIndexes) {
      const text = grid[rowIndex]?.[column]?.text ?? "";
      if (text && levels.at(-1) !== text) {
        levels.push(text);
      }
    }
    return normalizeWhitespace(levels.join(" / ")) || `Column ${column + 1}`;
  });

  const counts = new Map<string, number>();
  return candidates.map((candidate) => {
    const count = (counts.get(candidate) ?? 0) + 1;
    counts.set(candidate, count);
    return count === 1 ? candidate : `${candidate} ${count}`;
  });
}

function getCaption(table: ElementSnapshot): string | null {
  const caption = table.children.find((child) => child.tagName === "caption");
  const text = caption ? normalizeWhitespace(readDescendantText(caption, false)) : "";
  return text || normalizeWhitespace(table.attributes["aria-label"] ?? "") || null;
}

function getCellText(cell: ElementSnapshot): string {
  return normalizeWhitespace(readDescendantText(cell, true));
}

function readDescendantText(node: ElementSnapshot, skipNestedTables: boolean): string {
  const parts = node.text ? [node.text] : [];
  for (const child of node.children) {
    if (skipNestedTables && child.tagName === "table") {
      continue;
    }
    const childText = readDescendantText(child, skipNestedTables);
    if (childText) {
      parts.push(childText);
    }
  }
  return parts.join(" ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
