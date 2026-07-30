import ExcelJS from "exceljs";

export type TableWorkbookData = {
  caption: string | null;
  headers: string[];
  rows: string[][];
};

const HEADER_FILL_ARGB = "FF1F6FEB";
const HEADER_TEXT_ARGB = "FFFFFFFF";

export async function buildTableWorkbookBuffer(
  table: TableWorkbookData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sanitizeWorksheetName(table.caption), {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  worksheet.addRow(table.headers);
  for (const row of table.rows) {
    worksheet.addRow(row);
  }

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: HEADER_TEXT_ARGB } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_ARGB }
  };

  worksheet.autoFilter = `A1:${columnName(table.headers.length)}${table.rows.length + 1}`;
  worksheet.columns.forEach((column, index) => {
    const values = [
      table.headers[index] ?? "",
      ...table.rows.map((row) => row[index] ?? "")
    ];
    const longest = Math.max(...values.map(displayWidth));
    column.width = Math.max(12, Math.min(48, longest + 2));
  });

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output as ArrayBuffer);
}

export function sanitizeWorksheetName(value: string | null): string {
  const sanitized = (value ?? "")
    .replace(/[\][*?:/\\]/g, "")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, 31)
    .trim();
  return sanitized || "Table";
}

function displayWidth(value: string): number {
  return Array.from(value).length;
}

function columnName(columnCount: number): string {
  let value = columnCount;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result || "A";
}
