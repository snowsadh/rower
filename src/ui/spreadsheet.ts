import type ExcelJS from "exceljs";
import Papa from "papaparse";

type CellValue = string | number | boolean | null;

export interface SheetData {
  fileName: string;
  format: "xlsx" | "csv";
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  rows: Array<Record<string, CellValue>>;
  sourceMatrix: CellValue[][];
  sourceRows: CellValue[][];
  headerRowNumber: number;
  sourceRowNumbers: number[];
  original: ArrayBuffer;
}

function uniqueHeaders(values: CellValue[]) {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `Column_${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    return name;
  });
}

function normalizeCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    if ("result" in value) return normalizeCell(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return String(value);
}

function rowsFromMatrix(matrix: CellValue[][], physicalRowNumbers?: number[]) {
  const headerIndex = matrix.findIndex((row) => row.some((value) => value !== null && String(value).trim() !== ""));
  if (headerIndex < 0) throw new Error("The selected sheet does not contain a header row.");
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const headerValues = Array.from({ length: width }, (_, index) => matrix[headerIndex]?.[index] ?? null);
  const headers = uniqueHeaders(headerValues);
  const entries = matrix.slice(headerIndex + 1)
    .map((row, index) => ({ row, rowNumber: physicalRowNumbers?.[headerIndex + index + 1] ?? headerIndex + index + 2 }))
    .filter(({ row }) => row.some((value) => value !== null && String(value).trim() !== ""));
  const sourceRows = entries.map(({ row }) => row);
  const headerRowNumber = physicalRowNumbers?.[headerIndex] ?? headerIndex + 1;
  const sourceRowNumbers = entries.map(({ rowNumber }) => rowNumber);
  const rows = sourceRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  return { headers, rows, sourceRows, headerRowNumber, sourceRowNumbers };
}

async function parseXlsx(file: File, original: ArrayBuffer, requestedSheet?: string): Promise<SheetData> {
  const ExcelJSRuntime = (await import("exceljs")).default;
  const workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.load(original.slice(0));
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = requestedSheet ? workbook.getWorksheet(requestedSheet) : workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a readable sheet.");
  const matrix: CellValue[][] = [];
  const physicalRowNumbers: number[] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: CellValue[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      values.push(normalizeCell(row.getCell(column).value));
    }
    matrix.push(values);
    physicalRowNumbers.push(row.number);
  });
  const parsed = rowsFromMatrix(matrix, physicalRowNumbers);
  return {
    fileName: file.name,
    format: "xlsx",
    sheetName: worksheet.name,
    sheetNames,
    original,
    sourceMatrix: matrix,
    ...parsed
  };
}

export async function parseSpreadsheet(file: File, requestedSheet?: string): Promise<SheetData> {
  const original = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) {
    const text = new TextDecoder().decode(original);
    const result = Papa.parse<CellValue[]>(text, { skipEmptyLines: false });
    const blockingError = result.errors.find((error) => error.code !== "UndetectableDelimiter");
    if (blockingError) throw new Error(blockingError.message);
    const parsed = rowsFromMatrix(result.data);
    return {
      fileName: file.name,
      format: "csv",
      sheetName: "CSV",
      sheetNames: ["CSV"],
      original,
      sourceMatrix: result.data,
      ...parsed
    };
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Use an .xlsx or .csv file.");
  return parseXlsx(file, original, requestedSheet);
}

function safeGeneratedValue(value: unknown): CellValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export async function exportSpreadsheet(
  sheet: SheetData,
  fields: string[],
  outputs: Map<string, Record<string, unknown>>
) {
  const base = sheet.fileName.replace(/\.(xlsx|csv)$/i, "");
  if (sheet.format === "csv") {
    const outputByPhysicalRow = new Map(sheet.sourceRowNumbers.map((rowNumber, index) => [rowNumber, outputs.get(`row-${index + 1}`)]));
    const matrix = sheet.sourceMatrix.map((row, index) => {
      const physicalRowNumber = index + 1;
      const sourceCells = Array.from({ length: sheet.headers.length }, (_, column) => row[column] ?? null);
      if (physicalRowNumber === sheet.headerRowNumber) return [...sourceCells, ...fields];
      const output = outputByPhysicalRow.get(physicalRowNumber);
      return [...sourceCells, ...fields.map((field) => safeGeneratedValue(output?.[field]))];
    });
    return {
      fileName: `${base}-completed.csv`,
      blob: new Blob([Papa.unparse(matrix)], { type: "text/csv;charset=utf-8" })
    };
  }

  const ExcelJSRuntime = (await import("exceljs")).default;
  const workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.load(sheet.original.slice(0));
  const worksheet = workbook.getWorksheet(sheet.sheetName);
  if (!worksheet) throw new Error("The selected sheet is no longer available.");
  const startColumn = worksheet.columnCount + 1;
  fields.forEach((field, index) => {
    const cell = worksheet.getCell(sheet.headerRowNumber, startColumn + index);
    cell.value = field;
    cell.font = { ...cell.font, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9DF" } };
  });
  sheet.sourceRows.forEach((_row, rowIndex) => {
    const output = outputs.get(`row-${rowIndex + 1}`);
    fields.forEach((field, fieldIndex) => {
      worksheet.getCell(sheet.sourceRowNumbers[rowIndex], startColumn + fieldIndex).value = safeGeneratedValue(output?.[field]);
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  return {
    fileName: `${base}-completed.xlsx`,
    blob: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
