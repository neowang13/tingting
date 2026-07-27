"use client";

import { useMemo, useState } from "react";
import type { NotificationEvent, Tenant } from "@/lib/contracts";
import {
  notificationSourceLabel,
  notificationStatusCopy
} from "@/lib/notification-copy";

export function DeliveryHistory({
  initialEvents,
  tenants,
  loadedAt
}: {
  initialEvents: NotificationEvent[];
  tenants: Tenant[];
  loadedAt: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("email");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState("Showing the latest recorded email status.");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(new Date(loadedAt));
  const tenantNames = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.id, tenant.fullName])),
    [tenants]
  );
  const filtered = events.filter((event) => {
    if (status && event.status !== status) return false;
    if (channel && event.channel !== channel) return false;
    const tenantName = tenantNames.get(event.tenantId) ?? "";
    if (query && !tenantName.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
    return true;
  });

  async function applyFilters() {
    setMessage("Refreshing email activity…");
    const parameters = new URLSearchParams();
    if (channel) parameters.set("channel", channel);
    if (status) parameters.set("status", status);
    if (start) parameters.set("start", start);
    if (end) parameters.set("end", end);
    const matchingTenant = tenants.find(
      (tenant) => tenant.fullName.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
    );
    if (matchingTenant) parameters.set("tenantId", matchingTenant.id);
    const response = await fetch(`/api/admin/notifications/events?${parameters}`);
    const result = await response.json();
    if (!response.ok || !result.success) {
      setMessage(result.error?.message ?? "Delivery history could not be loaded.");
      return;
    }
    setEvents(result.data);
    setLastRefreshedAt(new Date());
    setMessage(`Updated. Showing ${result.data.length} recorded ${result.data.length === 1 ? "event" : "events"}.`);
  }

  async function retry(event: NotificationEvent) {
    if (!window.confirm("Try sending this email again? The original result will stay in the activity history.")) return;
    setMessage("Adding a retry to the delivery queue…");
    try {
      const response = await fetch(`/api/admin/notifications/events/${event.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Retry could not be created.");
      setEvents((current) => [result.data, ...current]);
      setMessage("Retry requested. Its status is “Waiting to send” until the delivery system runs.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry could not be created.");
    }
  }

  return (
    <div className="prototype-page email-activity-page">
      <p className="prototype-legend" aria-label="How to read email status">
        Waiting = not sent yet · Sent/Delivered = accepted by the provider · Needs attention = failed, skipped, or unclear
      </p>
      <div className="prototype-filter-toolbar email-activity-filters">
        <label className="sr-only" htmlFor="activity-tenant">Tenant</label>
        <input id="activity-tenant" type="search" placeholder="Tenant: All" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="sr-only" htmlFor="activity-channel">Channel</label>
        <select id="activity-channel" value={channel} onChange={(event) => setChannel(event.target.value)}>
          <option value="">Channel: All</option><option value="email">Channel: Email</option><option value="sms">Channel: SMS</option>
        </select>
        <label className="sr-only" htmlFor="activity-status">Status</label>
        <select id="activity-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Status: All</option>
          {["scheduled", "processing", "queued", "sent", "delivered", "failed", "undelivered", "skipped", "unknown", "expired", "cancelled"].map((item) => (
            <option value={item} key={item}>{notificationStatusCopy(item as NotificationEvent["status"]).label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-start">From date</label>
        <input id="activity-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        <label className="sr-only" htmlFor="activity-end">Through date</label>
        <input id="activity-end" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        <button className="button secondary" type="button" onClick={() => void applyFilters()}>Refresh status</button>
      </div>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>Tenant</th><th>Type</th><th>Result</th><th>Sent to</th><th>Planned time</th><th /></tr></thead>
          <tbody>{filtered.map((event) => (
            <tr key={event.id}>
              <td>{tenantNames.get(event.tenantId) ?? "Archived tenant"}</td>
              <td>{notificationSourceLabel(event.source)}</td>
              <td className={`prototype-status ${notificationStatusCopy(event.status).tone}`}>
                {notificationStatusCopy(event.status).label}
                {event.lastErrorCode ? ` — ${plainReason(event.lastErrorCode)}` : ""}
              </td>
              <td>{event.destinationMasked ?? "—"}</td>
              <td>{new Date(event.scheduledFor).toLocaleString()}</td>
              <td>{["failed", "undelivered", "unknown"].includes(event.status) ? (
                <button className="row-action" type="button" onClick={() => void retry(event)}>Try again</button>
              ) : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <strong>No email activity matches these filters.</strong>
          <p>Set up a tenant’s automatic reminder or send a test from Reminder settings to create an email record.</p>
        </div>
      )}
      <p className="admin-save-status activity-refresh-status" aria-live="polite">
        {message} Last refreshed{" "}
        {lastRefreshedAt.toLocaleTimeString("en-CA", { timeZone: "America/Vancouver" })}.
      </p>
    </div>
  );
}

function plainReason(code: string) {
  const reasons: Record<string, string> = {
    TENANT_INACTIVE: "Tenant is inactive. Reactivate and recheck permission before retrying.",
    CHANNEL_NO_LONGER_ELIGIBLE: "Contact permission or destination changed. Review the tenant first.",
    AMBIGUOUS_PROVIDER_OUTCOME: "Provider acceptance is unknown. Reconcile before retrying.",
    PROVIDER_NETWORK_ERROR: "The email provider connection failed. Check the service before trying again.",
    OCCURRENCE_EXPIRED: "The reminder was more than 24 hours late, so the system did not send it.",
    CHANNEL_NOT_ELIGIBLE: "The tenant is inactive, the email is missing, or email permission is not allowed."
  };
  return reasons[code] ?? code.replaceAll("_", " ").toLocaleLowerCase();
}
