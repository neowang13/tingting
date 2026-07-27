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
    <div className="admin-editor-stack">
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
      setMessage("Template saved as a new immutable revision.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card admin-form template-card" onSubmit={submit}>
      <div className="admin-card-heading">
        <div><p className="eyebrow">{template ? "MESSAGE TEMPLATE" : "NEW TEMPLATE"}</p><h2>{template?.name ?? "Create a template"}</h2></div>
        {template && <span className={`status ${template.isActive ? "published" : "draft"}`}>{template.isActive ? "Active" : "Inactive"}</span>}
      </div>
      <div className="template-layout">
        <div className="field-grid">
          <label className="field"><span>Name</span><input name="name" required defaultValue={template?.name} /></label>
          <label className="field"><span>Channel</span>
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
            <label className="field field-wide"><span>Subject</span><input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          )}
          <label className="field field-wide"><span>Message</span><textarea rows={7} required value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <label className="check-field field-wide"><input name="isActive" type="checkbox" defaultChecked={template?.isActive ?? false} /> Active and available for sending</label>
          <p className="field-help field-wide">
            Allowed variables: {"{{tenant_name}}"}, {"{{property}}"}, {"{{unit}}"}, {"{{due_date}}"}, {"{{business_name}}"}, {"{{business_phone}}"}, {"{{business_email}}"}
          </p>
        </div>
        <aside className="template-preview" aria-live="polite">
          <strong>Preview with sample data</strong>
          {preview.error ? <p className="form-status error">{preview.error}</p> : (
            <>
              {preview.subject && <h3>{preview.subject}</h3>}
              <p>{preview.body || "Start writing to see a preview."}</p>
              {channel === "sms" && <small>Estimated segments: {estimateSmsSegments(preview.body)}</small>}
            </>
          )}
        </aside>
      </div>
      <button className="button secondary" disabled={busy || Boolean(preview.error)} type="submit">
        {template ? "Save new revision" : "Create template"}
      </button>
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </form>
  );
}
