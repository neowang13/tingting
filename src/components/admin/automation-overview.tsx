import Link from "next/link";
import type { AutomationHealth } from "@/features/automation/contracts";

interface Summary {
  activeServiceAccounts: number;
  lastSuccessfulRequest: string | null;
  requestsLast24Hours: number;
  failuresLast24Hours: number;
  activeConfirmations: number;
  expiredConfirmations: number;
  unresolvedImports: number;
  health: AutomationHealth;
}

export function AutomationOverview({ summary }: { summary: Summary }) {
  const warnings = [
    !summary.health.featureFlags.api ? "Automation API is disabled." : null,
    !summary.health.featureFlags.mutations ? "Automation mutations are disabled." : null,
    !summary.health.durableBackendReady
      ? "Production tenant import and confirmed mutations require the Supabase data backend."
      : null,
    summary.unresolvedImports > 0
      ? `${summary.unresolvedImports} tenant import${summary.unresolvedImports === 1 ? " has" : "s have"} unresolved rows.`
      : null,
    summary.health.providerMode === "live" && !summary.health.effectiveReminderPause
      ? "Provider mode is live and reminders are not paused."
      : null
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <div className="admin-editor-stack">
      {warnings.length > 0 && (
        <section className="warning-stack" aria-labelledby="automation-warnings-heading">
          <h2 id="automation-warnings-heading">Needs attention</h2>
          {warnings.map((warning) => (
            <p className="warning-callout" key={warning}>{warning}</p>
          ))}
        </section>
      )}
      <div className="metric-grid">
        <Metric label="Active service accounts" value={summary.activeServiceAccounts} />
        <Metric label="Requests (24 hours)" value={summary.requestsLast24Hours} />
        <Metric label="Failures (24 hours)" value={summary.failuresLast24Hours} />
        <Metric label="Pending confirmations" value={summary.activeConfirmations} />
      </div>
      <div className="dashboard-status-grid">
        <section className="card">
          <p className="eyebrow">ACCESS</p>
          <h2>OpenClaw service accounts</h2>
          <p>Create, rotate, revoke, or deactivate scoped credentials. Tokens are displayed once.</p>
          <Link className="text-link" href="/admin/automation/service-accounts">
            Manage service accounts →
          </Link>
        </section>
        <section className="card">
          <p className="eyebrow">TENANT DATA</p>
          <h2>Import history</h2>
          <p>{summary.unresolvedImports} imports require review. Destinations remain masked.</p>
          <Link className="text-link" href="/admin/automation/imports">Review imports →</Link>
        </section>
        <section className="card">
          <p className="eyebrow">TRACEABILITY</p>
          <h2>Automation audit</h2>
          <p>
            Last successful activity:{" "}
            {summary.lastSuccessfulRequest
              ? new Date(summary.lastSuccessfulRequest).toLocaleString()
              : "No automation activity recorded"}
          </p>
          <Link className="text-link" href="/admin/automation/audit">Open audit history →</Link>
        </section>
        <section className="card">
          <p className="eyebrow">SAFETY STATE</p>
          <h2>Delivery controls</h2>
          <dl className="status-list">
            <div><dt>Data backend</dt><dd>{summary.health.dataBackend}</dd></div>
            <div><dt>Provider mode</dt><dd>{summary.health.providerMode}</dd></div>
            <div><dt>Force pause</dt><dd>{summary.health.remindersForcePaused ? "Active" : "Off"}</dd></div>
            <div><dt>Global pause</dt><dd>{summary.health.remindersGlobalPaused ? "Paused" : "Active"}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

