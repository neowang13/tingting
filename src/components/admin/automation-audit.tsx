type AuditRecord = Record<string, unknown>;

export function AutomationAudit({ events }: { events: AuditRecord[] }) {
  return (
    <section aria-labelledby="automation-audit-heading">
      <div className="admin-list-toolbar">
        <div><p className="eyebrow">APPEND-ONLY HISTORY</p><h2 id="automation-audit-heading">Automation audit</h2></div>
        <span>{events.length} recent events</span>
      </div>
      {events.length === 0 ? (
        <div className="card empty-state">
          <h3>No automation activity</h3>
          <p>Successful automation mutations will appear here with service-account and delegated-admin attribution.</p>
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="Scrollable automation audit table">
          <table className="admin-table">
            <caption className="sr-only">Automation service-account audit history</caption>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Request</th></tr></thead>
            <tbody>{events.map((event) => {
              const serviceAccountRaw = event.automation_service_accounts as unknown;
              const serviceAccount = (Array.isArray(serviceAccountRaw) ? serviceAccountRaw[0] : serviceAccountRaw) as { name?: string } | undefined;
              const id = String(event.id);
              return (
                <tr key={id}>
                  <td>{new Date(String(event.createdAt ?? event.created_at)).toLocaleString()}</td>
                  <td>{serviceAccount?.name ?? "OpenClaw Operations"}<br /><small>Service account</small></td>
                  <td>{String(event.action)}</td>
                  <td>{String(event.targetType ?? event.target_type)} · {String(event.targetId ?? event.target_id ?? "").slice(0, 8)}</td>
                  <td><code>{String(event.requestId ?? event.request_id ?? "—").slice(0, 8)}</code></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

