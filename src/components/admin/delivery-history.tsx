"use client";

import { useMemo, useState } from "react";
import type { NotificationEvent, Tenant } from "@/lib/contracts";

export function DeliveryHistory({
  initialEvents,
  tenants
}: {
  initialEvents: NotificationEvent[];
  tenants: Tenant[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState("");
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
    setMessage("Loading delivery history…");
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
    setMessage(`Loaded ${result.data.length} events. Dates filter scheduledFor in UTC.`);
  }

  async function retry(event: NotificationEvent) {
    if (!window.confirm("Create a new retry event? The original history will remain unchanged.")) return;
    setMessage("Creating retry…");
    try {
      const response = await fetch(`/api/admin/notifications/events/${event.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Retry could not be created.");
      setEvents((current) => [result.data, ...current]);
      setMessage("A new retry event was queued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry could not be created.");
    }
  }

  return (
    <div className="card">
      <div className="history-filters">
        <label className="field"><span>Tenant</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="field"><span>Channel</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">All channels</option><option value="email">Email</option><option value="sms">SMS</option>
          </select>
        </label>
        <label className="field"><span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {["scheduled", "processing", "queued", "sent", "delivered", "failed", "undelivered", "skipped", "unknown", "expired", "cancelled"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Scheduled from (UTC)</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="field"><span>Scheduled through (UTC)</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <button className="button secondary" type="button" onClick={() => void applyFilters()}>Apply server filters</button>
      </div>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>Tenant</th><th>Channel</th><th>Source</th><th>Status</th><th>Destination</th><th>Scheduled</th><th>Action</th></tr></thead>
          <tbody>{filtered.map((event) => (
            <tr key={event.id}>
              <td>{tenantNames.get(event.tenantId) ?? "Archived tenant"}</td>
              <td>{event.channel}</td>
              <td>{event.source}</td>
              <td><span className={`status ${event.status}`}>{event.status}</span>{event.lastErrorCode && <small className="reason">{plainReason(event.lastErrorCode)}</small>}</td>
              <td>{event.destinationMasked ?? "—"}</td>
              <td>{new Date(event.scheduledFor).toLocaleString()}</td>
              <td>{["failed", "undelivered", "unknown"].includes(event.status) ? (
                <button className="icon-text-button" type="button" onClick={() => void retry(event)}>Retry</button>
              ) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!filtered.length && <p className="empty-copy">No delivery events match these filters.</p>}
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </div>
  );
}

function plainReason(code: string) {
  const reasons: Record<string, string> = {
    TENANT_INACTIVE: "Tenant is inactive. Reactivate and recheck permission before retrying.",
    CHANNEL_NO_LONGER_ELIGIBLE: "Contact permission or destination changed. Review the tenant first.",
    AMBIGUOUS_PROVIDER_OUTCOME: "Provider acceptance is unknown. Reconcile before retrying.",
    PROVIDER_NETWORK_ERROR: "The provider connection failed. Try again after checking service status."
  };
  return reasons[code] ?? code.replaceAll("_", " ").toLocaleLowerCase();
}
