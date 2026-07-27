"use client";

import { FormEvent, useState } from "react";
import type {
  NotificationTemplate,
  ReminderSettings as ReminderSettingsContract,
  Tenant,
  TestContacts
} from "@/lib/contracts";
import { formatRentDueDate } from "@/features/reminders/due-date";
import { deliveryModeCopy } from "@/lib/notification-copy";

interface TestPreview {
  requestId: string;
  previewToken: string;
  tenantId: string;
  templateId: string;
  dueDate: string;
  subject: string | null;
  body: string;
  destinationMasked: string;
}

export function ReminderSettings({
  initialSettings,
  forcePaused,
  emailProviderMode,
  initialTestContacts,
  tenants,
  templates
}: {
  initialSettings: ReminderSettingsContract;
  forcePaused: boolean;
  emailProviderMode: string;
  initialTestContacts: TestContacts;
  tenants: Tenant[];
  templates: NotificationTemplate[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [leadDays, setLeadDays] = useState(initialSettings.leadDays);
  const [localTime, setLocalTime] = useState(initialSettings.localTime);
  const [emailTemplateId, setEmailTemplateId] = useState(initialSettings.emailTemplateId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const [testContacts, setTestContacts] = useState(initialTestContacts);
  const [testPreview, setTestPreview] = useState<TestPreview | null>(null);
  const emailMode = deliveryModeCopy(emailProviderMode);
  const effectivePaused = settings.paused || forcePaused;
  const activeTenants = tenants.filter((tenant) => tenant.isActive && !tenant.archivedAt);
  const emailTemplates = templates.filter(
    (template) => template.channel === "email" && template.isActive
  );

  async function persistSettings(nextPaused: boolean) {
    const response = await fetch("/api/admin/settings/reminders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paused: nextPaused,
        leadDays,
        localTime,
        timezone: "America/Vancouver",
        emailTemplateId,
        expectedVersion: settings.updatedAt
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error?.message ?? "Reminder settings could not be saved.");
    }
    setSettings(result.data);
    setTestPreview(null);
    return result.data as ReminderSettingsContract;
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailTemplateId) {
      setMessageTone("error");
      setMessage("Choose an active email template.");
      return;
    }
    const selectedTime = new Date(`2026-01-01T${localTime}:00`).toLocaleTimeString("en-CA", {
      hour: "numeric",
      minute: "2-digit"
    });
    if (!window.confirm(
      `Change reminder settings for ${activeTenants.length} active tenants?\n\n` +
      `Future reminder dates will be recalculated to ${leadDays} days before payment is due at ${selectedTime}. ` +
      "Emails that are already due will not be skipped. Saving does not send an email."
    )) return;

    setBusy(true);
    setMessageTone("neutral");
    setMessage("Saving reminder settings…");
    try {
      const saved = await persistSettings(settings.paused);
      setMessageTone("success");
      setMessage(
        `Reminder settings saved. ${saved.recalculatedTenants ?? 0} future reminders were recalculated` +
        ` and ${saved.preservedDueTenants ?? 0} already-due reminders were preserved. No email was sent.`
      );
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Reminder settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function changePause(paused: boolean) {
    const action = paused ? "pause all automatic rent reminder emails" : "resume automatic rent reminder emails";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;
    setBusy(true);
    setMessageTone("neutral");
    try {
      await persistSettings(paused);
      setMessageTone("success");
      setMessage(paused
        ? "Automatic reminder emails are paused. Existing reminder dates were kept."
        : forcePaused
          ? "The admin pause is off, but the deployment-level pause still blocks sending."
          : "Automatic reminder emails are active."
      );
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Reminder settings could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessageTone("neutral");
    setMessage("Saving the test email destination…");
    try {
      const response = await fetch("/api/admin/settings/test-contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email")).trim() || null,
          phoneE164: testContacts.phoneE164,
          expectedVersion: testContacts.updatedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "The test email could not be saved.");
      setTestContacts(result.data);
      setTestPreview(null);
      setMessageTone("success");
      setMessage("Test email destination saved.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The test email could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function previewTestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessageTone("neutral");
    setMessage("Preparing the test email preview…");
    try {
      const response = await fetch("/api/admin/notifications/test-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: String(form.get("tenantId")),
          channel: "email",
          templateId: emailTemplateId,
          leadDays,
          localTime,
          timezone: "America/Vancouver",
          requestId: crypto.randomUUID()
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(readableTestError(result));
      setTestPreview(result.data);
      setMessageTone("neutral");
      setMessage("Test preview ready. Nothing has been sent.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The test preview could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    if (!testPreview || busy) return;
    setBusy(true);
    setMessageTone("neutral");
    setMessage("Sending the test email…");
    try {
      const response = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: testPreview.tenantId,
          channel: "email",
          templateId: testPreview.templateId,
          requestId: testPreview.requestId,
          previewToken: testPreview.previewToken
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(readableTestError(result));
      setMessageTone("success");
      setMessage(
        emailProviderMode === "live"
          ? "Test email requested. Check Email activity for the final delivery result."
          : "Test-mode email recorded. No real email was sent."
      );
      setTestPreview(null);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "The test email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page reminder-settings-page">
      <section className="prototype-form-card admin-form" aria-labelledby="automatic-email-heading">
        <h2 id="automatic-email-heading">Automatic monthly emails</h2>
        <strong className={`prototype-status ${effectivePaused ? "waiting" : "success"}`}>
          {effectivePaused ? "Sending paused" : "Ready to run"}
        </strong>
        <p>
          One global schedule applies to every current tenant whose email is allowed.
          Payment due date remains on each tenant record.
        </p>
        {forcePaused && (
          <p className="prototype-attention">
            A deployment-level pause is on. It must be removed from the hosting environment before any real automatic email can send.
          </p>
        )}

        <form className="prototype-form-stack" onSubmit={saveSettings}>
          <h3>Reminder schedule</h3>
          <label className="field">
            <span>Send rent reminders this many days before payment is due</span>
            <input
              name="leadDays"
              type="number"
              min={0}
              max={31}
              required
              value={leadDays}
              onChange={(event) => setLeadDays(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Send at</span>
            <input
              name="localTime"
              type="time"
              required
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
            />
            <small>America/Vancouver local time</small>
          </label>
          <label className="field">
            <span>Email template</span>
            <select
              name="emailTemplateId"
              required
              value={emailTemplateId}
              onChange={(event) => setEmailTemplateId(event.target.value)}
            >
              <option value="">Choose an active email template</option>
              {emailTemplates.map((template) => (
                <option value={template.id} key={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <p className="field-help">
            Example: rent due on August 1 → email planned for July 29 when lead days is 3.
          </p>
          <div className="prototype-split-actions">
            <button className="button" disabled={busy} type="submit">Save reminder settings</button>
            <button className="button secondary" disabled={busy} type="button" onClick={() => void changePause(!settings.paused)}>
              {settings.paused ? "Turn automatic emails on" : "Pause all automatic emails"}
            </button>
          </div>
        </form>
      </section>

      <section className="prototype-form-card">
        <h2>Email delivery</h2>
        <div className="prototype-status-list">
          <div>
            <span>Email</span>
            <strong className={`prototype-status ${emailMode.tone}`}>{providerModeLabel(emailProviderMode)}</strong>
          </div>
        </div>
      </section>

      <section className="prototype-form-card admin-form" aria-labelledby="test-email-heading">
        <h2 id="test-email-heading">Send a test email</h2>
        <p>
          The preview uses the schedule and email template currently selected above,
          even before you save them. It only goes to the admin email.
        </p>

        <form className="prototype-form-stack" onSubmit={saveTestEmail}>
          <label className="field">
            <span>Admin test email</span>
            <input name="email" type="email" required defaultValue={testContacts.email ?? ""} />
          </label>
          <div><button className="button secondary" disabled={busy} type="submit">Save test email</button></div>
        </form>

        <form className="prototype-form-stack" onSubmit={previewTestEmail}>
          <label className="field">
            <span>Use sample details from</span>
            <select name="tenantId" required defaultValue="">
              <option value="">Choose a tenant</option>
              {activeTenants.map((tenant) => (
                <option value={tenant.id} key={tenant.id}>{tenant.fullName}</option>
              ))}
            </select>
          </label>
          <p>Template: <strong>{emailTemplates.find((template) => template.id === emailTemplateId)?.name ?? "Choose one above"}</strong></p>
          <div>
            <button
              className="button"
              disabled={busy || !testContacts.email || !activeTenants.length || !emailTemplateId}
              type="submit"
            >
              Preview test email
            </button>
          </div>
        </form>

        {testPreview && (
          <div className="test-email-preview" aria-labelledby="test-preview-heading">
            <h3 id="test-preview-heading">Test email preview</h3>
            <p>Will go to: <strong>{testPreview.destinationMasked}</strong></p>
            <p>Payment due: <strong>{formatRentDueDate(testPreview.dueDate)}</strong></p>
            {testPreview.subject && <><strong>Subject</strong><p>{testPreview.subject}</p></>}
            <strong>Message</strong>
            <p className="message-sample">{testPreview.body}</p>
            <button className="button" disabled={busy} type="button" onClick={() => void sendTestEmail()}>
              Send test email to {testPreview.destinationMasked}
            </button>
          </div>
        )}
      </section>

      {message && (
        <div className={`save-result ${messageTone}`} aria-live="polite">
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

function providerModeLabel(mode: string) {
  return {
    live: "Live — can send",
    mock: "Test mode — records only",
    disabled: "Off — cannot send"
  }[mode] ?? mode;
}

function readableTestError(result: { error?: { code?: string; message?: string } }) {
  if (
    result.error?.code === "TEST_DESTINATION_MISSING" ||
    result.error?.code === "TEST_DESTINATION_NOT_CONFIGURED"
  ) {
    return "Save the admin test email before sending a test.";
  }
  if (result.error?.code === "DATABASE_ERROR") {
    return "The database could not save this request. No test email was confirmed.";
  }
  return result.error?.message ?? "The test email request could not be completed.";
}
