import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { SectionEditor } from "@/components/admin/section-editor";
import { RentalEditor } from "@/components/admin/rental-editor";
import { TenantEditor } from "@/components/admin/tenant-editor";
import { TemplateManager } from "@/components/admin/template-manager";
import { DeliveryHistory } from "@/components/admin/delivery-history";
import { ReminderSettings } from "@/components/admin/reminder-settings";
import { SiteHome } from "@/components/public/site-home";
import { ServiceLandingPage } from "@/components/public/service-landing-page";
import { RentalDetailPage } from "@/components/public/rental-detail-page";
import { getRepository } from "@/data/repository";
import { sectionKeySchema } from "@/features/content/schemas";
import {
  loadAdminPreviewData,
  loadPublicHomepageData
} from "@/features/content/public-homepage";
import { loadAdminRentalPreviewData } from "@/features/content/public-rental-detail";
import { loadAdminServicePagePreviewData } from "@/features/content/public-service-page";
import { listMediaAssets } from "@/features/content/media-service";
import { requireAdminPage } from "@/lib/auth";
import { isServicePageSectionKey, type SectionKey } from "@/lib/contracts";
import { sectionAdminCopy } from "@/features/content/admin-copy";
import {
  deliveryModeCopy,
  notificationSourceLabel,
  notificationStatusCopy
} from "@/lib/notification-copy";
import { Temporal } from "@js-temporal/polyfill";
import { ApplicationQueue } from "@/components/admin/application-queue";
import { listApplicationsForStaff } from "@/features/applications/service";

interface Props {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function AdminPage({ params, searchParams }: Props) {
  const admin = await requireAdminPage();
  const { segments = [] } = await params;
  const [area, id, action] = segments;
  const repository = getRepository();

  if (!area) {
    const [summary, recentEvents, dashboardTenants] = await Promise.all([
      repository.dashboard(),
      repository.listEvents({ limit: 5 }),
      repository.listTenants({ limit: 500 })
    ]);
    const tenantNames = new Map(dashboardTenants.map((tenant) => [tenant.id, tenant.fullName]));
    const forcePaused = process.env.REMINDERS_FORCE_PAUSED !== "false";
    const effectivePaused = summary.remindersPaused || forcePaused;
    const emailProviderMode = process.env.EMAIL_PROVIDER_MODE ??
      (process.env.NODE_ENV === "production" ? "disabled" : "mock");
    const deliveryMode = deliveryModeCopy(emailProviderMode);
    const systemReady = !effectivePaused && emailProviderMode === "live";
    return (
      <AdminShell
        admin={admin}
        title="Home"
        description="Whether reminders can send, what is next, and what needs attention."
      >
        <div className="prototype-page overview-page">
          <section className={`prototype-status-banner ${systemReady ? "success" : "waiting"}`}>
            <div>
              <strong>{systemReady ? "Ready to send." : effectivePaused ? "Sending is paused." : `${deliveryMode.label}.`}</strong>{" "}
              {systemReady
                ? "Automatic rent reminders can be delivered right now."
                : effectivePaused
                  ? "Saved tenant plans will wait until sending is resumed."
                  : deliveryMode.explanation}
            </div>
            <Link className="text-link" href="/admin/settings">Reminder settings →</Link>
          </section>
          <div className="metric-grid">
            <Metric label="Current tenants" value={summary.activeTenants} />
            <Metric label="Automatic reminders on" value={summary.enabledSchedules} />
            <Metric label="Emails planned in 7 days" value={summary.dueNextSevenDays} />
            <Metric label="Delivery problems" value={summary.failedLastThirtyDays} tone="danger" />
            <Metric label="Waiting to send" value={summary.outboxBacklog} />
          </div>
          {summary.warnings.length > 0 && (
            <section className="prototype-attention" aria-labelledby="warnings-heading">
              <strong id="warnings-heading">Needs attention</strong>
              {summary.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </section>
          )}
          <div className="dashboard-status-grid">
            <section className="prototype-panel">
            <h2>Last system check</h2>
              <strong className={effectivePaused ? "prototype-status waiting" : "prototype-status success"}>
                {effectivePaused ? "Paused" : "Running"}
              </strong>
              <p>
                {summary.lastWorkerRunAt
                  ? `Last run ${new Date(summary.lastWorkerRunAt).toLocaleString()} — ${workerStatusLabel(summary.latestWorkerStatus).toLocaleLowerCase()}.`
                  : forcePaused
                    ? "The deployment-level pause is on. The reminder system has not run yet."
                    : "The reminder system has not run yet."}
              </p>
            </section>
            <section className="prototype-panel">
            <h2>Messages waiting to send</h2>
              <p>
                {summary.outboxBacklog} {summary.outboxBacklog === 1 ? "message" : "messages"}
                {summary.oldestEligibleEventAt
                  ? `, earliest waiting since ${new Date(summary.oldestEligibleEventAt).toLocaleTimeString()}`
                  : ", nothing is waiting right now"}.
              </p>
              <Link className="text-link" href="/admin/notifications/history">View in Email activity →</Link>
            </section>
          </div>
          <section className="prototype-table-panel">
            <div className="prototype-table-title">Recent emails</div>
            <table className="admin-table">
              <thead><tr><th>Tenant</th><th>Type</th><th>Result</th><th>Sent to</th><th>Planned time</th></tr></thead>
              <tbody>{recentEvents.map((event) => (
                <tr key={event.id}>
                  <td>{tenantNames.get(event.tenantId) ?? "Archived tenant"}</td>
                  <td>{notificationSourceLabel(event.source)}</td>
                  <td className={`prototype-status ${notificationStatusCopy(event.status).tone}`}>
                    {notificationStatusCopy(event.status).label}
                  </td>
                  <td>{event.destinationMasked ?? "—"}</td>
                  <td>{new Date(event.scheduledFor).toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
            {recentEvents.length === 0 && <p className="prototype-empty-row">No reminder emails have been created yet.</p>}
          </section>
        </div>
      </AdminShell>
    );
  }

  if (area === "content" && !id) {
    const sections = await repository.listSections();
    const sectionMap = new Map(sections.map((section) => [section.key, section]));
    const unpublishedDrafts = sections.filter(hasUnpublishedChanges).length;
    const latestPublish = sections
      .map((section) => section.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return (
      <AdminShell
        admin={admin}
        title="Website content"
        description="Edit the words and images visitors see. Saving keeps changes private; publishing makes them live."
      >
        <div className="content-page">
          <div className="content-summary">
            <span>
              {sections.length} content areas · {unpublishedDrafts} unpublished{" "}
              {unpublishedDrafts === 1 ? "draft" : "drafts"} · Last website publish{" "}
              {latestPublish ? new Date(latestPublish).toLocaleString() : "Never"}
            </span>
            <Link className="text-link" href="/" target="_blank">View live website ↗</Link>
          </div>
          <div className="content-workflow-note">
            <strong>Edit → Save draft → Preview → Publish.</strong>{" "}
            <span>Saved drafts are private. Visitors only see a change after you publish it.</span>
          </div>
          <div className="content-groups">
            {contentGroups.map((group) => (
              <section className="content-group" key={group.title}>
                <div className="content-group-heading">
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
                <div className="content-section-list">
                  {group.keys.map((key) => {
                    const section = sectionMap.get(key);
                    if (!section) return null;
                    const hasDraft = hasUnpublishedChanges(section);
                    const isServicePage = key.startsWith("service_");
                    return (
                      <div className="content-section-row" key={section.key}>
                        <div className="content-section-name">
                          <strong>{sectionAdminCopy[section.key].title}</strong>
                          {isServicePage && <small>{sectionAdminCopy[section.key].publicLocation}</small>}
                        </div>
                        <span className={hasDraft ? "content-state waiting" : "content-state"}>
                          {hasDraft ? "Unpublished draft" : "No unpublished changes"}
                        </span>
                        <span className={section.publishedAt ? "content-state live" : "content-state"}>
                          {section.publishedAt ? "Live on website" : "Not published"}
                        </span>
                        <span className="content-published-date">
                          {section.publishedAt
                            ? new Date(section.publishedAt).toLocaleDateString("en-CA", {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                              })
                            : "Never"}
                        </span>
                        <Link className="row-action" href={`/admin/content/${section.key}`}>
                          {group.action}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </AdminShell>
    );
  }

  if (area === "content" && id) {
    const key = sectionKeySchema.parse(id);
    const section = await repository.getSection(key);
    const revisions = await repository.listSectionRevisions(key);
    return (
      <AdminShell
        admin={admin}
        title={sectionAdminCopy[key].title}
        description={`${sectionAdminCopy[key].description} Appears at: ${sectionAdminCopy[key].publicLocation}.`}
      >
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
    if (isServicePageSectionKey(key)) {
      const [servicePage, homepage] = await Promise.all([
        loadAdminServicePagePreviewData(key),
        loadPublicHomepageData()
      ]);
      return (
        <div className="admin-preview">
          <div className="preview-banner" role="status">
            Previewing saved changes to {sectionAdminCopy[key].title} · Visitors cannot see this version
          </div>
          <ServiceLandingPage
            page={servicePage.page}
            sectionKey={servicePage.sectionKey}
            sections={homepage.sections}
            mediaUrls={servicePage.mediaUrls}
          />
        </div>
      );
    }
    return (
      <div className="admin-preview">
        <div className="preview-banner" role="status">
          Previewing saved changes to {sectionAdminCopy[key].title} · Visitors cannot see this version
        </div>
        <SiteHome {...(await loadAdminPreviewData(key))} />
      </div>
    );
  }

  if (area === "rentals") {
    if (id && id !== "new" && action === "preview") {
      return (
        <div className="admin-preview">
          <div className="preview-banner" role="status">
            Private draft preview · Visitors cannot see this version ·{" "}
            <Link href={`/admin/rentals/${id}`}>Return to Admin</Link>
          </div>
          <RentalDetailPage {...(await loadAdminRentalPreviewData(id))} />
        </div>
      );
    }
    const rentals = await repository.listRentals();
    return (
      <AdminShell
        admin={admin}
        title={id ? "Rental editor" : "Rental listings"}
        description={id
          ? "Edit a rental listing and its public photos."
          : "Manage the rental listings shown on the public website."}
      >
        {id ? (
          <RentalEditor
            rental={id === "new" ? null : await repository.getRental(id)}
            initialMedia={await listMediaAssets()}
          />
        ) : (
          <div className="prototype-page rentals-list-page">
            <div className="prototype-list-toolbar">
              <p>
                {rentals.length} rentals · {rentals.filter((rental) => rental.status === "published").length} live ·{" "}
                {rentals.filter((rental) => rental.status === "draft").length} draft ·{" "}
                {rentals.filter((rental) => rental.status === "archived").length} archived
              </p>
              <Link className="button" href="/admin/rentals/new">Add rental listing</Link>
            </div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead><tr><th>Title / Address</th><th>Monthly rent</th><th>Website status</th><th /></tr></thead>
                <tbody>{rentals.map((rental) => (
                  <tr key={rental.id}>
                    <td><strong>{rental.title}</strong><br /><small>{rental.addressLine}</small></td>
                    <td>${(rental.monthlyRentCents / 100).toLocaleString()}</td>
                    <td className={`prototype-status ${rental.status}`}>{rentalStatusLabel(rental.status)}</td>
                    <td><Link className="row-action" href={`/admin/rentals/${rental.id}`}>Edit</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </AdminShell>
    );
  }

  if (area === "tenants") {
    const query = await searchParams;
    const value = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
    const tenants = await repository.listTenants({
      query: value("q") || undefined,
      lifecycle: (value("lifecycle") || undefined) as "active" | "inactive" | "archived" | undefined,
      schedule: (value("schedule") || undefined) as "enabled" | "disabled" | "missing" | undefined,
      rentStatus: (value("rent") || undefined) as "due" | "collected" | undefined,
      leaseType: (value("lease") || undefined) as "month_to_month" | "fixed_term" | "needs_details" | undefined,
      limit: 500
    });
    const tenantTimezone = process.env.DEFAULT_TIMEZONE ?? "America/Vancouver";
    const tenantToday = Temporal.Now.instant()
      .toZonedDateTimeISO(tenantTimezone)
      .toPlainDate();
    const leaseWarningEnd = tenantToday.add({ days: 30 }).toString();
    const tenantTodayString = tenantToday.toString();
    if (id) {
      const [initialTenant, pause] = await Promise.all([
        id === "new" ? Promise.resolve(null) : repository.getTenant(id),
        repository.getPause()
      ]);
      return (
        <AdminShell
          admin={admin}
          title="Tenant & reminder"
          description="Save tenant details and their monthly rent reminder together."
        >
          <TenantEditor
            initial={initialTenant}
            reminderSystem={{
              ...pause,
              forcePaused: process.env.REMINDERS_FORCE_PAUSED !== "false",
              emailProviderMode: process.env.EMAIL_PROVIDER_MODE ??
                (process.env.NODE_ENV === "production" ? "disabled" : "mock")
            }}
            initialNotice={tenantSaveNotice(value("saved"))}
          />
        </AdminShell>
      );
    }
    return (
      <AdminShell
        admin={admin}
        title="Tenants & schedules"
        description="Search tenants and see reminder and delivery status."
      >
          <div className="prototype-page tenants-list-page">
            <form className="prototype-filter-toolbar" method="get">
              <label className="sr-only" htmlFor="tenant-search">Search name, property or unit</label>
              <input id="tenant-search" name="q" placeholder="Search name, property or unit" type="search" defaultValue={value("q")} />
              <label className="sr-only" htmlFor="tenant-lifecycle">Tenant status</label>
              <select id="tenant-lifecycle" name="lifecycle" defaultValue={value("lifecycle")}>
                <option value="">Tenant status: All</option><option value="active">Tenant status: Current</option><option value="inactive">Tenant status: Inactive</option><option value="archived">Tenant status: Archived</option>
              </select>
              <label className="sr-only" htmlFor="tenant-schedule">Automatic reminder</label>
              <select id="tenant-schedule" name="schedule" defaultValue={value("schedule")}>
                <option value="">Automatic reminder: All</option><option value="enabled">Automatic reminder: On</option><option value="disabled">Automatic reminder: Off</option><option value="missing">Automatic reminder: Not set up</option>
              </select>
              <label className="sr-only" htmlFor="tenant-rent">Current month rent</label>
              <select id="tenant-rent" name="rent" defaultValue={value("rent")}>
                <option value="">Current month rent: All</option>
                <option value="due">Current month rent: Due</option>
                <option value="collected">Current month rent: Collected</option>
              </select>
              <label className="sr-only" htmlFor="tenant-lease">Lease type</label>
              <select id="tenant-lease" name="lease" defaultValue={value("lease")}>
                <option value="">Lease type: All</option>
                <option value="month_to_month">Month to month</option>
                <option value="fixed_term">Fixed contract</option>
                <option value="needs_details">Needs lease details</option>
              </select>
              <button className="sr-only" type="submit">Apply filters</button>
              <Link className="button" href="/admin/tenants/new">Add tenant and reminder</Link>
            </form>
            <div className="table-scroll">
              <table className="admin-table">
                <thead><tr><th>Tenant</th><th>Rental home</th><th>Lease</th><th>Current month rent</th><th>Email</th><th>Status</th><th>Next automatic email</th><th>Last email</th><th /></tr></thead>
                <tbody>{tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td><strong>{tenant.fullName}</strong></td>
                    <td>{tenant.propertyLabel} {tenant.unitLabel}</td>
                    <td className={leaseExpiryTone(
                      tenant.leaseType,
                      tenant.leaseEndDate,
                      tenant.isActive && !tenant.archivedAt,
                      tenantTodayString,
                      leaseWarningEnd
                    )}>
                      {tenant.leaseType === "month_to_month"
                        ? "Month to month"
                        : tenant.leaseType === "fixed_term"
                          ? `Fixed · ends ${formatMoveInDate(tenant.leaseEndDate)}`
                          : "Needs lease details"}
                    </td>
                    <td className={`prototype-status ${
                      !tenant.isActive || tenant.archivedAt
                        ? "neutral"
                        : tenant.currentRentPayment?.status === "collected"
                          ? "success"
                          : "waiting"
                    }`}>
                      {!tenant.isActive || tenant.archivedAt
                        ? "Not applicable"
                        : tenant.currentRentPayment?.status === "collected"
                          ? `Collected · ${tenant.currentRentPayment.collectedAt ? new Date(tenant.currentRentPayment.collectedAt).toLocaleDateString("en-CA", { timeZone: tenantTimezone, month: "short", day: "numeric" }) : "receipt recorded"}`
                          : tenant.currentRentPayment
                            ? `Not received · due ${formatMoveInDate(tenant.currentRentPayment.dueDate)}`
                            : "Complete lease details"}
                    </td>
                    <td>{maskEmail(tenant.email)}</td>
                    <td className={`prototype-status ${tenant.isActive && !tenant.archivedAt ? "success" : "neutral"}`}>
                      {tenant.archivedAt ? "Archived" : tenant.isActive ? "Current" : "Inactive"}
                    </td>
                    <td>{tenant.nextRunAt ? new Date(tenant.nextRunAt).toLocaleString() : scheduleStatusLabel(tenant.scheduleStatus)}</td>
                    <td className={tenant.lastDeliveryStatus ? `prototype-status ${notificationStatusCopy(tenant.lastDeliveryStatus).tone}` : undefined}>
                      {tenant.lastDeliveryStatus ? notificationStatusCopy(tenant.lastDeliveryStatus).label : "No emails yet"}
                      {tenant.lastDeliveryAt ? ` ${new Date(tenant.lastDeliveryAt).toLocaleDateString()}` : ""}
                    </td>
                    <td><Link className="row-action" href={`/admin/tenants/${tenant.id}`}>Manage</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
      </AdminShell>
    );
  }

  if (area === "notifications" && id === "templates") {
    return (
      <AdminShell
        admin={admin}
        title="Email templates"
        description="Create and maintain templates used by automatic reminders and test emails."
      >
        <TemplateManager initialTemplates={await repository.listTemplates()} />
      </AdminShell>
    );
  }

  if (area === "notifications" && id === "history") {
    return (
      <AdminShell
        admin={admin}
        title="Email activity"
        description="The record of what was actually sent, delivered, or failed."
      >
        <DeliveryHistory
          initialEvents={await repository.listEvents()}
          tenants={await repository.listTenants()}
          loadedAt={new Date().toISOString()}
        />
      </AdminShell>
    );
  }

  if (area === "settings") {
    const [pause, tenants, templates] = await Promise.all([
      repository.getPause(),
      repository.listTenants(),
      repository.listTemplates()
    ]);
    return (
      <AdminShell
        admin={admin}
        title="Reminder settings"
        description="Control automatic sending and see delivery service status."
      >
        <ReminderSettings
          initialSettings={pause}
          forcePaused={process.env.REMINDERS_FORCE_PAUSED !== "false"}
          emailProviderMode={
            process.env.EMAIL_PROVIDER_MODE ??
            (process.env.NODE_ENV === "production" ? "disabled" : "mock")
          }
          initialTestContacts={await repository.getTestContacts()}
          tenants={tenants}
          templates={templates}
        />
      </AdminShell>
    );
  }

  if (area === "applications") {
    return (
      <AdminShell
        admin={admin}
        title="Client applications"
        description="Receive, screen, and process private rental applications through the documented status workflow."
      >
        <ApplicationQueue initial={await listApplicationsForStaff(admin)} />
      </AdminShell>
    );
  }

  return (
    <AdminShell admin={admin} title="Page not found">
      <div className="card empty-state"><h2>This admin page does not exist</h2><Link className="text-link" href="/admin">Back to overview →</Link></div>
    </AdminShell>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function maskEmail(value: string | null) {
  if (!value) return "No email";
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

function formatMoveInDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function workerStatusLabel(value: string | null) {
  if (!value) return "Not run yet";
  return {
    completed: "Completed successfully",
    partial: "Completed with delivery problems",
    paused: "Paused without sending",
    running: "Running now"
  }[value] ?? value.replaceAll("_", " ");
}

function rentalStatusLabel(value: "draft" | "published" | "archived") {
  return {
    draft: "Saved privately",
    published: "Live on website",
    archived: "Archived"
  }[value];
}

function scheduleStatusLabel(value: "enabled" | "disabled" | "missing" | undefined) {
  return {
    enabled: "Automatic email on",
    disabled: "Automatic email off",
    missing: "Not set up"
  }[value ?? "missing"];
}

function leaseExpiryTone(
  leaseType: "month_to_month" | "fixed_term" | null,
  leaseEndDate: string | null,
  active: boolean,
  today: string,
  warningEnd: string
) {
  if (!active || leaseType !== "fixed_term" || !leaseEndDate) return undefined;
  if (leaseEndDate < today) return "prototype-status error";
  if (leaseEndDate <= warningEnd) return "prototype-status waiting";
  return undefined;
}

function tenantSaveNotice(value: string) {
  const notices: Record<string, { message: string; tone: "success" | "error" }> = {
    tenant: {
      message: "Tenant saved.",
      tone: "success"
    },
    paused: {
      message: "Tenant saved. The reminder is ready, but automatic sending is paused.",
      tone: "success"
    },
    active: {
      message: "Tenant saved. The automatic rent reminder is active.",
      tone: "success"
    },
    "catch-up": {
      message: "Tenant saved. The missed rent reminder was sent immediately.",
      tone: "success"
    },
    retry: {
      message: "Tenant saved, but the immediate reminder could not be sent. The scheduled worker will retry it.",
      tone: "error"
    },
    "not-live": {
      message: "Tenant and reminder plan saved. Email delivery is not live yet.",
      tone: "success"
    },
    off: {
      message: "Tenant and rent due date saved. Automatic email is off.",
      tone: "success"
    },
    "tenant-only": {
      message: "Tenant details were saved, but the reminder plan was not saved. Review the reminder fields and save again.",
      tone: "error"
    }
  };
  return notices[value];
}

const contentGroups: Array<{
  title: string;
  description: string;
  action: string;
  keys: SectionKey[];
}> = [
  {
    title: "Shared across the website",
    description: "Affects the header, footer and contact popup on every page.",
    action: "Edit shared content",
    keys: ["header", "contact", "footer"]
  },
  {
    title: "Homepage",
    description: "Four sections shown to visitors on tingtingproperties.example.",
    action: "Edit page",
    keys: ["hero", "property_services", "featured_rentals", "about"]
  },
  {
    title: "Service pages",
    description: "Each page publishes and rolls back as one complete unit.",
    action: "Edit page",
    keys: [
      "service_rental_management",
      "service_trade_services",
      "service_property_care",
      "service_strata"
    ]
  }
];

function hasUnpublishedChanges(section: {
  draftContent: unknown;
  publishedContent: unknown;
}) {
  return JSON.stringify(section.draftContent) !== JSON.stringify(section.publishedContent);
}
