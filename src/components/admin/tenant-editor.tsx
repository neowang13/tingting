"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type {
  NotificationTemplate,
  ReminderSchedule,
  Tenant
} from "@/lib/contracts";

const contactStatuses = [
  "unconfirmed",
  "allowed",
  "opted_out",
  "invalid",
  "bounced",
  "complained",
  "suppressed"
] as const;

export function TenantEditor({
  initial,
  templates,
  sourceMarker
}: {
  initial: { tenant: Tenant; schedule: ReminderSchedule | null } | null;
  templates: NotificationTemplate[];
  sourceMarker?: { sourceSystem: string | null; externalReference: string | null };
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState(initial?.tenant ?? null);
  const [schedule, setSchedule] = useState(initial?.schedule ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("No unsaved changes.");
  const [nextRunPreview, setNextRunPreview] = useState<{
    nextRunAt: string | null;
    timezone: string;
    error: string | null;
  }>({
    nextRunAt: schedule?.nextRunAt ?? null,
    timezone: schedule?.timezone ?? initial?.tenant.timezone ?? "America/Vancouver",
    error: null
  });
  const emailTemplates = templates.filter((template) => template.channel === "email" && template.isActive);
  const smsTemplates = templates.filter((template) => template.channel === "sms" && template.isActive);

  async function previewSchedule(form: HTMLFormElement) {
    const data = new FormData(form);
    const dayOfMonth = Number(data.get("dayOfMonth"));
    const localTime = String(data.get("localTime"));
    const timezone = String(data.get("timezone"));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31 || !localTime || !timezone) {
      setNextRunPreview({ nextRunAt: null, timezone, error: "Enter a valid day, time, and timezone." });
      return;
    }
    const response = await fetch("/api/admin/schedules/next-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dayOfMonth, localTime, timezone })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      setNextRunPreview({ nextRunAt: null, timezone, error: "Enter a valid IANA timezone." });
      return;
    }
    setNextRunPreview({ ...result.data, error: null });
  }

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const preferredChannels = ["email", "sms"].filter((channel) => form.get(`preferred-${channel}`));
    const payload = {
      fullName: String(form.get("fullName")),
      propertyLabel: String(form.get("propertyLabel")),
      unitLabel: String(form.get("unitLabel")) || null,
      email: String(form.get("email")) || null,
      phoneE164: String(form.get("phoneE164")) || null,
      preferredChannels,
      emailContactStatus: String(form.get("emailContactStatus")),
      smsContactStatus: String(form.get("smsContactStatus")),
      emailContactStatusReason: String(form.get("emailContactStatusReason")) || null,
      smsContactStatusReason: String(form.get("smsContactStatusReason")) || null,
      emailContactStatusSource: String(form.get("emailContactStatusSource")) || null,
      smsContactStatusSource: String(form.get("smsContactStatusSource")) || null,
      contactPermissionNote: String(form.get("contactPermissionNote")) || null,
      contactPermissionUpdatedAt: new Date().toISOString(),
      timezone: String(form.get("timezone")),
      internalNotes: String(form.get("internalNotes")) || null,
      isActive: form.get("isActive") === "on"
    };

    setBusy(true);
    setMessage("Saving tenant…");
    try {
      const response = await fetch(tenant ? `/api/admin/tenants/${tenant.id}` : "/api/admin/tenants", {
        method: tenant ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tenant ? { tenant: payload, expectedVersion: tenant.updatedAt } : payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Tenant could not be saved.");
      setTenant(result.data);
      setMessage("Tenant saved.");
      if (!tenant) router.replace(`/admin/tenants/${result.data.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tenant could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    const form = new FormData(event.currentTarget);
    const channels = ["email", "sms"].filter((channel) => form.get(`schedule-${channel}`));
    const payload = {
      rentDueDay: Number(form.get("rentDueDay")),
      dayOfMonth: Number(form.get("dayOfMonth")),
      localTime: String(form.get("localTime")),
      timezone: String(form.get("timezone")),
      channels,
      emailTemplateId: String(form.get("emailTemplateId")) || null,
      smsTemplateId: String(form.get("smsTemplateId")) || null,
      isEnabled: form.get("isEnabled") === "on"
    };
    setBusy(true);
    setMessage("Saving schedule…");
    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedule: payload, expectedVersion: schedule?.updatedAt ?? null })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Schedule could not be saved.");
      setSchedule(result.data);
      setMessage("Schedule saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveTenant() {
    if (!tenant || !window.confirm("Archive this tenant and disable future reminders?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: tenant.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Tenant could not be archived.");
      setTenant(result.data);
      setSchedule((current) => current ? { ...current, isEnabled: false, nextRunAt: null } : current);
      setMessage("Tenant archived. Future reminders are disabled.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tenant could not be archived.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-editor-stack">
      <form className="card admin-form" onSubmit={saveTenant}>
        {sourceMarker?.sourceSystem && (
          <p className="source-marker">
            Source: {sourceMarker.sourceSystem === "openclaw" ? "OpenClaw Operations" : sourceMarker.sourceSystem}
            {sourceMarker.externalReference ? ` · ${sourceMarker.externalReference}` : ""}
          </p>
        )}
        <div className="admin-card-heading">
          <div><p className="eyebrow">TENANT RECORD</p><h2>{tenant?.fullName ?? "New tenant"}</h2></div>
          <span className={`status ${tenant?.isActive ? "published" : "archived"}`}>
            {tenant?.isActive ?? true ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="field-grid">
          <label className="field"><span>Full name</span><input name="fullName" required defaultValue={tenant?.fullName} /></label>
          <label className="field"><span>Property</span><input name="propertyLabel" required defaultValue={tenant?.propertyLabel} /></label>
          <label className="field"><span>Unit</span><input name="unitLabel" defaultValue={tenant?.unitLabel ?? ""} /></label>
          <label className="field"><span>Timezone</span><input name="timezone" required defaultValue={tenant?.timezone ?? "America/Vancouver"} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" defaultValue={tenant?.email ?? ""} /></label>
          <label className="field"><span>Phone (E.164)</span><input name="phoneE164" placeholder="+16045550123" defaultValue={tenant?.phoneE164 ?? ""} /></label>
          <fieldset className="field-group field-wide">
            <legend>Preferred channels</legend>
            <label className="check-field"><input name="preferred-email" type="checkbox" defaultChecked={tenant?.preferredChannels.includes("email")} /> Email</label>
            <label className="check-field"><input name="preferred-sms" type="checkbox" defaultChecked={tenant?.preferredChannels.includes("sms")} /> SMS</label>
          </fieldset>
          <label className="field"><span>Email permission</span>
            <select name="emailContactStatus" defaultValue={tenant?.emailContactStatus ?? "unconfirmed"}>
              {contactStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="field"><span>Email permission source</span><input name="emailContactStatusSource" defaultValue={tenant?.emailContactStatusSource ?? ""} /></label>
          <label className="field field-wide"><span>Email permission note/reason</span><input name="emailContactStatusReason" defaultValue={tenant?.emailContactStatusReason ?? ""} /></label>
          <label className="field"><span>SMS permission</span>
            <select name="smsContactStatus" defaultValue={tenant?.smsContactStatus ?? "unconfirmed"}>
              {contactStatuses.filter((status) => !["bounced", "complained"].includes(status)).map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="field"><span>SMS permission source</span><input name="smsContactStatusSource" defaultValue={tenant?.smsContactStatusSource ?? ""} /></label>
          <label className="field field-wide"><span>SMS permission note/reason</span><input name="smsContactStatusReason" defaultValue={tenant?.smsContactStatusReason ?? ""} /></label>
          <label className="field field-wide"><span>Permission record</span><textarea name="contactPermissionNote" rows={3} defaultValue={tenant?.contactPermissionNote ?? ""} /></label>
          <label className="field field-wide"><span>Internal notes</span><textarea name="internalNotes" rows={4} defaultValue={tenant?.internalNotes ?? ""} /></label>
          <label className="check-field field-wide"><input name="isActive" type="checkbox" defaultChecked={tenant?.isActive ?? true} /> Active tenant</label>
        </div>
        <div className="admin-action-bar">
          <button className="button secondary" disabled={busy} type="submit">Save tenant</button>
          {tenant && !tenant.archivedAt && (
            <button className="button danger-outline" disabled={busy} type="button" onClick={() => void archiveTenant()}>Archive tenant</button>
          )}
        </div>
      </form>

      {tenant && (
        <form
          className="card admin-form"
          onSubmit={saveSchedule}
          onInput={(event) => void previewSchedule(event.currentTarget)}
        >
          <div className="admin-card-heading">
            <div><p className="eyebrow">MONTHLY REMINDER</p><h2>Schedule</h2></div>
            <span className={`status ${schedule?.isEnabled ? "published" : "draft"}`}>
              {schedule?.isEnabled ? "Enabled" : "Paused"}
            </span>
          </div>
          <div className="field-grid">
            <label className="field"><span>Rent due day</span><input name="rentDueDay" type="number" min="1" max="31" defaultValue={schedule?.rentDueDay ?? 1} /></label>
            <label className="field"><span>Reminder day</span><input name="dayOfMonth" type="number" min="1" max="31" defaultValue={schedule?.dayOfMonth ?? 28} /></label>
            <label className="field"><span>Local time</span><input name="localTime" type="time" defaultValue={schedule?.localTime ?? "09:00"} /></label>
            <label className="field"><span>Timezone</span><input name="timezone" defaultValue={schedule?.timezone ?? tenant.timezone} /></label>
            <fieldset className="field-group field-wide">
              <legend>Channels</legend>
              <label className="check-field"><input name="schedule-email" type="checkbox" defaultChecked={schedule?.channels.includes("email")} /> Email</label>
              <label className="check-field"><input name="schedule-sms" type="checkbox" defaultChecked={schedule?.channels.includes("sms")} /> SMS</label>
            </fieldset>
            <label className="field"><span>Email template</span>
              <select name="emailTemplateId" defaultValue={schedule?.emailTemplateId ?? ""}>
                <option value="">Select email template</option>
                {emailTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="field"><span>SMS template</span>
              <select name="smsTemplateId" defaultValue={schedule?.smsTemplateId ?? ""}>
                <option value="">Select SMS template</option>
                {smsTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="check-field field-wide"><input name="isEnabled" type="checkbox" defaultChecked={schedule?.isEnabled} /> Enable automatic reminders</label>
          </div>
          {nextRunPreview.nextRunAt && (
            <p className="next-run">
              Next reminder before save: {new Date(nextRunPreview.nextRunAt).toLocaleString("en-CA", { timeZone: nextRunPreview.timezone })} ({nextRunPreview.timezone})
            </p>
          )}
          {nextRunPreview.error && <p className="warning-callout">{nextRunPreview.error}</p>}
          <button className="button secondary" disabled={busy} type="submit">Save schedule</button>
        </form>
      )}
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </div>
  );
}
