import type { z } from "zod";
import type { contactInputSchema } from "@/lib/schemas";

type ContactInput = z.infer<typeof contactInputSchema>;

export interface ContactActionUris {
  email: string | null;
  call: string | null;
  text: string | null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildMailtoUri(email: string | null | undefined) {
  const normalized = email?.trim();
  if (!normalized || /[\r\n]/.test(normalized)) return null;
  return `mailto:${encodeURIComponent(normalized).replaceAll("%40", "@")}`;
}

export function normalizeDialablePhone(phone: string | null | undefined) {
  const normalized = phone?.trim();
  if (!normalized || /[\r\n]/.test(normalized)) return null;

  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (normalized.startsWith("+") && digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length >= 7 && digits.length <= 15) return digits;
  return null;
}

export function buildContactActionUris(input: {
  email?: string | null;
  phone?: string | null;
}): ContactActionUris {
  const phone = normalizeDialablePhone(input.phone);
  return {
    email: buildMailtoUri(input.email),
    call: phone ? `tel:${phone}` : null,
    text: phone ? `sms:${phone}` : null
  };
}

export function renderContactNotification(input: ContactInput) {
  const actions = buildContactActionUris(input);
  const details = [
    `Name: ${input.name}`,
    `Preferred contact: ${input.preferredContact}`,
    `Email: ${input.email ?? "Not provided"}`,
    `Phone: ${input.phone ?? "Not provided"}`
  ];
  const textActions = [
    actions.email && `Email the enquirer: ${actions.email}`,
    actions.call && `Call the enquirer: ${actions.call}`,
    actions.text && `Text the enquirer: ${actions.text}`
  ].filter((value): value is string => Boolean(value));
  const htmlActions = [
    actions.email && `<a href="${escapeHtml(actions.email)}">Email the enquirer</a>`,
    actions.call && `<a href="${escapeHtml(actions.call)}">Call the enquirer</a>`,
    actions.text && `<a href="${escapeHtml(actions.text)}">Text the enquirer</a>`
  ].filter((value): value is string => Boolean(value));

  const text = [
    ...details,
    ...(textActions.length ? ["", "Follow up", ...textActions] : []),
    "",
    input.message
  ].join("\n");
  const html = [
    `<p>${details.map(escapeHtml).join("<br>")}</p>`,
    htmlActions.length
      ? `<p><strong>Follow up</strong><br>${htmlActions.join("<br>")}</p>`
      : "",
    `<p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>`
  ].join("");

  return { subject: "New website enquiry", text, html, actions };
}
