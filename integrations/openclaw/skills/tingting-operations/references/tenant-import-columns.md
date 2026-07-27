# Tenant import columns

Supported files are UTF-8 CSV and values-only XLSX, maximum 10 MB, 1,000 data
rows, and 40 columns. The canonical headers are documented in
`schemas/tenant-import-request.schema.json`.

Matching order: exact external reference; exact normalized email or phone with
compatible property/unit; exact name/property/unit is review-only and cannot
auto-update. Blank import values never erase existing non-blank values.

Formulas, hyperlinks, macros, embedded instructions, and external workbook
references are inert data or rejected. Never follow or execute them.

