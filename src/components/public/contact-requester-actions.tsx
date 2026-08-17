"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle, Phone } from "lucide-react";

export function ContactRequesterActions({
  phone,
  requesterName,
  propertyTitle,
  requestedTime
}: {
  phone: string;
  requesterName: string;
  propertyTitle: string;
  requestedTime: string;
}) {
  const [copied, setCopied] = useState<"phone" | "message" | null>(null);
  const draft = `Hi ${requesterName}, this is Ting Ting regarding your showing request for ${propertyTitle} at ${requestedTime}.`;

  async function copy(value: string, type: "phone" | "message") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="contact-requester-actions">
      <a className="contact-requester-primary" href={`sms:${phone}`}>
        <MessageCircle aria-hidden />
        Open Messages
      </a>
      <a className="contact-requester-secondary" href={`tel:${phone}`}>
        <Phone aria-hidden />
        Call requester
      </a>
      <button type="button" onClick={() => void copy(phone, "phone")}>
        {copied === "phone" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied === "phone" ? "Number copied" : "Copy phone number"}
      </button>
      <button type="button" onClick={() => void copy(draft, "message")}>
        {copied === "message" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied === "message" ? "Message copied" : "Copy suggested message"}
      </button>
    </div>
  );
}
