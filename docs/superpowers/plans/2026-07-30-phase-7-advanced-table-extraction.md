# Phase 7 Advanced Table Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add row/column selection, usable `.xlsx` export, and explainable CSS Grid/Flex pseudo-table extraction across the existing unified web-context snapshot model.

**Architecture:** Extend snapshots with layout facts but keep recognition in shared pure functions. Normalize HTML and pseudo tables into one `ExtractedTable`, apply a shared selection transform before every export, and generate binary Excel workbooks only in the Electron main process.

**Tech Stack:** Electron 33, React 18, TypeScript 5.7, Node test runner, Zustand, ExcelJS, CDP-injected JavaScript, CSS.

## Global Constraints

- Preserve the completed Phase 4 HTML table behavior and Phase 6 page/iframe/Shadow/OOPIF context model.
- Default every detected table to all rows and all columns selected.
- Automatically show pseudo-table candidates scoring at least 35, with translated evidence and warnings.
- Confidence bands are high `80–100`, medium `55–79`, and low `35–54`.
- Do not add conditional filtering, sorting, multi-sheet export, workbook import, or page-style reproduction.
- Keep transient selection in `TableDataPanel`; do not persist it in Zustand.
- All user-visible copy must have `zh-CN` and `en-US` entries.
- Do not modify generated directories: `dist/`, `dist-electron/`, `.vite/`, or `.tmp-tests/`.

---

### Task 1: Capture Layout Facts in Unified Snapshots

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/browserScripts.ts`
- Modify: `src/main/browserScripts.test.ts`
- Modify: `src/main/multiSessionSnapshot.test.ts`

**Interfaces:**
- Produces: `ElementLayoutSnapshot` and optional `ElementSnapshot.layout`.
- Consumes: existing `SNAPSHOT_SCRIPT`, `ElementSnapshot`, and multi-session namespacing.

- [x] **Step 1: Write failing snapshot tests**

Execute `SNAPSHOT_SCRIPT` in the existing VM harness with one controlled element whose
`getComputedStyle` result is:

```ts
{
  display: "grid",
  flexDirection: "row",
  gridTemplateColumns: "100px 100px",
  rowGap: "4px",
  columnGap: "8px",
  visibility: "visible",
  opacity: "1"
}
```

Assert the observable snapshot result:

```ts
assert.deepEqual(normalizeVmValue(result.root?.layout), {
  display: "grid",
  flexDirection: "row",
  gridTemplateColumns: "100px 100px",
  rowGap: "4px",
  columnGap: "8px"
});
```

Extend the multi-session fixture with:

```ts
layout: {
  display: "grid",
  flexDirection: "row",
  gridTemplateColumns: "100px 100px",
  rowGap: "4px",
  columnGap: "8px"
}
```

and assert that the namespaced stitched node retains the same object.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="layout metadata"
```

Expected: FAIL because `ElementSnapshot.layout` and script serialization do not exist.

- [x] **Step 3: Add the layout contract and serialization**

Add:

```ts
export type ElementLayoutSnapshot = {
  display: string;
  flexDirection: string;
  gridTemplateColumns: string;
  rowGap: string;
  columnGap: string;
};
```

Add `layout?: ElementLayoutSnapshot` to `ElementSnapshot`. In `SNAPSHOT_SCRIPT`, reuse `getComputedStyle` through a `layoutFor(element)` helper and assign `layout` to element nodes only.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- --test-name-pattern="layout metadata"
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/shared/ipc.ts src/main/browserScripts.ts src/main/browserScripts.test.ts src/main/multiSessionSnapshot.test.ts
git commit -m "feat: capture table layout metadata"
```

---

### Task 2: Recognize and Normalize Grid/Flex Pseudo Tables

**Files:**
- Create: `src/shared/pseudoTableExtraction.ts`
- Create: `src/shared/pseudoTableExtraction.test.ts`
- Modify: `src/shared/tableExtraction.ts`
- Modify: `src/shared/tableExtraction.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: `ElementSnapshot.layout`, `ElementSnapshot.boundingBox`, roles, text, and context boundaries.
- Produces: `extractPseudoTableForSelection(root, selectedId)` and the enriched canonical `ExtractedTable`.

- [x] **Step 1: Enrich existing HTML expectations**

Update HTML table fixtures to expect:

```ts
{
  sourceKind: "html",
  confidence: 100,
  confidenceLevel: "high",
  diagnostics: []
}
```

Run `npm test -- --test-name-pattern="expands grouped headers"` and verify it fails before adding the fields.

- [x] **Step 2: Define the canonical recognition types**

Add to `tableExtraction.ts`:

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
```

Extend `ExtractedTable` with these fields and emit the HTML defaults.

- [x] **Step 3: Write failing pseudo-table tests**

Build snapshot fixtures for:

```ts
directGrid(["Name", "Status"], [["Alpha", "Ready"], ["Beta", "Blocked"]]);
wrappedGrid(["Name", "Count"], [["A", "10"], ["B", "20"]]);
flexRows(["Region", "Owner"], [["East", "Ana"], ["West", "Bo"]]);
ordinaryCardGrid();
irregularGrid();
```

Assert:

- direct Grid and wrapped Grid extract with `sourceKind: "css-grid"`;
- Flex rows extract with `sourceKind: "flex"`;
- strong fixtures score at least 80;
- an irregular but rectangular candidate reports a warning at medium or low confidence;
- ordinary cards and structures below 2-by-2 return `null`;
- selection cannot climb past a `page`, `frame`, or `shadow` boundary;
- missing header evidence produces `Column 1` and keeps the first row as data.

- [x] **Step 4: Run pseudo-table tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="pseudo table|Grid|Flex|false positive"
```

Expected: FAIL because the recognizer is absent.

- [x] **Step 5: Implement candidate construction and scoring**

Create:

```ts
export function extractPseudoTableForSelection(
  root: ElementSnapshot | null,
  selectedId: string | null
): ExtractedTable | null;

export function getConfidenceLevel(score: number): TableConfidenceLevel;
```

Implement supported direct-Grid, wrapped-Grid, and Flex-row shapes. Use stable diagnostic codes:

```ts
"layout-pattern"
"consistent-columns"
"column-alignment"
"semantic-roles"
"header-evidence"
"irregular-columns"
"weak-alignment"
"missing-semantics"
"ambiguous-header"
```

Clamp scores and reject candidates below 35.

- [x] **Step 6: Route the public extraction entry point**

Make `extractTableForSelection` return the nearest HTML table first and otherwise call `extractPseudoTableForSelection`.

- [x] **Step 7: Run focused and Phase 4 regression tests**

Run:

```powershell
npm test -- --test-name-pattern="table|Grid|Flex"
```

Expected: PASS, including existing merged-cell and nested-table tests.

- [x] **Step 8: Commit**

```powershell
git add src/shared/tableExtraction.ts src/shared/tableExtraction.test.ts src/shared/pseudoTableExtraction.ts src/shared/pseudoTableExtraction.test.ts tsconfig.test.json
git commit -m "feat: recognize Grid and Flex pseudo tables"
```

---

### Task 3: Apply Row and Column Selection to Every Text Export

**Files:**
- Create: `src/shared/tableSelection.ts`
- Create: `src/shared/tableSelection.test.ts`
- Modify: `src/shared/tableExport.ts`
- Modify: `src/shared/tableExport.test.ts`
- Modify: `src/shared/tableFile.ts`
- Modify: `src/shared/tableFile.test.ts`

**Interfaces:**
- Consumes: canonical `ExtractedTable`.
- Produces: `TableSelection`, `createFullTableSelection`, `applyTableSelection`, and text-only export format guards.

- [x] **Step 1: Write failing selection tests**

Assert:

```ts
createFullTableSelection(table)
// => { rowIndexes: [0, 1], columnIndexes: [0, 1, 2] }

applyTableSelection(table, {
  rowIndexes: [1, 1, 99],
  columnIndexes: [2, 0, -1]
})
```

returns the second row with columns in original order `[0, 2]`, rebuilds records, and preserves recognition metadata. Also assert empty rows or empty columns produce an empty export range.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="table selection"
```

Expected: FAIL because `tableSelection.ts` does not exist.

- [x] **Step 3: Implement the pure selection transform**

Create:

```ts
export type TableSelection = {
  rowIndexes: number[];
  columnIndexes: number[];
};

export function createFullTableSelection(table: ExtractedTable): TableSelection;

export function applyTableSelection(
  table: ExtractedTable,
  selection: TableSelection
): ExtractedTable;
```

Normalize indexes through a bounded `Set`, then iterate source indexes so source order always wins.

- [x] **Step 4: Separate text and file format guards**

Use:

```ts
export const TABLE_TEXT_EXPORT_FORMATS = ["csv", "json", "markdown"] as const;
export const TABLE_EXPORT_FORMATS = [...TABLE_TEXT_EXPORT_FORMATS, "xlsx"] as const;
export type TableTextExportFormat = (typeof TABLE_TEXT_EXPORT_FORMATS)[number];
export type TableExportFormat = (typeof TABLE_EXPORT_FORMATS)[number];
```

Keep `buildTableExport` and `buildAllTableExports` text-only. Add `.xlsx` file options without trying to create text content.

- [x] **Step 5: Run selection/export/file tests**

Run:

```powershell
npm test -- --test-name-pattern="table selection|CSV|JSON|Markdown|file"
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add src/shared/tableSelection.ts src/shared/tableSelection.test.ts src/shared/tableExport.ts src/shared/tableExport.test.ts src/shared/tableFile.ts src/shared/tableFile.test.ts
git commit -m "feat: filter table export ranges"
```

---

### Task 4: Generate and Save Validated Excel Workbooks

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/main/tableWorkbook.ts`
- Create: `src/main/tableWorkbook.test.ts`
- Create: `src/shared/tableExportRequest.ts`
- Create: `src/shared/tableExportRequest.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: selected headers, rows, caption, and suggested base name.
- Produces: discriminated `TableExportSaveRequest`, validated requests, and `.xlsx` buffers.

- [x] **Step 1: Add ExcelJS**

Run:

```powershell
npm install exceljs@4.4.0
```

Expected: `exceljs` appears in dependencies and the lock file is updated.

- [x] **Step 2: Write failing request-validation tests**

Assert that text payloads accept only text formats, Excel accepts only rectangular non-empty string data, and mismatched payloads fail:

```ts
assert.equal(validateTableExportSaveRequest({
  format: "xlsx",
  table: { caption: "Metrics", headers: ["ID"], rows: [["00123"]] },
  suggestedBaseName: "metrics"
}).ok, true);
```

- [x] **Step 3: Define and validate the IPC union**

Add the exact `TableTextExportSaveRequest`, `TableExcelExportSaveRequest`, and `TableExportSaveRequest` union from the approved design. Implement:

```ts
export function validateTableExportSaveRequest(
  value: unknown
): { ok: true; request: TableExportSaveRequest } | { ok: false; message: string };
```

- [x] **Step 4: Write failing workbook round-trip tests**

Generate and reload a workbook to assert:

```ts
worksheet.getCell("A2").value === "00123";
worksheet.views[0]?.state === "frozen";
worksheet.views[0]?.ySplit === 1;
worksheet.autoFilter === "A1:B3";
worksheet.getRow(1).font.bold === true;
```

Also test invalid worksheet characters, 31-character truncation, fallback `Table`, and widths clamped to 12–48.

- [x] **Step 5: Implement workbook generation**

Create:

```ts
export type TableWorkbookData = {
  caption: string | null;
  headers: string[];
  rows: string[][];
};

export async function buildTableWorkbookBuffer(
  table: TableWorkbookData
): Promise<Buffer>;
```

Use one worksheet, string cell values, a frozen first row, automatic filter, bold filled header, and clamped widths.

- [x] **Step 6: Dispatch text and binary saves in the main process**

Validate before opening the dialog. For text requests, keep UTF-8/BOM behavior. For Excel requests:

```ts
const data = await buildTableWorkbookBuffer(request.table);
await writeFile(filePath, data);
```

Return the existing saved/cancelled/error union.

- [x] **Step 7: Run workbook, IPC, type, and build checks**

Run:

```powershell
npm test -- --test-name-pattern="workbook|export request|file"
npm run typecheck
npm run build
```

Expected: PASS.

- [x] **Step 8: Commit**

```powershell
git add package.json package-lock.json src/main/tableWorkbook.ts src/main/tableWorkbook.test.ts src/shared/tableExportRequest.ts src/shared/tableExportRequest.test.ts src/shared/ipc.ts src/main/main.ts tsconfig.test.json
git commit -m "feat: export selected tables to Excel"
```

---

### Task 5: Add Selection, Confidence, and Excel UI

**Files:**
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/components/workbenchPresentation.ts`
- Modify: `src/renderer/components/workbenchPresentation.test.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/store/useAppStore.ts`

**Interfaces:**
- Consumes: canonical table metadata, selection helpers, text exports, and discriminated save requests.
- Produces: accessible selection controls, confidence diagnostics, selected-range preview, and Excel save interaction.

- [x] **Step 1: Write failing pure presentation tests**

Add tests for:

```ts
getTableSelectionSummary(source, selected)
// => { selectedRows: 1, totalRows: 2, selectedColumns: 2, totalColumns: 3 }

getTableConfidenceMessageKey("low")
// => "table.confidence.low"
```

Add an Excel summary test that reports rows, columns, frozen header, filter, and width behavior.

- [x] **Step 2: Run presentation tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="table selection summary|confidence|Excel summary"
```

Expected: FAIL because the helpers are absent.

- [x] **Step 3: Implement pure presentation helpers**

Return plain data and `MessageKey` values only; do not embed translated strings in business logic.

- [x] **Step 4: Wire local selection state**

In `TableDataPanel`:

```ts
const [selection, setSelection] = useState(() => createFullTableSelection(table));
const selectedTable = useMemo(
  () => applyTableSelection(table, selection),
  [selection, table]
);
```

Reset on the component key formed from snapshot capture time and `tableId`. Use source indexes for checkboxes and all/clear actions.

- [x] **Step 5: Render confidence and diagnostic evidence**

Show source type and confidence for pseudo tables. Render every diagnostic with its translated message key, signed score delta, and technical detail. Apply warning styling to medium/low results.

- [x] **Step 6: Render row and column controls**

Add:

- sticky row-checkbox column;
- checkbox in every source header;
- row all/clear controls;
- column all/clear controls;
- muted styles on excluded rows, headers, and cells;
- selected/total metrics.

Keep row virtualization based on the source table.

- [x] **Step 7: Render selected text and Excel previews**

Build CSV/JSON/Markdown from `selectedTable`. For `xlsx`, show the workbook summary instead of Monaco, hide/disable copy, and send:

```ts
{
  format: "xlsx",
  table: {
    caption: selectedTable.caption,
    headers: selectedTable.headers,
    rows: selectedTable.rows
  },
  suggestedBaseName
}
```

Disable copy/save and show `table.selection.empty` if either dimension is empty.

- [x] **Step 8: Add complete translated copy and token-based CSS**

Add matching Chinese and English keys for source labels, confidence levels, selection actions, diagnostics, empty range, and workbook summary. Use existing semantic color variables and density behavior.

- [x] **Step 9: Run tests, typecheck, and build**

Run:

```powershell
npm test -- --test-name-pattern="table|confidence|selection|Excel"
npm run typecheck
npm run build
```

Expected: PASS.

- [x] **Step 10: Commit**

```powershell
git add src/renderer/components/WorkbenchLayout.tsx src/renderer/components/workbenchPresentation.ts src/renderer/components/workbenchPresentation.test.ts src/renderer/i18n/messages.ts src/renderer/styles/global.css src/renderer/store/useAppStore.ts
git commit -m "feat: add advanced table extraction controls"
```

---

### Task 6: Add Browser Fixtures and Context Regression Coverage

**Files:**
- Modify: `public/test-pages/table.html`
- Modify: `public/test-pages/iframe-child.html`
- Modify: `public/test-pages/shadow-dom.html`
- Modify: `public/test-pages/oopif-child.html`
- Modify: `public/test-pages/styles.css`
- Modify: `src/shared/tableExtraction.test.ts`
- Modify: `src/shared/pseudoTableExtraction.test.ts`
- Modify: `src/main/multiSessionSnapshot.test.ts`
- Modify: `src/renderer/i18n/messages.ts`

**Interfaces:**
- Consumes: the completed recognizer and stitched snapshots.
- Produces: representative manual/demo fixtures and cross-context regression evidence.

- [x] **Step 1: Add representative table fixtures**

Add stable `data-testid` fixtures:

```html
<section data-testid="grid-table" role="table">...</section>
<section data-testid="wrapped-grid-table" role="table">...</section>
<section data-testid="flex-table" role="table">...</section>
<section data-testid="card-grid">...</section>
<section data-testid="large-table">...</section>
```

Generate the large fixture deterministically with 2,000 rows and 12 columns.

- [x] **Step 2: Add equivalent contextual fixtures**

Add a compact two-column pseudo table inside:

- the same-origin iframe child;
- an open Shadow root;
- the OOPIF child page.

Use the same headers and rows so extracted results can be compared directly.

- [x] **Step 3: Add cross-context regression tests**

Construct namespaced page/frame/shadow session snapshots and assert that selecting a cell in each context produces the same:

```ts
{
  headers: ["Name", "Status"],
  rows: [["Alpha", "Ready"], ["Beta", "Blocked"]]
}
```

Also assert diagnostics/closed contexts never extract.

- [x] **Step 4: Run context and table tests**

Run:

```powershell
npm test -- --test-name-pattern="context|OOPIF|Shadow|pseudo table|large table"
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add public/test-pages/table.html public/test-pages/iframe-child.html public/test-pages/shadow-dom.html public/test-pages/oopif-child.html public/test-pages/styles.css src/shared/tableExtraction.test.ts src/shared/pseudoTableExtraction.test.ts src/main/multiSessionSnapshot.test.ts src/renderer/i18n/messages.ts
git commit -m "test: cover advanced tables across web contexts"
```

---

### Task 7: Complete Phase 7 Verification and Roadmap Status

**Files:**
- Modify: `REQUIREMENTS.md`

**Interfaces:**
- Consumes: all completed Phase 7 behavior and verification evidence.
- Produces: synchronized roadmap status and a clean, verified branch.

- [x] **Step 1: Run the complete automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: every command exits 0.

- [x] **Step 2: Inspect the complete diff**

Run:

```powershell
git diff --check
git status --short
git diff HEAD~6 --stat
```

Expected: no whitespace errors, only Phase 7 files changed, and generated directories absent.

- [ ] **Step 3: Perform representative manual acceptance**

UI Explorer launched successfully on 2026-07-30, but Windows application-control
approval timed out before interaction. No clicks or file-save actions were performed.
The behaviors below remain covered by pure logic, stitched-context, workbook
round-trip, type, and production-build verification.

Run the Electron app and validate:

1. standard, Grid, and Flex tables appear;
2. ordinary cards are not silently treated as a table;
3. low-confidence diagnostics are visible;
4. all rows/columns start selected;
5. arbitrary row/column changes update every preview;
6. saved Excel opens with exact values, header styling, freeze, filter, and widths;
7. page, iframe, Shadow, and OOPIF fixtures extract consistently;
8. the 2,000-by-12 fixture scrolls through the virtualized grid.

- [x] **Step 4: Mark Phase 7 complete**

Change the Phase 7 heading and milestone row from `计划中` to `已完成`. Do not alter later phases.

- [x] **Step 5: Verify the documentation-only change**

Run:

```powershell
git diff --check
rg -n "Phase 7.*已完成|Phase 7.*计划中" REQUIREMENTS.md
```

Expected: Phase 7 is consistently completed and no stale planned marker remains.

- [x] **Step 6: Record completion**

`REQUIREMENTS.md` is deliberately ignored by this repository. Its local roadmap
status was updated without force-adding the full project-specific requirements file.
This tracked implementation plan records the completed automated acceptance and the
manual UI authorization limitation.
