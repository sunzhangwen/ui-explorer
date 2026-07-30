# Phase 7 Advanced Table Extraction Design

**Date:** 2026-07-30

**Status:** Approved for implementation planning

## Context

Phase 4 established standard HTML table extraction, merged-cell expansion, multi-level header normalization, virtualized previews, and CSV/JSON/Markdown export. Phase 6 then established one stitched snapshot model for page, iframe, open Shadow DOM, and OOPIF content.

Phase 7 extends that foundation with:

- explicit row and column selection;
- export-range preview;
- usable Excel `.xlsx` workbooks;
- explainable CSS Grid/Flex pseudo-table recognition;
- consistent behavior across page, iframe, open Shadow DOM, and OOPIF contexts;
- representative large-table validation.

The selected product defaults are:

- row and column checkboxes rather than continuous ranges or conditional filters;
- every row and column selected initially;
- automatic pseudo-table recognition with visible confidence and diagnostics;
- usable Excel workbooks with a styled header, frozen header row, automatic filters, and practical column widths.

## Goals

1. Let users include or exclude arbitrary rows and columns while preserving source order.
2. Make the visible export preview and every saved format consume the same selected table.
3. Export selected data as CSV, JSON, Markdown, or a usable `.xlsx` workbook.
4. Recognize representative Grid and Flex pseudo-tables without silently misclassifying ordinary layouts.
5. Explain pseudo-table confidence through positive evidence, penalties, and uncertainty.
6. Reuse the stitched snapshot model so extraction does not create a second frame, Shadow DOM, or OOPIF routing path.
7. Keep extraction, recognition, filtering, and request validation deterministic and unit-testable.

## Non-Goals

Phase 7 does not add:

- conditional value filters;
- sorting;
- continuous spreadsheet-style range gestures;
- multiple-table joins;
- workbook import;
- multiple worksheets;
- source-page style reproduction;
- merged-cell reconstruction in Excel;
- arbitrary browser-side JavaScript execution;
- persistence of table selections across snapshots or application restarts.

## Architecture Decision

Use lightweight snapshot layout metadata, shared pure recognition functions, and main-process Excel generation.

The rejected alternatives are:

1. On-demand CDP extraction after selection. This keeps ordinary snapshots smaller but adds asynchronous stale-state handling, session routing, and a second context error path.
2. Full extraction inside the injected browser script. This has direct DOM access but hides behavioral logic inside a generated script string and splits standard and pseudo tables into separate pipelines.

The chosen approach adds only serializable layout facts to `ElementSnapshot`. Shared code interprets those facts and produces the canonical table model. This naturally reuses Phase 6 snapshot stitching and keeps the behavior testable without a live browser.

## Snapshot Layout Metadata

`ElementSnapshot` gains an optional `layout` object:

```ts
export type ElementLayoutSnapshot = {
  display: string;
  flexDirection: string;
  gridTemplateColumns: string;
  rowGap: string;
  columnGap: string;
};
```

The browser snapshot script reads these values from `getComputedStyle`. It does not decide whether an element is a table.

Existing `boundingBox` values provide geometric evidence. Recognition compares elements only inside the selected element's current page, frame, or Shadow boundary. It does not group nodes across a context boundary.

The multi-session snapshot stitcher preserves layout metadata without interpreting it. Namespacing and context paths continue to identify OOPIF nodes.

## Canonical Table Model

Standard and pseudo tables both produce `ExtractedTable`. The model adds source and recognition information:

```ts
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
```

Standard HTML tables have `sourceKind: "html"`, confidence `100`, and level `high`. Existing span expansion and header normalization remain unchanged.

Pseudo-table diagnostics use stable codes and i18n message keys. User-visible labels and explanations are translated in both `zh-CN` and `en-US`; technical codes remain untranslated.

## Recognition Pipeline

Recognition starts from the selected element and walks upward within the same context:

1. Return the nearest standard `<table>` immediately.
2. Evaluate ancestors whose computed display and child structure match a supported Grid or Flex pattern.
3. Keep the highest-scoring candidate at or above the minimum display threshold.
4. Extract the candidate into the canonical table model.

Phase 7 supports:

- a Grid container with directly arranged cells;
- a Grid container with repeated row wrappers;
- a column-oriented Flex container with repeated row-oriented Flex children.

A candidate must form at least two rows and two columns. Hidden children are excluded. Nested tables and candidates that cross a frame or Shadow boundary are excluded.

### Confidence Score

The score is clamped to 0–100:

| Evidence | Maximum contribution |
|---|---:|
| Recognizable repeated Grid/Flex layout | 30 |
| Consistent cell count across rows | 25 |
| Stable geometric column alignment | 20 |
| ARIA table/grid/row/cell/columnheader semantics | 15 |
| Reliable header evidence | 10 |

Penalties cover:

- irregular row lengths;
- weak column alignment;
- interrupted nested structure;
- excessive empty cells;
- missing semantic evidence;
- ambiguous header inference.

Confidence levels are:

- `high`: 80–100;
- `medium`: 55–79;
- `low`: 35–54.

Candidates below 35 are not presented as tables. Low-confidence candidates remain available because automatic recognition was selected, but the UI must show a prominent false-positive warning and the diagnostic evidence.

### Header Inference

Header inference is deliberately conservative:

1. Prefer explicit `columnheader` roles and equivalent table semantics.
2. Accept the first row when it has stable, strong type or semantic differences from subsequent rows.
3. Otherwise synthesize `Column 1`, `Column 2`, and so on, and retain the first row as data.

This avoids silently dropping data when an ordinary repeated layout has no reliable header.

## Row and Column Selection

Selection is local state owned by `TableDataPanel`. It is not stored in Zustand because it is derived, transient UI state.

```ts
export type TableSelection = {
  rowIndexes: number[];
  columnIndexes: number[];
};
```

Every row and column starts selected. A shared pure function applies selection to the canonical table:

```ts
export function applyTableSelection(
  table: ExtractedTable,
  selection: TableSelection
): ExtractedTable;
```

The function:

- normalizes duplicate and out-of-range indexes;
- preserves original row and column order;
- rebuilds `records` from the selected headers and rows;
- preserves source, confidence, caption, and diagnostics;
- returns an empty export range when either dimension is empty.

Changing the selected descendant inside one table preserves selection. Changing tables or receiving a new snapshot resets selection to the default full range.

## Table Panel Interaction

The existing table panel remains the single place for extraction and export.

Its summary shows:

- source type;
- confidence badge for pseudo tables;
- selected rows versus total rows;
- selected columns versus total columns;
- header depth.

The source grid adds:

- one sticky checkbox column for rows;
- one checkbox in each column header;
- select-all and clear actions for rows;
- select-all and clear actions for columns.

Unselected source rows and columns remain visible but visually muted so they can be re-enabled. The export preview below the grid contains only selected data.

If no row or no column is selected:

- the source grid remains interactive;
- the export preview shows a translated empty-range message;
- copy and save actions are disabled.

The virtualized source grid continues to render only the visible row window. Selection state is index-based and does not require rendering every row.

## Export Formats

CSV, JSON, and Markdown continue to use the existing text-generation and save path. Their inputs change from the source table to the selected table.

Excel is added to `TABLE_EXPORT_FORMATS`, but it is binary and does not use Monaco:

- the Excel tab shows a workbook summary;
- copy is unavailable for Excel;
- save sends structured selected table data through IPC.

All four formats preserve the selected row order and selected column order shown in the export preview.

## Excel Workbook

The Electron main process uses ExcelJS to create one `.xlsx` worksheet. ExcelJS is selected because the Phase 7 workbook requires header styling, frozen views, automatic filters, and column widths.

Workbook rules:

- use the table caption as the worksheet name when available;
- remove invalid worksheet-name characters and limit the name to 31 characters;
- fall back to `Table`;
- write all extracted values as strings to preserve leading zeros and long identifiers;
- add a bold header row with a theme-token-compatible solid fill and readable foreground;
- freeze the first row;
- apply an automatic filter to the complete selected range;
- estimate width from the header and cell strings;
- clamp each column width to 12–48 characters.

The suggested file name continues to use the current base-name sanitizer. The file helper adds `.xlsx` when required.

## IPC Contract and Validation

`TableExportSaveRequest` becomes a discriminated union:

```ts
export type TableTextExportSaveRequest = {
  format: "csv" | "json" | "markdown";
  content: string;
  suggestedBaseName: string;
};

export type TableExcelExportSaveRequest = {
  format: "xlsx";
  table: {
    caption: string | null;
    headers: string[];
    rows: string[][];
  };
  suggestedBaseName: string;
};

export type TableExportSaveRequest =
  | TableTextExportSaveRequest
  | TableExcelExportSaveRequest;
```

The main process validates requests again across the context-isolated IPC boundary:

- the format matches the corresponding payload shape;
- the suggested base name is a string;
- headers and every cell are strings;
- at least one row and one column are selected for Excel;
- every row has the same width as the headers.

Invalid input returns `{ status: "error" }` without opening a save dialog. Dialog cancellation returns `{ status: "cancelled" }`. Workbook generation and file-write errors return the existing structured error result.

## Error and Ambiguity Handling

- A malformed or incomplete layout candidate is ignored instead of throwing into the Renderer.
- An ordinary Grid/Flex layout below score 35 remains an ordinary selected element.
- Medium and low confidence always display their explanations.
- Missing reliable header evidence produces synthetic headers and a warning diagnostic.
- Snapshot refresh and session detachment continue to use the existing stale-context rules; Phase 7 does not create another live DOM reference.
- Closed Shadow DOM and unattached OOPIF content retain their existing context diagnostics and cannot be reported as successfully extracted.

## File Responsibilities

Expected implementation boundaries are:

- `src/shared/ipc.ts`: layout snapshot and discriminated IPC contracts.
- `src/main/browserScripts.ts`: computed-layout fact capture only.
- `src/shared/tableExtraction.ts`: canonical standard-table extraction and orchestration entry point.
- `src/shared/pseudoTableExtraction.ts`: Grid/Flex candidate construction, scoring, diagnostics, and extraction.
- `src/shared/tableSelection.ts`: default selection and pure range application.
- `src/shared/tableExport.ts`: selected-table CSV/JSON/Markdown output and format guards.
- `src/shared/tableFile.ts`: format labels, extensions, and text preparation.
- `src/main/tableWorkbook.ts`: validated ExcelJS workbook generation.
- `src/main/main.ts`: save dialog, request validation, and text/binary write dispatch.
- `src/renderer/components/WorkbenchLayout.tsx`: table selection and export interaction.
- `src/renderer/components/workbenchPresentation.ts`: pure UI summaries and confidence presentation.
- `src/renderer/i18n/messages.ts`: Chinese and English table selection, confidence, diagnostic, and Excel messages.
- `src/renderer/styles/global.css`: checkbox grid, muted selection, confidence, and workbook-summary styles.
- `public/test-pages/`: representative Grid, Flex, false-positive, large-table, iframe, Shadow, and OOPIF fixtures.

## Testing Strategy

Behavior-dense table logic uses RED/GREEN.

### Shared Unit Tests

Cover:

- standard HTML regression behavior;
- high-confidence direct Grid cells;
- high-confidence Grid row wrappers;
- high-confidence Flex rows;
- medium- and low-confidence diagnostics;
- ordinary card Grid false-positive suppression;
- minimum 2-by-2 rejection;
- conservative header inference;
- context-boundary isolation;
- arbitrary row and column combinations;
- duplicate and invalid selection indexes;
- empty ranges;
- order consistency across CSV, JSON, and Markdown.

### Browser and Context Tests

Cover:

- layout metadata serialization;
- preservation through snapshot stitching and namespacing;
- equivalent extraction in page, iframe, open Shadow DOM, and OOPIF snapshots;
- unavailable context diagnostics remaining non-extractable.

### Workbook Tests

Generate a workbook buffer and read it back with ExcelJS to assert:

- exact header and cell strings;
- selected order;
- leading-zero preservation;
- worksheet-name sanitization;
- frozen first row;
- automatic filter range;
- header style;
- clamped column widths.

### UI and IPC Tests

Cover pure presentation and request-validation helpers for:

- selected/total counts;
- confidence labels;
- empty-range action disabling;
- Excel summary;
- rejection of malformed or mismatched IPC payloads.

### Fixtures and Manual Acceptance

Add representative fixtures for:

- standard HTML table;
- direct-cell CSS Grid table;
- wrapped-row CSS Grid table;
- Flex table;
- ordinary card Grid that must not be silently reported as a table;
- a large table used to validate virtual scrolling and export;
- equivalent tables inside iframe, open Shadow DOM, and OOPIF content.

Final verification runs:

```powershell
npm test
npm run typecheck
npm run build
```

Manual acceptance confirms:

1. Every row and column is initially selected.
2. Arbitrary row and column combinations update the preview.
3. CSV, JSON, Markdown, and Excel preserve the visible selected order.
4. Excel opens with the expected header style, frozen row, filter, and widths.
5. High-confidence Grid/Flex fixtures are recognized.
6. Ordinary Grid/Flex fixtures are not silently misreported.
7. Low-confidence results show evidence and false-positive warnings.
8. Page, iframe, Shadow DOM, and OOPIF extraction use the same model.
9. Large-table scrolling remains virtualized and responsive.

## Acceptance Mapping

| Phase 7 requirement | Design coverage |
|---|---|
| 7.1 row/column selection and range preview | Local selection state, shared selection function, muted source grid, selected export preview |
| 7.2 Excel `.xlsx` export | ExcelJS main-process workbook and binary save path |
| 7.3 Grid/Flex pseudo-table recognition | Supported patterns and shared recognizer |
| 7.4 confidence, evidence, and false-positive diagnostics | Scoring model, thresholds, stable diagnostics, translated presentation |
| 7.5 iframe/Shadow/OOPIF consistency | Snapshot metadata plus existing stitched context model |
| 7.6 large-table performance validation | Virtualized source grid and representative large fixture |

