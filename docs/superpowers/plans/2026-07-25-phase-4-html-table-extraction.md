# Phase 4 HTML Table Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize standard HTML tables in the current DOM snapshot, normalize merged cells and multi-level headers, preview the result, and export matching CSV, JSON, and Markdown files.

**Architecture:** Parse the existing `ElementSnapshot` tree on demand with pure shared functions, then feed one normalized table model to all previews and exporters. Keep derived table state out of Zustand, and add one narrow Electron IPC operation for native file saving.

**Tech Stack:** TypeScript 5, React 18, Zustand 5, Electron 33, Node.js test runner.

## Global Constraints

- Only standard HTML `<table>` structures are recognized; CSS Grid/Flex pseudo-tables are out of scope.
- Expanded `rowspan` and `colspan` values are copied into every covered logical cell.
- Multi-level headers use ` / ` between distinct header levels.
- CSV, JSON, and Markdown must consume the same normalized data.
- CSV file saves use UTF-8 BOM; copied CSV text does not.
- No `.xlsx`, filtering, sorting, editing, pagination crawling, project storage, or regression validation.

---

## File Structure

- `src/shared/tableExtraction.ts`: table lookup, row collection, span expansion, header inference, normalized model.
- `src/shared/tableExtraction.test.ts`: parser behavior and edge cases.
- `src/shared/tableExport.ts`: CSV, JSON, and Markdown serialization.
- `src/shared/tableExport.test.ts`: escaping and cross-format consistency.
- `src/shared/tableFile.ts`: save format metadata and file payload preparation.
- `src/shared/tableFile.test.ts`: extensions, filters, and BOM behavior.
- `src/shared/ipc.ts`: table save request/result contract and channel.
- `src/main/preload.cts`: expose the save call.
- `src/main/main.ts`: native save dialog and file write.
- `src/renderer/components/workbenchPresentation.ts`: pure table-panel presentation helpers.
- `src/renderer/components/workbenchPresentation.test.ts`: summary and panel visibility tests.
- `src/renderer/components/WorkbenchLayout.tsx`: derived model, virtual preview, format preview, copy/save interactions.
- `src/renderer/store/useAppStore.ts`: persisted table panel open state and browser fallback API.
- `src/renderer/i18n/messages.ts`: Chinese and English table UI copy.
- `src/renderer/styles/global.css`: table preview and action styling.
- `tsconfig.test.json`: include new main/shared test files automatically; no explicit change is expected.

### Task 1: Normalize HTML Table Snapshots

**Files:**
- Create: `src/shared/tableExtraction.ts`
- Create: `src/shared/tableExtraction.test.ts`

**Interfaces:**
- Consumes: `ElementSnapshot` from `src/shared/ipc.ts`.
- Produces: `findContainingTable(root, selectedId)`, `extractTable(table)`, and `extractTableForSelection(root, selectedId)`.

- [ ] **Step 1: Write failing tests for the fixture semantics and table lookup**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { extractTableForSelection } from "./tableExtraction.js";
import type { ElementSnapshot } from "./ipc.js";

test("expands grouped headers and merged body cells", () => {
  const root = fixtureTableSnapshot();
  const result = extractTableForSelection(root, "migration");
  assert.deepEqual(result?.headers, [
    "Team",
    "Q1 / Selectors",
    "Q1 / Pass rate",
    "Q2 / Selectors",
    "Q2 / Pass rate"
  ]);
  assert.deepEqual(result?.rows[1], ["Identity", "Migration", "Migration", "91", "95%"]);
});

test("selecting a descendant resolves the nearest table", () => {
  const result = extractTableForSelection(fixtureTableSnapshot(), "migration");
  assert.equal(result?.tableId, "table");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="grouped headers|nearest table"`

Expected: TypeScript compilation fails because `tableExtraction.ts` does not exist.

- [ ] **Step 3: Implement the normalized model and span-grid algorithm**

```ts
export type ExtractedTable = {
  tableId: string;
  caption: string | null;
  headerDepth: number;
  headers: string[];
  rows: string[][];
  records: Record<string, string>[];
};

export function extractTableForSelection(
  root: ElementSnapshot | null,
  selectedId: string | null
): ExtractedTable | null {
  const table = findContainingTable(root, selectedId);
  return table ? extractTable(table) : null;
}
```

Implement row collection from direct `table`, `thead`, `tbody`, and `tfoot` children, skip nested tables, parse positive spans, reserve occupied grid cells, normalize whitespace, infer headers, deduplicate header levels, and pad short rows.

- [ ] **Step 4: Add failing edge-case tests**

Add separate tests for no `<thead>` leading `<th>` rows, synthetic `Column N`, duplicate/empty headers, mixed row/column spans, irregular rows, nested-table text exclusion, and frame/shadow context preservation.

- [ ] **Step 5: Run tests, implement the minimal edge-case behavior, and verify GREEN**

Run: `npm test`

Expected: all parser and existing tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/tableExtraction.ts src/shared/tableExtraction.test.ts
git commit -m "feat: normalize html table snapshots"
```

### Task 2: Serialize One Model to Three Formats

**Files:**
- Create: `src/shared/tableExport.ts`
- Create: `src/shared/tableExport.test.ts`

**Interfaces:**
- Consumes: `ExtractedTable`.
- Produces: `TableExportFormat`, `buildTableExport(table, format)`, and `buildAllTableExports(table)`.

- [ ] **Step 1: Write failing serializer tests**

```ts
test("escapes CSV fields with commas quotes and newlines", () => {
  assert.equal(
    buildTableExport(table(["Name"], [['A, "B"\nC']]), "csv"),
    'Name\r\n"A, ""B""\nC"'
  );
});

test("escapes Markdown pipes and line breaks", () => {
  assert.match(buildTableExport(table(["Name"], [["A|B\nC"]]), "markdown"), /A\\\|B<br>C/);
});

test("formats JSON records with two-space indentation", () => {
  assert.equal(buildTableExport(table(["Name"], [["Alice"]]), "json"), '[\n  {\n    "Name": "Alice"\n  }\n]');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --test-name-pattern="CSV fields|Markdown pipes|JSON records"`

Expected: compilation fails because `tableExport.ts` does not exist.

- [ ] **Step 3: Implement minimal pure serializers**

```ts
export const TABLE_EXPORT_FORMATS = ["csv", "json", "markdown"] as const;
export type TableExportFormat = (typeof TABLE_EXPORT_FORMATS)[number];

export function buildTableExport(table: ExtractedTable, format: TableExportFormat): string {
  switch (format) {
    case "csv":
      return toCsv(table);
    case "json":
      return JSON.stringify(table.records, null, 2);
    case "markdown":
      return toMarkdown(table);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unhandled table export format: ${exhaustive}`);
    }
  }
}
```

- [ ] **Step 4: Run the full test suite and verify GREEN**

Run: `npm test`

Expected: all tests pass and all three formats preserve header and row order.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/tableExport.ts src/shared/tableExport.test.ts
git commit -m "feat: export normalized table data"
```

### Task 3: Prepare Safe Native File Saves

**Files:**
- Create: `src/shared/tableFile.ts`
- Create: `src/shared/tableFile.test.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `TableExportFormat` and serialized content.
- Produces: `TableExportSaveRequest`, `TableExportSaveResult`, `getTableFileOptions(format)`, and `prepareTableFileContent(format, content)`.

- [ ] **Step 1: Write failing save-metadata tests**

```ts
test("maps formats to fixed extensions", () => {
  assert.equal(getTableFileOptions("csv").extension, "csv");
  assert.equal(getTableFileOptions("json").extension, "json");
  assert.equal(getTableFileOptions("markdown").extension, "md");
});

test("adds BOM only to saved CSV payloads", () => {
  assert.equal(prepareTableFileContent("csv", "A\r\n中文"), "\uFEFFA\r\n中文");
  assert.equal(prepareTableFileContent("json", "[]"), "[]");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --test-name-pattern="fixed extensions|BOM only"`

Expected: compilation fails because `tableFile.ts` does not exist.

- [ ] **Step 3: Implement format metadata and typed IPC contract**

```ts
export type TableExportSaveRequest = {
  format: TableExportFormat;
  content: string;
  suggestedBaseName: string;
};

export type TableExportSaveResult =
  | { status: "saved"; filePath: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };
```

Add `saveTableExport` to `IpcApi` and `saveTableExport: "table:save-export"` to `IPC_CHANNELS`.

- [ ] **Step 4: Run all tests and typecheck**

Run: `npm test`

Expected: all tests pass.

Run: `npm run typecheck`

Expected: fallback/preload implementations fail until Task 4, proving all consumers are identified.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/tableFile.ts src/shared/tableFile.test.ts src/shared/ipc.ts
git commit -m "feat: define table export file contract"
```

### Task 4: Wire the Electron Save Operation

**Files:**
- Modify: `src/main/preload.cts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/store/useAppStore.ts`

**Interfaces:**
- Consumes: `TableExportSaveRequest`.
- Produces: `IpcApi.saveTableExport(request): Promise<TableExportSaveResult>`.

- [ ] **Step 1: Expose the new preload call and renderer fallback**

```ts
saveTableExport: (request) => ipcRenderer.invoke(IPC_CHANNELS.saveTableExport, request)
```

The browser-only fallback returns `{ status: "error", message: "Electron IPC is not available." }`.

- [ ] **Step 2: Register the native handler**

```ts
ipcMain.handle(IPC_CHANNELS.saveTableExport, async (_event, request: TableExportSaveRequest) => {
  const options = getTableFileOptions(request.format);
  const result = await dialog.showSaveDialog({
    defaultPath: `${sanitizeBaseName(request.suggestedBaseName)}.${options.extension}`,
    filters: [{ name: options.label, extensions: [options.extension] }]
  });
  if (result.canceled || !result.filePath) return { status: "cancelled" };
  try {
    await writeFile(result.filePath, prepareTableFileContent(request.format, request.content), "utf8");
    return { status: "saved", filePath: result.filePath };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
});
```

- [ ] **Step 3: Verify compilation**

Run: `npm run typecheck`

Expected: both Electron and renderer typechecks pass.

- [ ] **Step 4: Commit**

```powershell
git add src/main/preload.cts src/main/main.ts src/renderer/store/useAppStore.ts
git commit -m "feat: save table exports with native dialog"
```

### Task 5: Add Table Presentation Helpers and Localized Copy

**Files:**
- Modify: `src/renderer/components/workbenchPresentation.ts`
- Modify: `src/renderer/components/workbenchPresentation.test.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/store/useAppStore.ts`

**Interfaces:**
- Consumes: `ExtractedTable | null`.
- Produces: `getTableSummary(table)` and the persisted `"table"` right-panel section.

- [ ] **Step 1: Write failing presentation tests**

```ts
test("summarizes extracted table dimensions and header depth", () => {
  assert.deepEqual(getTableSummary(sample), { columns: 5, rows: 2, headerDepth: 2 });
});

test("returns no summary without a selected table", () => {
  assert.equal(getTableSummary(null), null);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --test-name-pattern="table dimensions|no summary"`

Expected: compilation fails because `getTableSummary` is missing.

- [ ] **Step 3: Implement the helper, panel state, and exhaustive i18n keys**

```ts
export function getTableSummary(table: ExtractedTable | null) {
  return table
    ? { columns: table.headers.length, rows: table.rows.length, headerDepth: table.headerDepth }
    : null;
}
```

Add Chinese and English keys for the panel title, counts, empty state, preview formats, copy, save, saved, cancelled, and failed states.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test`

Expected: all tests pass.

Run: `npm run typecheck`

Expected: all typechecks pass.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/workbenchPresentation.ts src/renderer/components/workbenchPresentation.test.ts src/renderer/i18n/messages.ts src/renderer/store/useAppStore.ts
git commit -m "feat: add table panel presentation state"
```

### Task 6: Build the Contextual Table Panel

**Files:**
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/styles/global.css`

**Interfaces:**
- Consumes: `extractTableForSelection`, `buildTableExport`, and `IpcApi.saveTableExport`.
- Produces: contextual table panel, virtual row preview, format preview, copy, and save actions.

- [ ] **Step 1: Derive table data and exports without persistent cache**

```tsx
const extractedTable = useMemo(
  () => extractTableForSelection(domSnapshot?.root ?? null, selectedElementId),
  [domSnapshot?.root, selectedElementId]
);
const tableExports = useMemo(
  () => extractedTable ? buildAllTableExports(extractedTable) : null,
  [extractedTable]
);
```

- [ ] **Step 2: Render the conditional collapsible section**

Render only when `extractedTable` is non-null. Include dimension metrics, a horizontal grid, format tabs, Monaco preview, copy, and save buttons.

- [ ] **Step 3: Implement virtual row rendering**

Use a fixed row height, scroll position, and overscan as the existing DOM tree does. Keep the header sticky, compute a minimum column width, and render only the visible body row slice.

- [ ] **Step 4: Implement copy and save feedback**

```tsx
const saveTable = async () => {
  if (!tableExports || !extractedTable) return;
  const result = await api.saveTableExport({
    format: tableExportFormat,
    content: tableExports[tableExportFormat],
    suggestedBaseName: extractedTable.caption || "table-export"
  });
  setTableSaveResult(result);
};
```

Reset feedback when the selected table or format changes. Treat cancellation as a neutral status.

- [ ] **Step 5: Add responsive, theme-token-based styling**

Style `.table-data-grid`, `.table-data-header`, `.table-data-row`, `.table-export-actions`, and feedback states using existing CSS variables. Do not add a UI dependency.

- [ ] **Step 6: Run typecheck and build**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/components/WorkbenchLayout.tsx src/renderer/styles/global.css
git commit -m "feat: preview and export selected html tables"
```

### Task 7: Complete Regression and Acceptance Verification

**Files:**
- Modify only if a verified defect requires a TDD fix.

**Interfaces:**
- Consumes: completed feature.
- Produces: verified Phase 4 table extraction slice.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all tests pass with no warnings or failures.

- [ ] **Step 2: Run static compilation**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Vite and both TypeScript projects build successfully.

- [ ] **Step 4: Inspect the built-in fixture manually**

Connect to `public/test-pages/table.html`, select the table and the `Migration` cell, and confirm the five exact headers and duplicated `Migration` values specified in the design.

- [ ] **Step 5: Verify all export actions**

Copy and save CSV, JSON, and Markdown; confirm extension, encoding, escaping, row order, and agreement with the preview.

- [ ] **Step 6: Commit any acceptance-only fix through RED/GREEN**

If verification exposes a defect, first add a failing regression test, confirm RED, implement the smallest fix, and rerun Steps 1–3 before committing.
