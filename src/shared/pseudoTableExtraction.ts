import type { ElementSnapshot } from "./ipc.js";
import type {
  ExtractedTable,
  TableConfidenceLevel,
  TableDiagnostic,
  TableSourceKind
} from "./tableExtraction.js";

type CandidateShape = {
  container: ElementSnapshot;
  sourceKind: Exclude<TableSourceKind, "html">;
  rows: ElementSnapshot[][];
  rowNodes: ElementSnapshot[];
  directGrid: boolean;
};

const TABLE_ROLES = new Set(["table", "grid", "treegrid"]);
const ROW_ROLES = new Set(["row"]);
const CELL_ROLES = new Set(["cell", "gridcell", "columnheader", "rowheader"]);

export function extractPseudoTableForSelection(
  root: ElementSnapshot | null,
  selectedId: string | null
): ExtractedTable | null {
  if (!root || !selectedId) {
    return null;
  }
  const path: ElementSnapshot[] = [];
  if (!findPath(root, selectedId, path)) {
    return null;
  }

  let best: ExtractedTable | null = null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (!node) {
      continue;
    }
    if (node.kind === "page" || node.kind === "frame" || node.kind === "shadow") {
      break;
    }
    const shape = buildCandidateShape(node);
    const candidate = shape ? extractCandidate(shape) : null;
    if (candidate && (!best || candidate.confidence > best.confidence)) {
      best = candidate;
    }
  }
  return best;
}

export function getConfidenceLevel(score: number): TableConfidenceLevel {
  if (score >= 80) {
    return "high";
  }
  if (score >= 55) {
    return "medium";
  }
  return "low";
}

function buildCandidateShape(container: ElementSnapshot): CandidateShape | null {
  const display = container.layout?.display;
  const visibleChildren = tableChildren(container);
  if (visibleChildren.length < 2) {
    return null;
  }

  if (display === "grid" || display === "inline-grid") {
    const wrappedRows = visibleChildren.filter(isRowWrapper);
    if (wrappedRows.length === visibleChildren.length) {
      const rows = wrappedRows.map(tableChildren);
      if (hasMinimumShape(rows)) {
        return {
          container,
          sourceKind: "css-grid",
          rows,
          rowNodes: wrappedRows,
          directGrid: false
        };
      }
    }

    const columnCount = readGridColumnCount(container.layout?.gridTemplateColumns ?? "");
    const hasTableSemantics =
      TABLE_ROLES.has(container.role ?? "") ||
      visibleChildren.some((child) => CELL_ROLES.has(child.role ?? ""));
    if (
      columnCount >= 2 &&
      visibleChildren.length >= columnCount * 2 &&
      hasTableSemantics
    ) {
      const rows: ElementSnapshot[][] = [];
      for (let index = 0; index < visibleChildren.length; index += columnCount) {
        rows.push(visibleChildren.slice(index, index + columnCount));
      }
      if (hasMinimumShape(rows)) {
        return {
          container,
          sourceKind: "css-grid",
          rows,
          rowNodes: [],
          directGrid: true
        };
      }
    }
  }

  if (
    (display === "flex" || display === "inline-flex") &&
    container.layout?.flexDirection === "column" &&
    visibleChildren.every(isFlexRow)
  ) {
    const rows = visibleChildren.map(tableChildren);
    if (hasMinimumShape(rows)) {
      return {
        container,
        sourceKind: "flex",
        rows,
        rowNodes: visibleChildren,
        directGrid: false
      };
    }
  }
  return null;
}

function extractCandidate(shape: CandidateShape): ExtractedTable | null {
  const width = Math.max(...shape.rows.map((row) => row.length));
  if (shape.rows.length < 2 || width < 2) {
    return null;
  }

  let score = 30;
  const diagnostics: TableDiagnostic[] = [
    evidence(
      "layout-pattern",
      "table.diagnostic.layoutPattern",
      `${shape.rows.length} repeated ${shape.sourceKind} rows`,
      30
    )
  ];

  const consistent = shape.rows.every((row) => row.length === width);
  if (consistent) {
    score += 25;
    diagnostics.push(
      evidence(
        "consistent-columns",
        "table.diagnostic.consistentColumns",
        `${shape.rows.length} rows each contain ${width} cells`,
        25
      )
    );
  } else {
    score += 10;
    diagnostics.push(
      warning(
        "irregular-columns",
        "table.diagnostic.irregularColumns",
        `Row widths: ${shape.rows.map((row) => row.length).join(", ")}`,
        -15
      )
    );
  }

  if (hasAlignedColumns(shape.rows, width)) {
    score += 20;
    diagnostics.push(
      evidence(
        "column-alignment",
        "table.diagnostic.columnAlignment",
        `${width} geometric columns align across rows`,
        20
      )
    );
  } else {
    diagnostics.push(
      warning(
        "weak-alignment",
        "table.diagnostic.weakAlignment",
        "Cell geometry does not establish stable column positions",
        -20
      )
    );
  }

  if (hasTableSemantics(shape)) {
    score += 15;
    diagnostics.push(
      evidence(
        "semantic-roles",
        "table.diagnostic.semanticRoles",
        "Table, row, or cell roles reinforce the layout pattern",
        15
      )
    );
  } else {
    diagnostics.push(
      warning(
        "missing-semantics",
        "table.diagnostic.missingSemantics",
        "No table-specific ARIA roles were found",
        -15
      )
    );
  }

  const hasHeader = shape.rows[0]?.every((cell) => cell.role === "columnheader") ?? false;
  if (hasHeader) {
    score += 10;
    diagnostics.push(
      evidence(
        "header-evidence",
        "table.diagnostic.headerEvidence",
        "The first row uses columnheader roles",
        10
      )
    );
  } else {
    diagnostics.push(
      warning(
        "ambiguous-header",
        "table.diagnostic.ambiguousHeader",
        "The first row remains data because header evidence is ambiguous",
        -10
      )
    );
  }

  score = Math.max(0, Math.min(100, score));
  if (score < 35) {
    return null;
  }

  const normalizedRows = shape.rows.map((row) =>
    Array.from({ length: width }, (_, column) => readCellText(row[column]))
  );
  const headers = hasHeader
    ? uniqueHeaders(normalizedRows[0] ?? [])
    : Array.from({ length: width }, (_, column) => `Column ${column + 1}`);
  const rows = hasHeader ? normalizedRows.slice(1) : normalizedRows;

  return {
    tableId: shape.container.id,
    caption: normalizeWhitespace(
      shape.container.attributes["aria-label"] ??
        shape.container.attributes["data-table-caption"] ??
        ""
    ) || null,
    headerDepth: hasHeader ? 1 : 0,
    headers,
    rows,
    records: rows.map((row) =>
      Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]))
    ),
    sourceKind: shape.sourceKind,
    confidence: score,
    confidenceLevel: getConfidenceLevel(score),
    diagnostics
  };
}

function isRowWrapper(node: ElementSnapshot): boolean {
  if (ROW_ROLES.has(node.role ?? "")) {
    return tableChildren(node).length >= 1;
  }
  const display = node.layout?.display;
  return (
    tableChildren(node).length >= 1 &&
    (display === "grid" ||
      display === "inline-grid" ||
      ((display === "flex" || display === "inline-flex") &&
        node.layout?.flexDirection !== "column"))
  );
}

function isFlexRow(node: ElementSnapshot): boolean {
  const display = node.layout?.display;
  return (
    tableChildren(node).length >= 1 &&
    (ROW_ROLES.has(node.role ?? "") ||
      ((display === "flex" || display === "inline-flex") &&
        node.layout?.flexDirection !== "column"))
  );
}

function tableChildren(node: ElementSnapshot): ElementSnapshot[] {
  return node.children.filter(
    (child) =>
      child.visible !== false &&
      child.kind !== "diagnostic" &&
      child.kind !== "page" &&
      child.kind !== "frame" &&
      child.kind !== "shadow"
  );
}

function hasMinimumShape(rows: ElementSnapshot[][]): boolean {
  return rows.length >= 2 && rows.some((row) => row.length >= 2);
}

function hasTableSemantics(shape: CandidateShape): boolean {
  return (
    TABLE_ROLES.has(shape.container.role ?? "") ||
    shape.rowNodes.some((row) => ROW_ROLES.has(row.role ?? "")) ||
    shape.rows.flat().some((cell) => CELL_ROLES.has(cell.role ?? ""))
  );
}

function hasAlignedColumns(rows: ElementSnapshot[][], width: number): boolean {
  for (let column = 0; column < width; column += 1) {
    const boxes = rows.flatMap((row) => {
      const box = row[column]?.boundingBox;
      return box ? [box] : [];
    });
    if (boxes.length < 2) {
      return false;
    }
    const positions = boxes.map((box) => box.x);
    const tolerance = Math.max(
      4,
      boxes.reduce((total, box) => total + box.width, 0) / boxes.length / 10
    );
    if (Math.max(...positions) - Math.min(...positions) > tolerance) {
      return false;
    }
  }
  return true;
}

function readGridColumnCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") {
    return 0;
  }
  const repeat = /^repeat\(\s*(\d+)\s*,/.exec(trimmed);
  if (repeat?.[1]) {
    return Number.parseInt(repeat[1], 10);
  }
  return splitCssTracks(trimmed).length;
}

function splitCssTracks(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (current) {
        tracks.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) {
    tracks.push(current);
  }
  return tracks;
}

function readCellText(node: ElementSnapshot | undefined): string {
  if (!node) {
    return "";
  }
  const parts = node.text ? [node.text] : [];
  for (const child of node.children) {
    if (
      child.kind === "diagnostic" ||
      child.kind === "page" ||
      child.kind === "frame" ||
      child.kind === "shadow" ||
      child.tagName === "table"
    ) {
      continue;
    }
    const text = readCellText(child);
    if (text) {
      parts.push(text);
    }
  }
  return normalizeWhitespace(parts.join(" "));
}

function uniqueHeaders(values: string[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value, column) => {
    const candidate = normalizeWhitespace(value) || `Column ${column + 1}`;
    const count = (counts.get(candidate) ?? 0) + 1;
    counts.set(candidate, count);
    return count === 1 ? candidate : `${candidate} ${count}`;
  });
}

function evidence(
  code: string,
  messageKey: string,
  detail: string,
  scoreDelta: number
): TableDiagnostic {
  return { code, kind: "evidence", messageKey, detail, scoreDelta };
}

function warning(
  code: string,
  messageKey: string,
  detail: string,
  scoreDelta: number
): TableDiagnostic {
  return { code, kind: "warning", messageKey, detail, scoreDelta };
}

function findPath(
  node: ElementSnapshot,
  selectedId: string,
  path: ElementSnapshot[]
): boolean {
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
