# Dependency decisions

## XLSX parser

Decision date: 2026-07-26

Selected: `read-excel-file@8.0.3` with `fflate@0.8.3` for a bounded
pre-inspection pass.

Reasoning:

- provides Node values-only workbook access and does not evaluate formulas;
- uses a small ZIP/XML-oriented dependency surface;
- allows the application to inspect ZIP entry metadata and worksheet XML before
  value parsing;
- supports explicit worksheet, row, column, cell, archive-entry, compressed,
  and expanded-byte limits.

Safety configuration:

- accept `.xlsx` only; reject `.xls` and `.xlsm`;
- inspect every ZIP entry's declared expanded size before the value parser runs;
- reject more than 200 archive entries or 32 MB total expanded content;
- parse exactly one worksheet;
- reject formula, hyperlink, merged-cell, external-link, and VBA XML/package
  markers before workbook value parsing;
- reject unsupported cell objects and files over 10 MB;
- never follow external links or execute embedded content;
- treat all text as untrusted data and preserve prompt-injection boundaries;
- keep the package under dependency/security monitoring before production
  tenant import.

ExcelJS was evaluated and removed from both runtime and development
dependencies after its older archive-writing dependency tree produced a
high-severity audit finding. Test fixtures now create minimal inert XLSX
archives with `fflate`, so the unsafe tree is not required even for tests.

Next.js transitive `sharp` and `postcss` are pinned to patched versions through
package-manager overrides. Unit, build, browser, XLSX active-content rejection,
and dependency-audit tests are required whenever these dependencies change.
