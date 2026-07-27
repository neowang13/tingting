"use client";

import { Send } from "lucide-react";
import { FormEvent, useState } from "react";

interface Props {
  labels: {
    name: string;
    email: string;
    phone: string;
    preferredContact: string;
    message: string;
  };
  options: readonly { key: "email" | "phone" | "sms"; label: string }[];
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
}

export function ContactForm({ labels, options, submitLabel, successMessage, errorMessage }: Props) {
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus(null);

    if (!formElement.reportValidity()) return;
    const data = new FormData(formElement);

    if (data.get("website")) {
      setStatus({ type: "success", message: successMessage });
      formElement.reset();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email") || undefined,
          phone: data.get("phone") || undefined,
          preferredContact: data.get("preferredContact"),
          message: data.get("message"),
          website: data.get("website")
        })
      });

      if (!response.ok) throw new Error("Request failed");
      setStatus({ type: "success", message: successMessage });
      formElement.reset();
    } catch {
      setStatus({ type: "error", message: errorMessage });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={submit} noValidate>
      <div className="contact-form-grid">
        <div className="field">
          <label htmlFor="contact-name">{labels.name} *</label>
          <input id="contact-name" name="name" required autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="contact-email">{labels.email}</label>
          <input id="contact-email" name="email" type="email" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="contact-phone">{labels.phone}</label>
          <input id="contact-phone" name="phone" type="tel" autoComplete="tel" />
        </div>
        <div className="field">
          <label htmlFor="preferred-contact">{labels.preferredContact}</label>
          <select id="preferred-contact" name="preferredContact" defaultValue={options[0].key}>
            {options.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="contact-message">{labels.message} *</label>
        <textarea id="contact-message" name="message" rows={5} required />
      </div>
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button className="button contact-submit" disabled={busy} type="submit">
        {busy ? "Sending…" : submitLabel}
        <Send size={16} aria-hidden />
      </button>
      {status && (
        <p className={`form-status ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
          {status.message}
        </p>
      )}
    </form>
  );
}
