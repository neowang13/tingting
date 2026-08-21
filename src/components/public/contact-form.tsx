"use client";

import { Mail, MessageCircle, Phone, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { buildContactActionUris } from "@/features/contact/follow-up";

interface Props {
  appearance?: "default" | "home-dark";
  idPrefix?: string;
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
  publicEmail: string;
  publicPhone: string;
  defaultMessage?: string;
}

export function ContactForm({
  appearance = "default",
  idPrefix = "contact",
  labels,
  options,
  submitLabel,
  successMessage,
  errorMessage,
  publicEmail,
  publicPhone,
  defaultMessage
}: Props) {
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const publicActions = buildContactActionUris({ email: publicEmail, phone: publicPhone });

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
    <form className={`contact-form${appearance === "home-dark" ? " contact-form-home-dark" : ""}`} onSubmit={submit} noValidate>
      <div className="contact-form-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-name`}>{labels.name} *</label>
          <input id={`${idPrefix}-name`} name="name" required autoComplete="name" placeholder="Full name" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-email`}>{labels.email}</label>
          <input id={`${idPrefix}-email`} name="email" type="email" autoComplete="email" placeholder="you@email.com" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-phone`}>{labels.phone}</label>
          <input id={`${idPrefix}-phone`} name="phone" type="tel" autoComplete="tel" placeholder="604-000-0000" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-preferred-contact`}>{labels.preferredContact}</label>
          <select id={`${idPrefix}-preferred-contact`} name="preferredContact" defaultValue={options[0].key}>
            {options.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-message`}>{labels.message} *</label>
        <textarea id={`${idPrefix}-message`} name="message" rows={5} required defaultValue={defaultMessage} placeholder="What do you need help with?" />
      </div>
      <div className="honeypot" aria-hidden="true">
        <label htmlFor={`${idPrefix}-website`}>Website</label>
        <input id={`${idPrefix}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button className="button contact-submit" disabled={busy} type="submit">
        {busy ? "Sending…" : submitLabel}
        <Send size={16} aria-hidden />
      </button>
      {status && (
        <div className={`form-status ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
          <p>{status.message}</p>
          {status.type === "success" && (
            <div className="contact-success-actions" aria-label="Contact Ting Ting directly">
              {publicActions.email && (
                <a href={publicActions.email}><Mail size={16} aria-hidden />Email Ting Ting</a>
              )}
              {publicActions.call && (
                <a href={publicActions.call}><Phone size={16} aria-hidden />Call Ting Ting</a>
              )}
              {publicActions.text && (
                <a href={publicActions.text}><MessageCircle size={16} aria-hidden />Text Ting Ting</a>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
