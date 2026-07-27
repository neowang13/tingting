import type { TenantImportRow } from "@/features/automation/contracts";
import { escapeCsvFormula } from "@/features/automation/redaction";

function csvCell(value: string | number) {
  const safe = escapeCsvFormula(String(value));
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createSanitizedImportErrorCsv(rows: TenantImportRow[]) {
  const header = ["row", "outcome", "display", "error_codes", "warnings"];
  const lines = rows
    .filter((row) => row.outcome === "invalid" || row.outcome === "conflict")
    .map((row) => [
      row.rowNumber,
      row.outcome,
      row.display,
      row.errorCodes.join("|"),
      row.warnings.join("|")
    ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

