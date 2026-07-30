import type { TableExportSaveRequest } from "./ipc.js";
import { isTableTextExportFormat } from "./tableExport.js";

export type TableExportRequestValidation =
  | { ok: true; request: TableExportSaveRequest }
  | { ok: false; message: string };

export function validateTableExportSaveRequest(
  value: unknown
): TableExportRequestValidation {
  if (!isRecord(value) || typeof value.suggestedBaseName !== "string") {
    return invalid();
  }

  if (isTableTextExportFormat(value.format)) {
    return typeof value.content === "string" && !("table" in value)
      ? { ok: true, request: value as TableExportSaveRequest }
      : invalid();
  }

  if (
    value.format !== "xlsx" ||
    "content" in value ||
    !isRecord(value.table)
  ) {
    return invalid();
  }

  const { caption, headers, rows } = value.table;
  if (
    !(caption === null || typeof caption === "string") ||
    !isStringArray(headers) ||
    headers.length === 0 ||
    !Array.isArray(rows) ||
    rows.length === 0 ||
    !rows.every(
      (row) =>
        isStringArray(row) &&
        row.length === headers.length
    )
  ) {
    return invalid();
  }

  return { ok: true, request: value as TableExportSaveRequest };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function invalid(): TableExportRequestValidation {
  return { ok: false, message: "Invalid table export request." };
}
