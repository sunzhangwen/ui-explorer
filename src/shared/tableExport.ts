import type { ExtractedTable } from "./tableExtraction.js";

export const TABLE_EXPORT_FORMATS = ["csv", "json", "markdown"] as const;

export type TableExportFormat = (typeof TABLE_EXPORT_FORMATS)[number];

export type TableExports = Record<TableExportFormat, string>;

export function isTableExportFormat(value: unknown): value is TableExportFormat {
  return typeof value === "string" && TABLE_EXPORT_FORMATS.some((format) => format === value);
}

export function buildTableExport(table: ExtractedTable, format: TableExportFormat): string {
  switch (format) {
    case "csv":
      return toCsv(table);
    case "json":
      return JSON.stringify(table.records, null, 2);
    case "markdown":
      return toMarkdown(table);
    default: {
      const exhaustiveFormat: never = format;
      throw new Error(`Unhandled table export format: ${exhaustiveFormat}`);
    }
  }
}

export function buildAllTableExports(table: ExtractedTable): TableExports {
  return {
    csv: buildTableExport(table, "csv"),
    json: buildTableExport(table, "json"),
    markdown: buildTableExport(table, "markdown")
  };
}

function toCsv(table: ExtractedTable): string {
  if (table.headers.length === 0) {
    return "";
  }
  return [table.headers, ...table.rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function toMarkdown(table: ExtractedTable): string {
  if (table.headers.length === 0) {
    return "";
  }
  const header = markdownRow(table.headers);
  const divider = markdownRow(table.headers.map(() => "---"));
  return [header, divider, ...table.rows.map(markdownRow)].join("\n");
}

function markdownRow(values: string[]): string {
  return `| ${values.map(escapeMarkdownCell).join(" | ")} |`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
