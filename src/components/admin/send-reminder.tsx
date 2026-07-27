"use client";

import { FormEvent, useState } from "react";
import type {
  Channel,
  NotificationBatch,
  NotificationTemplate,
  Tenant
} from "@/lib/contracts";

interface Preview {
  selectedCount: number;
  eligibleCount: number;
  eligibleByChannel: { email: number; sms: number };
  skippedCount: number;
  smsSegmentEstimate: number;
  rows: Array<{
    tenantId: string;
    tenantName: string;
    channel: Channel;
    eligible: boolean;
    reason: string | null;
    destinationMasked: string | null;
  }>;
  samples?: Array<{ channel: Channel; subject: string | null; body: string }>;
}

interface TestPreview {
  requestId: string;
  previewToken: string;
  tenantId: string;
  channel: Channel;
  templateId: string;
  subject: string | null;
  body: string;
  smsSegments: number;
  destinationMasked: string;
  providerMode: string;
}

export function SendReminder({
  tenants,
  templates
}: {
  tenants: Tenant[];
  templates: NotificationTemplate[];
}) {
  const activeTenants = tenants.filter((tenant) => tenant.isActive && !tenant.archivedAt);
  const [selectionMode, setSelectionMode] = useState<"tenant_ids" | "all_active">("tenant_ids");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState<NotificationBatch | null>(null);
  const [acknowledged, setAcknowledged] = useState("");
  const [message, setMessage] = useState("Choose recipients, channels, and templates.");
  const [busy, setBusy] = useState(false);
  const [testPreview, setTestPreview] = useState<TestPreview | null>(null);

  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Rendering test preview…");
    try {
      const response = await fetch("/api/admin/notifications/test-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: String(form.get("tenantId")),
          channel: String(form.get("channel")),
          templateId: String(form.get("templateId")),
          requestId: crypto.randomUUID()
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Test preview could not be rendered.");
      setTestPreview(result.data);
      setMessage("Preview ready. Confirm the rendered content and administrator-owned destination.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test preview could not be rendered.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmTest() {
    if (!testPreview || busy) return;
    setBusy(true);
    setMessage("Queuing confirmed test event…");
    try {
      const response = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: testPreview.tenantId,
          channel: testPreview.channel,
          templateId: testPreview.templateId,
          requestId: testPreview.requestId,
          previewToken: testPreview.previewToken
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Test event could not be queued.");
      setMessage(`Confirmed test ${result.data.channel} event queued once for the administrator-owned destination.`);
      setTestPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test event could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channels = (["email", "sms"] as const).filter((channel) => form.get(channel));
    const payload = {
      selectionMode,
      tenantIds: selectionMode === "tenant_ids" ? selectedIds : [],
      channels,
      emailTemplateId: String(form.get("emailTemplateId")) || null,
      smsTemplateId: String(form.get("smsTemplateId")) || null,
      requestId: crypto.randomUUID()
    };
    setBusy(true);
    setMessage("Creating frozen preview…");
    try {
      const previewResponse = await fetch("/api/admin/notifications/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const previewResult = await previewResponse.json();
      if (!previewResponse.ok || !previewResult.success) {
        throw new Error(previewResult.error?.message ?? "Preview could not be created.");
      }
      const batchResponse = await fetch("/api/admin/notifications/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const batchResult = await batchResponse.json();
      if (!batchResponse.ok || !batchResult.success) {
        throw new Error(batchResult.error?.message ?? "Recipients could not be frozen.");
      }
      setPreview(previewResult.data);
      setBatch(batchResult.data);
      setAcknowledged("");
      setMessage("Preview created. Review every count before confirming.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBatch() {
    if (!batch || !preview) return;
    setBusy(true);
    setMessage("Confirming batch…");
    try {
      const response = await fetch(`/api/admin/notifications/batches/${batch.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmationIdempotencyKey: crypto.randomUUID(),
          acknowledgedRecipientCount: Number(acknowledged)
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Batch could not be confirmed.");
      setBatch(result.data);
      setMessage(`${preview.eligibleCount} eligible notification events were safely queued.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Batch could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-editor-stack">
      <form className="card admin-form" onSubmit={sendTest}>
        <div className="admin-card-heading">
          <div><p className="eyebrow">SAFE TEST</p><h2>Send to an admin-owned destination</h2></div>
          <span className="status draft">Never uses tenant contact details</span>
        </div>
        <div className="field-grid">
          <label className="field"><span>Sample tenant data</span>
            <select name="tenantId" required defaultValue="">
              <option value="">Select tenant context</option>
              {activeTenants.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.fullName}</option>)}
            </select>
          </label>
          <label className="field"><span>Channel</span>
            <select name="channel" required defaultValue="email">
              <option value="email">Email</option><option value="sms">SMS</option>
            </select>
          </label>
          <label className="field field-wide"><span>Template</span>
            <select name="templateId" required defaultValue="">
              <option value="">Select template</option>
              {templates.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.channel}</option>)}
            </select>
          </label>
        </div>
        <button className="button secondary" disabled={busy} type="submit">1. Preview safe test</button>
      </form>
      {testPreview && (
        <section className="card admin-form" aria-labelledby="test-preview-heading">
          <div className="admin-card-heading">
            <div><p className="eyebrow">CONFIRM SAFE TEST</p><h2 id="test-preview-heading">2. Review and queue</h2></div>
            <span className="status draft">{testPreview.providerMode} provider</span>
          </div>
          <p>Administrator-owned destination: <strong>{testPreview.destinationMasked}</strong>. Tenant contact details will not be used.</p>
          {testPreview.subject && <><strong>Subject</strong><p>{testPreview.subject}</p></>}
          <strong>Rendered body</strong><p className="message-sample">{testPreview.body}</p>
          {testPreview.channel === "sms" && <p>Estimated SMS segments: <strong>{testPreview.smsSegments}</strong></p>}
          <button className="button" disabled={busy} type="button" onClick={() => void confirmTest()}>
            3. Confirm and queue once
          </button>
        </section>
      )}
      <form className="card admin-form" onSubmit={createPreview}>
        <div className="admin-card-heading">
          <div><p className="eyebrow">SAFE SEND FLOW</p><h2>1. Select and preview</h2></div>
          <span className="status draft">No message sent yet</span>
        </div>
        <fieldset className="field-group">
          <legend>Recipients</legend>
          <label className="radio-field">
            <input type="radio" checked={selectionMode === "tenant_ids"} onChange={() => setSelectionMode("tenant_ids")} />
            Selected active tenants
          </label>
          <label className="radio-field">
            <input type="radio" checked={selectionMode === "all_active"} onChange={() => setSelectionMode("all_active")} />
            All eligible active tenants
          </label>
          {selectionMode === "tenant_ids" && (
            <div className="tenant-checklist">
              {activeTenants.map((tenant) => (
                <label className="check-field" key={tenant.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(tenant.id)}
                    onChange={(event) => setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, tenant.id]
                        : current.filter((id) => id !== tenant.id)
                    )}
                  />
                  <span><strong>{tenant.fullName}</strong><small>{tenant.propertyLabel} {tenant.unitLabel}</small></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="field-grid">
          <fieldset className="field-group field-wide">
            <legend>Requested channels</legend>
            <label className="check-field"><input name="email" type="checkbox" /> Email</label>
            <label className="check-field"><input name="sms" type="checkbox" /> SMS</label>
          </fieldset>
          <label className="field"><span>Email template</span>
            <select name="emailTemplateId" defaultValue="">
              <option value="">Select email template</option>
              {templates.filter((item) => item.channel === "email" && item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="field"><span>SMS template</span>
            <select name="smsTemplateId" defaultValue="">
              <option value="">Select SMS template</option>
              {templates.filter((item) => item.channel === "sms" && item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        <button className="button secondary" disabled={busy} type="submit">Create frozen preview</button>
      </form>

      {preview && batch && (
        <section className="card admin-form" aria-labelledby="send-confirm-heading">
          <div className="admin-card-heading">
            <div><p className="eyebrow">FROZEN FOR 30 MINUTES</p><h2 id="send-confirm-heading">2. Review and confirm</h2></div>
            <span className="status draft">{batch.status}</span>
          </div>
          <div className="metric-grid compact">
            <Metric label="Selected" value={preview.selectedCount} />
            <Metric label="Eligible events" value={preview.eligibleCount} />
            <Metric label="Email" value={preview.eligibleByChannel.email} />
            <Metric label="SMS" value={preview.eligibleByChannel.sms} />
            <Metric label="Skipped" value={preview.skippedCount} />
            <Metric label="SMS segments each" value={preview.smsSegmentEstimate} />
          </div>
          {preview.samples?.map((sample) => (
            <div className="message-sample" key={sample.channel}>
              <strong>{sample.channel.toUpperCase()} sample</strong>
              {sample.subject && <h3>{sample.subject}</h3>}
              <p>{sample.body}</p>
            </div>
          ))}
          {preview.rows.some((row) => !row.eligible) && (
            <details className="skipped-details">
              <summary>Review skipped recipients</summary>
              <ul>{preview.rows.filter((row) => !row.eligible).map((row) => (
                <li key={`${row.tenantId}-${row.channel}`}>
                  {row.tenantName} · {row.channel}: {row.reason}
                </li>
              ))}</ul>
            </details>
          )}
          <label className="field confirm-count">
            <span>Type the exact eligible event count ({preview.eligibleCount})</span>
            <input inputMode="numeric" value={acknowledged} onChange={(event) => setAcknowledged(event.target.value)} />
          </label>
          <button
            className="button"
            disabled={busy || batch.status !== "draft" || Number(acknowledged) !== preview.eligibleCount}
            type="button"
            onClick={() => void confirmBatch()}
          >
            Confirm and queue {preview.eligibleCount} events
          </button>
        </section>
      )}
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}
