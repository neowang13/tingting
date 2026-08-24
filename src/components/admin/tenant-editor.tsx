"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type {
  ReminderSchedule,
  Tenant,
  TenantRentPayment
} from "@/lib/contracts";

const DEFAULT_TIMEZONE = "America/Vancouver";

type SavedTenantResult = Tenant;

export function TenantEditor({
  initial,
  initialNotice
}: {
  initial: { tenant: Tenant; schedule: ReminderSchedule | null } | null;
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
  const [leaseType, setLeaseType] = useState<"" | "month_to_month" | "fixed_term">(
    initial?.tenant.leaseType ?? ""
  );
  const [leaseEndDate, setLeaseEndDate] = useState(initial?.tenant.leaseEndDate ?? "");
  const [rentDueDay, setRentDueDay] = useState(
    initial?.tenant.rentDueDay ?? initial?.schedule?.rentDueDay ?? 1
  );
  const existingEmailBlock = tenant &&
    !["allowed", "unconfirmed"].includes(tenant.emailContactStatus)
    ? tenant.emailContactStatus
    : null;

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailAddress = String(form.get("email")).trim() || null;
    const leaseEndDateValue = form.get("leaseEndDate");
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
      leaseType: String(form.get("leaseType")) || null,
      leaseEndDate: typeof leaseEndDateValue === "string" && leaseEndDateValue
        ? leaseEndDateValue
        : null,
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
      const saved = result.data as SavedTenantResult;
      setTenant(saved);
      setMessageTone("success");
      setMessage("Tenant saved.");
      if (!tenant) {
        router.replace(`/admin/tenants/${saved.id}?saved=success`);
      } else router.refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The tenant could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveTenant() {
    if (!tenant || !window.confirm("Archive this tenant? The record will remain available in tenant history.")) return;
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
      setMessage("Tenant archived.");
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

      {tenant && (
        <MonthlyRentCard
          tenant={tenant}
          leaseType={tenant.leaseType}
          archived={Boolean(tenant.archivedAt)}
        />
      )}

      <form className="admin-form tenant-prototype-form" onSubmit={saveTenant}>
        <section className="prototype-form-card tenant-step-panel" aria-labelledby="tenant-details-heading">
          <h2 id="tenant-details-heading">Tenant details</h2>
          <p>Keep the lease, contact details, payment due day, and internal notes current.</p>
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
              <span>Lease start date</span>
              <input
                name="moveInDate"
                type="date"
                required
                value={moveInDate}
                onChange={(event) => setMoveInDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Lease type</span>
              <select
                name="leaseType"
                required={!tenant}
                value={leaseType}
                onChange={(event) => {
                  const next = event.target.value as typeof leaseType;
                  if (
                    leaseType === "fixed_term"
                    && next === "month_to_month"
                    && leaseEndDate
                    && !window.confirm("Switch to month to month and clear the lease end date?")
                  ) return;
                  setLeaseType(next);
                  if (next !== "fixed_term") setLeaseEndDate("");
                }}
              >
                <option value="">Needs lease details</option>
                <option value="month_to_month">Month to month</option>
                <option value="fixed_term">Fixed contract</option>
              </select>
            </label>
            {leaseType === "fixed_term" && (
              <label className="field">
                <span>Lease end date</span>
                <input
                  name="leaseEndDate"
                  type="date"
                  required
                  min={moveInDate || undefined}
                  value={leaseEndDate}
                  onChange={(event) => setLeaseEndDate(event.target.value)}
                />
              </label>
            )}
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
              <small>Used only for direct tenant communication and account matching.</small>
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

          {(!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 31) && <p className="warning-callout">Payment due day must be a whole number from 1 to 31.</p>}

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
      leaseType: "lease type",
      leaseEndDate: "lease end date",
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

function currentMonthValue() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function MonthlyRentCard({
  tenant,
  leaseType,
  archived
}: {
  tenant: Tenant;
  leaseType: Tenant["leaseType"];
  archived: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentMonthValue);
  const [payment, setPayment] = useState<TenantRentPayment | null>(null);
  const [loadedPeriod, setLoadedPeriod] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leaseType || archived) return;
    const controller = new AbortController();
    void fetch(
      `/api/admin/rent-payments?tenantId=${encodeURIComponent(tenant.id)}&period=${encodeURIComponent(period)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error?.message);
        setPayment(result.data);
        setLoadedPeriod(period);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Rent status could not be loaded.");
      });
    return () => controller.abort();
  }, [archived, leaseType, period, tenant.id]);

  const visiblePayment = loadedPeriod === period ? payment : null;

  async function collect() {
    if (!file) {
      setError("Choose a PDF, JPG, PNG, or WEBP receipt first.");
      return;
    }
    const form = new FormData();
    form.set("tenantId", tenant.id);
    form.set("period", period);
    form.set("file", file);
    setBusy(true);
    setError("");
    setMessage("Saving the private receipt and rent status…");
    try {
      const response = await fetch("/api/admin/rent-payments", {
        method: "POST",
        body: form
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message);
      setPayment(result.data);
      setFile(null);
      setMessage(
        result.data.alreadyCollected
          ? `${monthLabel(period)} rent was already marked as collected. No duplicate record was created.`
          : `${monthLabel(period)} rent was marked as collected at ${new Date(result.data.collectedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      );
      router.refresh();
    } catch (cause) {
      setMessage("");
      setError(cause instanceof Error ? cause.message : "The rent status could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!visiblePayment || visiblePayment.status !== "collected") return;
    if (!window.confirm(`Mark ${monthLabel(period)} rent as due again? The receipt stays in the audit history.`)) {
      return;
    }
    const reason = window.prompt("Optional reason for this correction:") ?? "";
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/rent-payments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.id,
          period,
          expectedVersion: visiblePayment.updatedAt,
          reason
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message);
      setPayment(result.data);
      setMessage(`${monthLabel(period)} rent is due again. The previous receipt remains in the audit history.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rent status could not be corrected.");
    } finally {
      setBusy(false);
    }
  }

  async function viewReceipt() {
    if (!visiblePayment?.receiptId) return;
    setError("");
    const response = await fetch(`/api/admin/rent-payment-receipts/${visiblePayment.receiptId}`);
    const result = await response.json();
    if (!response.ok || !result.success) {
      setError(result.error?.message ?? "The secure receipt link could not be created.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="prototype-form-card tenant-step-panel monthly-rent-card" aria-labelledby="monthly-rent-heading">
      <div className="monthly-rent-heading">
        <div>
          <h2 id="monthly-rent-heading">Monthly rent</h2>
          <p>Choose a month to see whether this tenant has paid. Every collected month requires a private receipt.</p>
        </div>
        <label className="field compact-field">
          <span>Rent month</span>
          <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
        </label>
      </div>
      {!leaseType ? (
        <p className="warning-callout">Complete the lease type and start date before recording monthly rent.</p>
      ) : archived ? (
        <p className="neutral-callout">Archived tenants do not have a current collection action.</p>
      ) : !visiblePayment ? (
        <p>{error || "Loading rent status…"}</p>
      ) : (
        <>
          <div className="rent-status-grid">
            <div><span>Month</span><strong>{monthLabel(period)}</strong></div>
            <div><span>Due date</span><strong>{new Date(`${visiblePayment.dueDate}T12:00:00`).toLocaleDateString("en-CA", { dateStyle: "long" })}</strong></div>
            <div>
              <span>Status</span>
              <strong className={`prototype-status ${visiblePayment.status === "collected" ? "success" : "waiting"}`}>
                {visiblePayment.status === "collected" ? "Paid · receipt recorded" : "Not received"}
              </strong>
            </div>
          </div>
          {visiblePayment.status === "due" ? (
            <div className="receipt-action">
              <label className="field field-wide">
                <span>Payment receipt</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <small>Private PDF, JPG, PNG, or WEBP. Maximum 10 MB.</small>
              </label>
              <button className="button" type="button" disabled={busy || !file} onClick={() => void collect()}>
                Save receipt and mark {monthLabel(period)} rent as collected
              </button>
            </div>
          ) : (
            <div className="collected-rent-result">
              <p>
                Receipt recorded · {visiblePayment.collectedAt
                  ? new Date(visiblePayment.collectedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
                  : "time unavailable"}
              </p>
              <div className="inline-actions">
                <button className="button secondary" type="button" onClick={() => void viewReceipt()}>View receipt securely</button>
                <button className="button danger-outline" type="button" disabled={busy} onClick={() => void reopen()}>Mark as due again</button>
              </div>
            </div>
          )}
        </>
      )}
      {message && <p className="save-result success" aria-live="polite">{message}</p>}
      {error && <p className="save-result error" role="alert">{error}</p>}
    </section>
  );
}

function monthLabel(period: string) {
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric"
  });
}
