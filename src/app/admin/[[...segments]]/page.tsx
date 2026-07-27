import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { SectionEditor } from "@/components/admin/section-editor";
import { RentalEditor } from "@/components/admin/rental-editor";
import { TenantEditor } from "@/components/admin/tenant-editor";
import { TemplateManager } from "@/components/admin/template-manager";
import { SendReminder } from "@/components/admin/send-reminder";
import { DeliveryHistory } from "@/components/admin/delivery-history";
import { ReminderSettings } from "@/components/admin/reminder-settings";
import { SiteHome } from "@/components/public/site-home";
import { getRepository } from "@/data/repository";
import { sectionKeySchema } from "@/features/content/schemas";
import { loadAdminPreviewData } from "@/features/content/public-homepage";
import { listMediaAssets } from "@/features/content/media-service";
import { requireAdminPage } from "@/lib/auth";
import { getAutomationRepository } from "@/data/automation-repository";
import { AutomationOverview } from "@/components/admin/automation-overview";
import { ServiceAccountManager } from "@/components/admin/service-account-manager";
import { TenantImportHistory } from "@/components/admin/tenant-import-history";
import { AutomationAudit } from "@/components/admin/automation-audit";

interface Props {
  params: Promise<{ segments?: string[] }>;
}

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: Props) {
  const admin = await requireAdminPage();
  const { segments = [] } = await params;
  const [area, id] = segments;
  const repository = getRepository();

  if (!area) {
    const summary = await repository.dashboard();
    const forcePaused = process.env.REMINDERS_FORCE_PAUSED !== "false";
    const effectivePaused = summary.remindersPaused || forcePaused;
    return (
      <AdminShell admin={admin} title="Dashboard">
        <div className="metric-grid">
          <Metric label="Active tenants" value={summary.activeTenants} />
          <Metric label="Enabled schedules" value={summary.enabledSchedules} />
          <Metric label="Due next 7 days" value={summary.dueNextSevenDays} />
          <Metric label="Failures (30 days)" value={summary.failedLastThirtyDays} />
          <Metric label="Outbox backlog" value={summary.outboxBacklog} />
        </div>
        {summary.warnings.length > 0 && (
          <section className="warning-stack" aria-labelledby="warnings-heading">
            <h2 id="warnings-heading">Needs attention</h2>
            {summary.warnings.map((warning) => <p className="warning-callout" key={warning}>{warning}</p>)}
          </section>
        )}
        <div className="dashboard-status-grid">
          <section className="card">
            <p className="eyebrow">AUTOMATION</p>
            <h2>Reminder status</h2>
            <p><span className={`status ${effectivePaused ? "draft" : "published"}`}>{effectivePaused ? "Paused" : "Active"}</span></p>
            {forcePaused && <p>Deployment safety pause is active.</p>}
            <p>Latest worker: {summary.latestWorkerStatus ?? "Not run yet"}</p>
            <p>{summary.lastWorkerRunAt ? new Date(summary.lastWorkerRunAt).toLocaleString() : "No worker run recorded"}</p>
          </section>
          <section className="card">
            <p className="eyebrow">DELIVERY</p>
            <h2>Delivery queue</h2>
            <p>{summary.outboxBacklog} messages waiting</p>
            <p>Oldest waiting message: {summary.oldestEligibleEventAt ? new Date(summary.oldestEligibleEventAt).toLocaleString() : "No messages waiting"}</p>
            <Link className="text-link" href="/admin/notifications/history">Review delivery history →</Link>
          </section>
        </div>
      </AdminShell>
    );
  }

  if (area === "content" && !id) {
    return (
      <AdminShell admin={admin} title="Website Content">
        <table className="admin-table">
          <thead><tr><th>Section</th><th>Version</th><th>Published</th><th /></tr></thead>
          <tbody>
            {(await repository.listSections()).map((section) => (
              <tr key={section.key}>
                <td><strong>{section.displayName}</strong></td>
                <td>v{section.schemaVersion}</td>
                <td>{section.publishedAt ? new Date(section.publishedAt).toLocaleString() : "Never"}</td>
                <td><Link className="text-link" href={`/admin/content/${section.key}`}>Edit →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminShell>
    );
  }

  if (area === "content" && id) {
    const key = sectionKeySchema.parse(id);
    const section = await repository.getSection(key);
    const revisions = await repository.listSectionRevisions(key);
    return (
      <AdminShell admin={admin} title={`Edit ${section.displayName}`}>
        <SectionEditor
          initialSection={section}
          initialRevisions={revisions}
          initialMedia={await listMediaAssets()}
        />
      </AdminShell>
    );
  }

  if (area === "preview" && id) {
    const key = sectionKeySchema.parse(id);
    const section = await repository.getSection(key);
    return (
      <div className="admin-preview">
        <div className="preview-banner" role="status">
          Saved draft preview · {section.displayName} · Not visible to the public
        </div>
        <SiteHome {...(await loadAdminPreviewData(key))} />
      </div>
    );
  }

  if (area === "rentals") {
    const rentals = await repository.listRentals();
    return (
      <AdminShell admin={admin} title={id ? "Rental Details" : "Rentals"}>
        {id ? (
          <RentalEditor
            rental={id === "new" ? null : await repository.getRental(id)}
            initialMedia={await listMediaAssets()}
            sourceMarker={id === "new" ? undefined : await getAutomationRepository().getRental(id)}
          />
        ) : (
          <>
            <div className="admin-list-toolbar">
              <p>{rentals.length} listings · Draft, published, and archived inventory</p>
              <Link className="button" href="/admin/rentals/new">Add rental</Link>
            </div>
            <table className="admin-table">
              <thead><tr><th>Rental</th><th>Rent</th><th>Status</th><th /></tr></thead>
              <tbody>{rentals.map((rental) => (
                <tr key={rental.id}>
                  <td><strong>{rental.title}</strong><br /><small>{rental.addressLine}</small></td>
                  <td>${(rental.monthlyRentCents / 100).toLocaleString()}</td>
                  <td><span className={`status ${rental.status}`}>{rental.status}</span></td>
                  <td><Link className="text-link" href={`/admin/rentals/${rental.id}`}>Open →</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </AdminShell>
    );
  }

  if (area === "tenants") {
    const tenants = await repository.listTenants();
    return (
      <AdminShell admin={admin} title={id ? "Tenant Details" : "Tenants"}>
        {id ? (
          <TenantEditor
            initial={id === "new" ? null : await repository.getTenant(id)}
            templates={await repository.listTemplates()}
            sourceMarker={id === "new"
              ? undefined
              : (await getAutomationRepository().getTenant(id)).tenant}
          />
        ) : (
          <>
            <div className="admin-list-toolbar">
              <p>{tenants.length} tenant records · Contact details are masked in this list</p>
              <Link className="button" href="/admin/tenants/new">Add tenant</Link>
            </div>
            <table className="admin-table">
              <thead><tr><th>Tenant</th><th>Property</th><th>Contact</th><th>Channels</th><th>Status</th><th /></tr></thead>
              <tbody>{tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td><strong>{tenant.fullName}</strong></td>
                  <td>{tenant.propertyLabel} {tenant.unitLabel}</td>
                  <td><small>{maskEmail(tenant.email)}<br />{maskPhone(tenant.phoneE164)}</small></td>
                  <td>{tenant.preferredChannels.join(", ") || "None"}</td>
                  <td><span className={`status ${tenant.isActive ? "published" : "archived"}`}>{tenant.isActive ? "Active" : "Inactive"}</span></td>
                  <td><Link className="text-link" href={`/admin/tenants/${tenant.id}`}>Open →</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </AdminShell>
    );
  }

  if (area === "notifications" && id === "templates") {
    return (
      <AdminShell admin={admin} title="Notification Templates">
        <TemplateManager initialTemplates={await repository.listTemplates()} />
      </AdminShell>
    );
  }

  if (area === "notifications" && id === "history") {
    return (
      <AdminShell admin={admin} title="Delivery History">
        <DeliveryHistory initialEvents={await repository.listEvents()} tenants={await repository.listTenants()} />
      </AdminShell>
    );
  }

  if (area === "notifications" && id === "send") {
    return (
      <AdminShell admin={admin} title="Send Rent Reminder">
        <SendReminder tenants={await repository.listTenants()} templates={await repository.listTemplates()} />
      </AdminShell>
    );
  }

  if (area === "settings") {
    const pause = await repository.getPause();
    return (
      <AdminShell admin={admin} title="Settings">
        <ReminderSettings
          initialPause={pause}
          forcePaused={process.env.REMINDERS_FORCE_PAUSED !== "false"}
          providerMode={process.env.NOTIFICATION_PROVIDER_MODE ?? "mock"}
          initialTestContacts={await repository.getTestContacts()}
        />
      </AdminShell>
    );
  }

  if (area === "automation") {
    const automationRepository = getAutomationRepository();
    if (!id) {
      return (
        <AdminShell admin={admin} title="Automation">
          <AutomationOverview summary={await automationRepository.automationSummary()} />
        </AdminShell>
      );
    }
    if (id === "service-accounts") {
      return (
        <AdminShell admin={admin} title="Automation Service Accounts">
          <ServiceAccountManager
            initialAccounts={await automationRepository.listServiceAccounts()}
            delegatedAdminUserId={admin.userId}
          />
        </AdminShell>
      );
    }
    if (id === "imports") {
      return (
        <AdminShell admin={admin} title="Tenant Import History">
          <TenantImportHistory imports={await automationRepository.listImportsForAdmin()} />
        </AdminShell>
      );
    }
    if (id === "audit") {
      return (
        <AdminShell admin={admin} title="Automation Audit">
          <AutomationAudit events={await automationRepository.listAutomationAudit()} />
        </AdminShell>
      );
    }
  }

  return (
    <AdminShell admin={admin} title="Not Found">
      <div className="card"><p>This admin page does not exist.</p><Link className="text-link" href="/admin">Dashboard →</Link></div>
    </AdminShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function maskEmail(value: string | null) {
  if (!value) return "No email";
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string | null) {
  return value ? `${value.slice(0, 3)}***${value.slice(-2)}` : "No phone";
}
