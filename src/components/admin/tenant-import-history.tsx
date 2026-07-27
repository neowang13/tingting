"use client";

import { useState } from "react";

type ImportRecord = Record<string, unknown>;

export function TenantImportHistory({ imports }: { imports: ImportRecord[] }) {
  const [records, setRecords] = useState(imports);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runAction(id: string, action: "cancel" | "delete-source") {
    setBusyId(id);
    setMessage(action === "cancel" ? "Cancelling import…" : "Deleting private source file…");
    try {
      const response = await fetch(`/api/admin/automation/imports/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message ?? "The import action failed.");
      }
      setRecords((items) => items.map((record) => {
        if (String(record.id) !== id) return record;
        return action === "cancel"
          ? { ...record, status: "cancelled" }
          : { ...record, sourceDeletedAt: result.data.sourceDeletedAt };
      }));
      setMessage(action === "cancel"
        ? "The import was cancelled."
        : "The private source file was deleted; audit and sanitized outcomes remain.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The import action failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="import-history-heading">
      <div className="admin-list-toolbar">
        <div><p className="eyebrow">MASKED TENANT DATA</p><h2 id="import-history-heading">Import history</h2></div>
        <span>{records.length} batches</span>
      </div>
      {records.length === 0 ? (
        <div className="card empty-state">
          <h3>No tenant imports</h3>
          <p>OpenClaw import previews will appear here. Full destinations and raw rows are never displayed.</p>
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="Scrollable tenant import table">
          <table className="admin-table">
            <caption className="sr-only">Tenant import status and aggregate row outcomes</caption>
            <thead><tr><th>File</th><th>Source</th><th>Status</th><th>Rows</th><th>New / Update</th><th>Blocking</th><th>Retention</th><th>Actions</th></tr></thead>
            <tbody>{records.map((record) => {
              const counts = (record.counts ?? {}) as Record<string, number>;
              const id = String(record.id);
              const status = String(
                record.status ??
                (record.automation_jobs as { status?: string } | undefined)?.status ??
                "Unknown"
              );
              const sourceDeletedAt = record.sourceDeletedAt ?? record.source_deleted_at;
              return (
                <tr key={id}>
                  <td><strong>{String(record.originalFilename ?? record.original_filename ?? "Import")}</strong><br /><small>Digest {String(record.sourceDigest ?? record.source_digest ?? "").slice(0, 18)}…</small></td>
                  <td>{String(record.sourceSystem ?? record.source_system ?? "—")}</td>
                  <td><span className={`status ${status}`}>{status}</span></td>
                  <td>{Number(record.rowCount ?? record.row_count ?? 0)}</td>
                  <td>{Number(counts.new ?? record.new_count ?? 0)} / {Number(counts.update ?? record.update_count ?? 0)}</td>
                  <td>{Number(counts.conflict ?? record.conflict_count ?? 0)} conflicts · {Number(counts.invalid ?? record.invalid_count ?? 0)} invalid</td>
                  <td>{sourceDeletedAt
                    ? `Source deleted ${new Date(String(sourceDeletedAt)).toLocaleString()}`
                    : `Source expires ${new Date(String(record.rawFileExpiresAt ?? record.raw_file_expires_at)).toLocaleString()}`}</td>
                  <td>
                    <div className="table-actions">
                      <a href={`/api/admin/automation/imports/${encodeURIComponent(id)}/errors.csv`}>Sanitized errors</a>
                      <button
                        className="icon-text-button"
                        disabled={busyId === id || status === "completed" || status === "cancelled"}
                        type="button"
                        onClick={() => void runAction(id, "cancel")}
                      >Cancel</button>
                      <button
                        className="icon-text-button danger-text"
                        disabled={busyId === id || Boolean(sourceDeletedAt)}
                        type="button"
                        onClick={() => void runAction(id, "delete-source")}
                      >Delete source</button>
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </section>
  );
}
