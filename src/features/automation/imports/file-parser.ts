import { unzipSync } from "fflate";
import { readSheet } from "read-excel-file/node";
import { ApiError } from "@/lib/api";
import { mapTenantImportHeaders, type TenantImportHeader } from "@/features/automation/imports/header-map";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 1_000;
const MAX_COLUMNS = 40;
const MAX_CELL_LENGTH = 4_000;
const MAX_XLSX_ENTRIES = 200;
const MAX_XLSX_EXPANDED_BYTES = 32 * 1024 * 1024;

export interface ParsedTenantFile {
  headers: Array<TenantImportHeader | null>;
  headerWarnings: string[];
  rows: Array<Record<TenantImportHeader, string>>;
}

function assertFileLimits(file: File) {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new ApiError(422, "IMPORT_FILE_SIZE", "Tenant import files must be between 1 byte and 10 MB.");
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
    throw new ApiError(422, "IMPORT_FILE_TYPE", "Upload a UTF-8 CSV or XLSX file.");
  }
  if (/\.(xls|xlsm)$/i.test(lowerName)) {
    throw new ApiError(422, "IMPORT_MACROS_NOT_ALLOWED", "Legacy or macro-enabled workbooks are not supported.");
  }
}

export async function parseTenantImportFile(file: File): Promise<ParsedTenantFile> {
  assertFileLimits(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return file.name.toLowerCase().endsWith(".csv")
    ? parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    : parseXlsx(bytes);
}

export function parseCsv(text: string): ParsedTenantFile {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new ApiError(422, "IMPORT_INVALID_CSV", "The CSV contains an unterminated quoted field.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) matrix.push(row);
  return matrixToRows(matrix);
}

async function parseXlsx(bytes: Uint8Array): Promise<ParsedTenantFile> {
  inspectXlsxArchive(bytes);
  let sourceRows;
  try {
    sourceRows = await readSheet(Buffer.from(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "IMPORT_INVALID_XLSX", "The XLSX workbook could not be parsed safely.");
  }
  if (sourceRows.length > MAX_ROWS + 1) {
    throw new ApiError(422, "IMPORT_ROW_LIMIT", "Tenant imports may contain at most 1,000 data rows.");
  }
  const columnCount = Math.max(0, ...sourceRows.map((row) => row.length));
  if (columnCount > MAX_COLUMNS) {
    throw new ApiError(422, "IMPORT_COLUMN_LIMIT", "Tenant imports may contain at most 40 columns.");
  }
  const matrix = sourceRows.map((sourceRow) =>
    Array.from({ length: columnCount }, (_, index) => cellText(sourceRow[index]))
  );
  return matrixToRows(matrix);
}

function inspectXlsxArchive(bytes: Uint8Array) {
  let entryCount = 0;
  let expandedBytes = 0;
  let worksheetFiles: Record<string, Uint8Array>;
  try {
    worksheetFiles = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1;
        expandedBytes += entry.originalSize;
        if (
          entryCount > MAX_XLSX_ENTRIES ||
          expandedBytes > MAX_XLSX_EXPANDED_BYTES
        ) {
          throw new ApiError(
            422,
            "IMPORT_XLSX_EXPANSION_LIMIT",
            "The workbook expands beyond the safe import limit."
          );
        }
        const normalizedName = entry.name.replaceAll("\\", "/");
        if (
          normalizedName.startsWith("xl/externalLinks/") ||
          /(^|\/)vbaProject\.bin$/i.test(normalizedName)
        ) {
          throw new ApiError(
            422,
            "IMPORT_ACTIVE_WORKBOOK",
            "External links and workbook code are not accepted."
          );
        }
        return /^xl\/worksheets\/sheet\d+\.xml$/i.test(normalizedName);
      }
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "IMPORT_INVALID_XLSX", "The XLSX archive is invalid.");
  }
  if (Object.keys(worksheetFiles).length !== 1) {
    throw new ApiError(422, "IMPORT_WORKSHEET_COUNT", "The workbook must contain exactly one worksheet.");
  }
  for (const xmlBytes of Object.values(worksheetFiles)) {
    let xml: string;
    try {
      xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
    } catch {
      throw new ApiError(422, "IMPORT_INVALID_XLSX", "The worksheet XML is not valid UTF-8.");
    }
    if (/<(?:\w+:)?f(?:\s|\/?>)/i.test(xml) || /<(?:\w+:)?hyperlink(?:\s|\/?>)/i.test(xml)) {
      throw new ApiError(422, "IMPORT_ACTIVE_CELL", "Formulas and hyperlinks are not accepted in tenant imports.");
    }
    if (/<(?:\w+:)?mergeCell(?:\s|\/?>)/i.test(xml)) {
      throw new ApiError(422, "IMPORT_MERGED_CELLS", "Merged cells are not allowed in the import data range.");
    }
  }
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    throw new ApiError(422, "IMPORT_UNSUPPORTED_CELL", "The workbook contains an unsupported cell value.");
  }
  const text = String(value);
  if (text.length > MAX_CELL_LENGTH) {
    throw new ApiError(422, "IMPORT_CELL_LIMIT", "One or more import cells exceed 4,000 characters.");
  }
  return text;
}

function matrixToRows(matrix: string[][]): ParsedTenantFile {
  if (matrix.length < 2) throw new ApiError(422, "IMPORT_EMPTY", "The tenant import contains no data rows.");
  if (matrix.length - 1 > MAX_ROWS) {
    throw new ApiError(422, "IMPORT_ROW_LIMIT", "Tenant imports may contain at most 1,000 data rows.");
  }
  const header = mapTenantImportHeaders(matrix[0]);
  const rows = matrix.slice(1).map((values) => {
    const record = {} as Record<TenantImportHeader, string>;
    header.mapped.forEach((canonical, index) => {
      if (canonical) record[canonical] = values[index] ?? "";
    });
    return record;
  });
  return { headers: header.mapped, headerWarnings: header.warnings, rows };
}
