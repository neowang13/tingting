"use client";

import { useState } from "react";
import type { TestContacts } from "@/lib/contracts";

export function ReminderSettings({
  initialPause,
  forcePaused,
  emailProviderMode,
  smsProviderMode,
  initialTestContacts
}: {
  initialPause: { paused: boolean; updatedAt: string };
  forcePaused: boolean;
  emailProviderMode: string;
  smsProviderMode: string;
  initialTestContacts: TestContacts;
}) {
  const [pause, setPause] = useState(initialPause);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testContacts, setTestContacts] = useState(initialTestContacts);

  async function changePause(paused: boolean) {
    const action = paused ? "pause all automatic reminders" : "resume automatic reminders";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings/reminders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused, expectedVersion: pause.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Settings could not be changed.");
      setPause(result.data);
      setMessage(paused ? "Automatic reminders are paused." : "Automatic reminders are active.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTestContacts(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings/test-contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email")) || null,
          phoneE164: String(data.get("phoneE164")) || null,
          expectedVersion: testContacts.updatedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Test contacts could not be saved.");
      setTestContacts(result.data);
      setMessage("Admin-owned test destinations saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test contacts could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-grid">
      <section className="card">
        <div className="admin-card-heading">
          <div><p className="eyebrow">AUTOMATION SAFETY</p><h2>Monthly reminders</h2></div>
          <span className={`status ${pause.paused ? "draft" : "published"}`}>{pause.paused ? "Paused" : "Active"}</span>
        </div>
        <p>Pausing stops scheduled reminders before occurrence creation and checks again immediately before delivery.</p>
        {forcePaused && <p className="warning-callout">The deployment force-pause is active. Reminders cannot send even if this setting is resumed.</p>}
        <button className={pause.paused ? "button" : "button danger-outline"} disabled={busy} type="button" onClick={() => void changePause(!pause.paused)}>
          {pause.paused ? "Resume automatic reminders" : "Pause automatic reminders"}
        </button>
        <p className="admin-save-status" aria-live="polite">{message}</p>
      </section>
      <section className="card">
        <p className="eyebrow">DELIVERY PROVIDERS</p>
        <h2>Connection status</h2>
        <p>Email: <strong>{emailProviderMode}</strong></p>
        <p>SMS: <strong>{smsProviderMode}</strong></p>
        <p>
          {emailProviderMode === "live" || smsProviderMode === "live"
            ? "At least one live delivery provider is enabled."
            : "No real email or SMS can be sent in these modes."}
        </p>
        <p>Credentials remain in managed environment settings and are never editable here.</p>
      </section>
      <section className="card">
        <p className="eyebrow">TEST DESTINATIONS</p>
        <h2>Launch dry run</h2>
        <p>Admin-owned test email and phone destinations must be configured before switching providers to live mode.</p>
        <form
          className="field-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTestContacts(event.currentTarget);
          }}
        >
          <label className="field"><span>Test email</span><input name="email" type="email" defaultValue={testContacts.email ?? ""} /></label>
          <label className="field"><span>Test phone (E.164)</span><input name="phoneE164" defaultValue={testContacts.phoneE164 ?? ""} /></label>
          <button className="button secondary" disabled={busy} type="submit">Save test destinations</button>
        </form>
      </section>
    </div>
  );
}
