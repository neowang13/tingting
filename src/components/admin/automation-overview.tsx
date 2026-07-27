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
    (summary.health.emailProviderMode === "live" || summary.health.smsProviderMode === "live") &&
      !summary.health.effectiveReminderPause
      ? "At least one provider is live and reminders are not paused."
      : null
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <div className="prototype-page automation-overview-page">
      <div className="metric-grid">
        <Metric label="Active service accounts" value={summary.activeServiceAccounts} />
        <Metric label="Requests (24h)" value={summary.requestsLast24Hours} />
        <Metric label="Failures (24h)" value={summary.failuresLast24Hours} tone="danger" />
        <Metric label="Pending confirmations" value={summary.activeConfirmations} />
      </div>
      <div className="prototype-action-grid">
        <Link className="prototype-action-card" href="/admin/automation/service-accounts">
          <h2>OpenClaw service accounts</h2>
          <p>Create, rotate and manage automation credentials →</p>
        </Link>
        <Link className="prototype-action-card" href="/admin/automation/imports">
          <h2>Import history</h2>
          <p>Tenant import batches from OpenClaw →</p>
        </Link>
        <Link className="prototype-action-card" href="/admin/automation/audit">
          <h2>Automation audit</h2>
          <p>Trace of automated actions →</p>
        </Link>
        <section className="prototype-action-card static">
          <h2>Delivery controls</h2>
          <p>
            Data backend: {displayMode(summary.health.dataBackend)} · Email provider:{" "}
            {displayMode(summary.health.emailProviderMode)} · SMS provider: {displayMode(summary.health.smsProviderMode)}
          </p>
        </section>
      </div>
      {warnings.length > 0 && (
        <section className="prototype-attention" aria-labelledby="automation-warnings-heading">
          <span className="sr-only" id="automation-warnings-heading">Needs attention</span>
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function displayMode(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}
