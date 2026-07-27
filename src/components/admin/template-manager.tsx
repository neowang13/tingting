"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  estimateSmsSegments,
  renderTemplate,
  sampleTemplateContext
} from "@/features/notifications/template-renderer";
import type { NotificationTemplate } from "@/lib/contracts";

export function TemplateManager({ initialTemplates }: { initialTemplates: NotificationTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates);
  return (
    <div className="prototype-page email-templates-page">
      <TemplateForm
        template={null}
        onSaved={(template) => setTemplates((current) => [...current, template])}
      />
      {templates.map((template) => (
        <TemplateForm
          key={`${template.id}-${template.updatedAt}`}
          template={template}
          onSaved={(saved) => setTemplates((current) => current.map((item) => item.id === saved.id ? saved : item))}
        />
      ))}
    </div>
  );
}

function TemplateForm({
  template,
  onSaved
}: {
  template: NotificationTemplate | null;
  onSaved: (template: NotificationTemplate) => void;
}) {
  const [channel, setChannel] = useState<"email" | "sms">(template?.channel ?? "email");
  const [subject, setSubject] = useState(template?.subjectTemplate ?? "");
  const [body, setBody] = useState(template?.bodyTemplate ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    try {
      return {
        subject: subject ? renderTemplate(subject, sampleTemplateContext) : "",
        body: body ? renderTemplate(body, sampleTemplateContext) : "",
        error: null
      };
    } catch (error) {
      return { subject: "", body: "", error: error instanceof Error ? error.message : "Template is invalid." };
    }
  }, [body, subject]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name")),
      channel,
      subjectTemplate: channel === "email" ? subject : null,
      bodyTemplate: body,
      isActive: form.get("isActive") === "on"
    };
    setBusy(true);
    setMessage("Saving…");
    try {
      const response = await fetch(template ? `/api/admin/templates/${template.id}` : "/api/admin/templates", {
        method: template ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(template ? { template: payload, expectedVersion: template.updatedAt } : payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Template could not be saved.");
      onSaved(result.data);
      setMessage("Template saved. Tenant schedules can now use this latest version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const editor = (
    <>
      {!template && <h2>New template</h2>}
      <div className="template-layout">
        <div className="field-grid">
          <label className="field"><span>Template name</span><input name="name" required defaultValue={template?.name} placeholder="e.g. Monthly rent reminder" /></label>
          <label className="field"><span>Type</span>
            <select
              value={channel}
              disabled={Boolean(template)}
              onChange={(event) => {
                setChannel(event.target.value as "email" | "sms");
                if (event.target.value === "sms") setSubject("");
              }}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </label>
          {channel === "email" && (
            <label className="field field-wide"><span>Subject</span><input required value={subject} placeholder="Your rent is due soon" onChange={(event) => setSubject(event.target.value)} /></label>
          )}
          <label className="field field-wide"><span>Message</span><textarea rows={4} required value={body} placeholder={"Hi {{tenant_name}}, your rent of ... is due {{due_date}}."} onChange={(event) => setBody(event.target.value)} /></label>
          <p className="field-help field-wide">Variables: tenant_name, property, unit, due_date, business_name, business_phone, business_email</p>
          <label className="check-field field-wide"><input name="isActive" type="checkbox" defaultChecked={template?.isActive ?? false} /> Make available for rent reminders</label>
        </div>
        <aside className="template-preview" aria-live="polite">
          <strong>Live preview</strong>
          {preview.error ? <p className="form-status error">{preview.error}</p> : (
            <>
              {preview.subject && <h3>{preview.subject}</h3>}
              <p>{preview.body || "Fill in a subject and message to see a rendered preview using sample tenant data."}</p>
              {channel === "sms" && <small>Estimated segments: {estimateSmsSegments(preview.body)}</small>}
            </>
          )}
        </aside>
      </div>
      <div className="prototype-form-actions">
        <button className="button" disabled={busy || Boolean(preview.error)} type="submit">
          Save template
        </button>
      </div>
      {message && <p className="admin-save-status" aria-live="polite">{message}</p>}
    </>
  );

  if (template) {
    return (
      <details className="prototype-existing-template">
        <summary>
          <span><strong>{template.name}</strong><small>{channel === "email" ? "Email" : "SMS"} · Used by active reminder schedules</small></span>
          <span className={`prototype-status ${template.isActive ? "success" : "neutral"}`}>{template.isActive ? "Active" : "Inactive"}</span>
        </summary>
        <form className="admin-form prototype-existing-template-form" onSubmit={submit}>{editor}</form>
      </details>
    );
  }

  return <form className="prototype-form-card admin-form template-card" onSubmit={submit}>{editor}</form>;
}
