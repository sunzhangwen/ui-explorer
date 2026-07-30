import type { TableExportFormat } from "./tableExport.js";

export type TableFileOptions = {
  extension: "csv" | "json" | "md" | "xlsx";
  label: "CSV" | "JSON" | "Markdown" | "Excel";
};

const TABLE_FILE_OPTIONS = {
  csv: { extension: "csv", label: "CSV" },
  json: { extension: "json", label: "JSON" },
  markdown: { extension: "md", label: "Markdown" },
  xlsx: { extension: "xlsx", label: "Excel" }
} as const satisfies Record<TableExportFormat, TableFileOptions>;

export function getTableFileOptions(format: TableExportFormat): TableFileOptions {
  return TABLE_FILE_OPTIONS[format];
}

export function prepareTableFileContent(format: TableExportFormat, content: string): string {
  return format === "csv" ? `\uFEFF${content}` : content;
}

export function ensureTableFileExtension(filePath: string, format: TableExportFormat): string {
  const extension = getTableFileOptions(format).extension;
  return filePath.toLowerCase().endsWith(`.${extension}`)
    ? filePath
    : `${filePath}.${extension}`;
}

export function sanitizeTableExportBaseName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("..")) {
    return "table-export";
  }
  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "");
  return sanitized || "table-export";
}
