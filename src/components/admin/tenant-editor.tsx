"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { formatRentDueDate } from "@/features/reminders/due-date";
import type {
  ReminderSchedule,
  ReminderSettings,
  Tenant
} from "@/lib/contracts";

const DEFAULT_TIMEZONE = "America/Vancouver";

interface ReminderSystemStatus extends ReminderSettings {
  forcePaused: boolean;
  emailProviderMode: string;
}

interface NextRunPreview {
  nextRunAt: string | null;
  dueDate: string | null;
  timezone: string;
  error: string | null;
}

export function TenantEditor({
  initial,
  sourceMarker,
  reminderSystem,
  initialNotice
}: {
  initial: { tenant: Tenant; schedule: ReminderSchedule | null } | null;
  sourceMarker?: { sourceSystem: string | null; externalReference: string | null };
  reminderSystem: ReminderSystemStatus;
  initialNotice?: { message: string; tone: "success" | "error" };
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState(initial?.tenant ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialNotice?.message ?? "");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">(
    initialNotice?.tone ?? "neutral"
  );
  const [email, setEmail] = useState(initial?.tenant.email ?? "");
  const [moveInDate, setMoveInDate] = useState(initial?.tenant.moveInDate ?? "");
  const [rentDueDay, setRentDueDay] = useState(
    initial?.tenant.rentDueDay ?? initial?.schedule?.rentDueDay ?? 1
  );
  const [nextRunPreview, setNextRunPreview] = useState<NextRunPreview>({
    nextRunAt: initial?.schedule?.nextRunAt ?? null,
    dueDate: null,
    timezone: reminderSystem.timezone,
    error: null
  });
  const existingEmailBlock = tenant &&
    !["allowed", "unconfirmed"].includes(tenant.emailContactStatus)
    ? tenant.emailContactStatus
    : null;

  useEffect(() => {
    if (!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 31) {
      return;
    }
    const controller = new AbortController();
    void fetch("/api/admin/schedules/next-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rentDueDay,
        moveInDate: moveInDate || null
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error();
        setNextRunPreview({
          nextRunAt: result.data.nextRunAt,
          dueDate: result.data.dueDate,
          timezone: result.data.timezone,
          error: null
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNextRunPreview((current) => ({
          ...current,
          nextRunAt: null,
          dueDate: null,
          error: "The next automatic email could not be calculated."
        }));
      });
    return () => controller.abort();
  }, [moveInDate, rentDueDay]);

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailAddress = String(form.get("email")).trim() || null;
    if (!emailAddress) {
      setMessageTone("error");
      setMessage("Enter the tenant’s email address.");
      return;
    }
    const emailContactStatus = existingEmailBlock ?? "allowed";
    const tenantPayload = {
      fullName: String(form.get("fullName")),
      propertyLabel: String(form.get("propertyLabel")),
      unitLabel: String(form.get("unitLabel")) || null,
      moveInDate: String(form.get("moveInDate")) || null,
      rentDueDay: Number(form.get("rentDueDay")),
      email: emailAddress,
      phoneE164: String(form.get("phoneE164")).trim() || null,
      preferredChannels: ["email"],
      emailContactStatus,
      smsContactStatus: tenant?.smsContactStatus ?? "unconfirmed",
      emailContactStatusReason: existingEmailBlock
        ? tenant?.emailContactStatusReason ?? null
        : null,
      smsContactStatusReason: tenant?.smsContactStatusReason ?? null,
      emailContactStatusSource: existingEmailBlock
        ? tenant?.emailContactStatusSource ?? null
        : "tenant_record",
      smsContactStatusSource: tenant?.smsContactStatusSource ?? null,
      contactPermissionNote: null,
      contactPermissionUpdatedAt: new Date().toISOString(),
      timezone: DEFAULT_TIMEZONE,
      internalNotes: String(form.get("internalNotes")) || null,
      isActive: form.get("isActive") === "on"
    };

    setBusy(true);
    setMessageTone("neutral");
    setMessage(tenant ? "Saving tenant details…" : "Adding tenant…");
    try {
      const response = await fetch(
        tenant ? `/api/admin/tenants/${tenant.id}` : "/api/admin/tenants",
        {
          method: tenant ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            tenant
              ? { tenant: tenantPayload, expectedVersion: tenant.updatedAt }
              : tenantPayload
          )
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(readableSaveError(result));
      }
      const saved = result.data as Tenant;
      setTenant(saved);
      setMessageTone("success");
      setMessage(
        reminderSystem.paused || reminderSystem.forcePaused
          ? "Tenant saved. The next email was recalculated, but automatic sending remains paused."
          : "Tenant saved. The global reminder settings will be used for future emails."
      );
      if (!tenant) router.replace(`/admin/tenants/${saved.id}?saved=tenant`);
      else router.refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The tenant could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveTenant() {
    if (!tenant || !window.confirm("Archive this tenant and stop all future reminders?")) return;
    setBusy(true);
    setMessage("Archiving tenant…");
    setMessageTone("neutral");
    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: tenant.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(readableSaveError(result));
      setTenant(result.data);
      setMessageTone("success");
      setMessage("Tenant archived. Future reminders are stopped.");
      router.refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The tenant could not be archived.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page tenant-editor-page">
      <div className="prototype-breadcrumb">
        <Link href="/admin/tenants">Tenants</Link> / {tenant?.fullName ?? "New tenant"}
      </div>

      <div className="prototype-step-tabs" aria-label="Tenant editor">
        <span className="active">Tenant details</span>
      </div>

      <form className="admin-form tenant-prototype-form" onSubmit={saveTenant}>
        {sourceMarker?.sourceSystem && (
          <p className="source-marker">
            Added by {sourceMarker.sourceSystem === "openclaw" ? "OpenClaw Operations" : sourceMarker.sourceSystem}
            {sourceMarker.externalReference ? ` · ${sourceMarker.externalReference}` : ""}
          </p>
        )}

        <section className="prototype-form-card tenant-step-panel" aria-labelledby="tenant-details-heading">
          <h2 id="tenant-details-heading">Tenant details</h2>
          <p>
            Payment due date is the only tenant-specific reminder setting. The lead time,
            send time, and email template come from Reminder settings.
          </p>
          <div className="field-grid">
            <label className="field field-wide">
              <span>Name</span>
              <input name="fullName" required defaultValue={tenant?.fullName} autoComplete="name" />
            </label>
            <label className="field">
              <span>Property</span>
              <input name="propertyLabel" required defaultValue={tenant?.propertyLabel} />
            </label>
            <label className="field">
              <span>Unit</span>
              <input name="unitLabel" defaultValue={tenant?.unitLabel ?? ""} />
            </label>
            <label className="field">
              <span>Move-in date</span>
              <input
                name="moveInDate"
                type="date"
                required
                value={moveInDate}
                onChange={(event) => setMoveInDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Payment due date</span>
              <span className="input-with-suffix">
                <input
                  name="rentDueDay"
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={rentDueDay}
                  onChange={(event) => setRentDueDay(Number(event.target.value))}
                />
                <span>of every month</span>
              </span>
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phoneE164" type="tel" placeholder="+16045550123" defaultValue={tenant?.phoneE164 ?? ""} />
            </label>
            <label className="field field-wide">
              <span>Email</span>
              <input
                name="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
              <small>Active tenants with an allowed email use the global automatic reminder.</small>
            </label>
            <label className="field field-wide">
              <span>Notes</span>
              <textarea name="internalNotes" rows={4} defaultValue={tenant?.internalNotes ?? ""} />
            </label>
            <label className="check-field field-wide">
              <input name="isActive" type="checkbox" defaultChecked={tenant?.isActive ?? true} />
              This is a current tenant
            </label>
          </div>

          <div className="prototype-next-run neutral" aria-live="polite">
            {!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 31 ? (
              "Payment due date must be a whole number from 1 to 31."
            ) : nextRunPreview.error ? (
              nextRunPreview.error
            ) : nextRunPreview.nextRunAt && nextRunPreview.dueDate ? (
              <>
                Next automatic email: <strong>{new Date(nextRunPreview.nextRunAt).toLocaleString("en-CA", {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: nextRunPreview.timezone
                })}</strong>
                {" · "}Payment due: <strong>{formatRentDueDate(nextRunPreview.dueDate)}</strong>
              </>
            ) : (
              "The next automatic email will appear after a valid payment due date is entered."
            )}
          </div>

          {existingEmailBlock && (
            <p className="warning-callout">
              Email delivery is blocked by the tenant’s current {existingEmailBlock.replaceAll("_", " ")} status.
            </p>
          )}

          <div className="prototype-form-actions">
            <button className="button" disabled={busy} type="submit">Save tenant</button>
          </div>
        </section>

        {message && <div className={`save-result ${messageTone}`} aria-live="polite"><span>{message}</span></div>}
        {tenant && !tenant.archivedAt && (
          <button className="button danger-outline prototype-archive-action" disabled={busy} type="button" onClick={() => void archiveTenant()}>
            Archive tenant
          </button>
        )}
      </form>
    </div>
  );
}

function readableSaveError(result: {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ path?: Array<string | number> }>;
  };
}) {
  if (result.error?.code === "VALIDATION_ERROR") {
    const field = result.error.details?.[0]?.path?.at(-1);
    const fieldNames: Record<string, string> = {
      email: "email address",
      phoneE164: "phone number",
      moveInDate: "move-in date",
      rentDueDay: "payment due date"
    };
    return `Check the ${fieldNames[String(field)] ?? "tenant details"} and try again.`;
  }
  if (result.error?.code === "VERSION_CONFLICT") {
    return "This record changed in another tab. Refresh the page before saving again.";
  }
  if (result.error?.code === "DATABASE_ERROR") {
    return "The database could not save this change. Nothing after the last confirmed save was applied.";
  }
  return result.error?.message ?? "The tenant could not be saved.";
}
