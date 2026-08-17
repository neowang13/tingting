import type { z } from "zod";
import type { showingRequestInputSchema } from "@/lib/schemas";
import { formatShowingSlot } from "@/features/showings/scheduling";
import { buildContactActionUris } from "@/features/contact/follow-up";
import { createShowingContactUrl } from "@/features/showings/contact-link";

type ShowingInput = z.infer<typeof showingRequestInputSchema>;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderShowingRequestNotification(input: {
  requestId: string;
  request: ShowingInput;
  property: { title: string; addressLine: string; city: string; slug: string };
  requestedStartAt: string;
  appBaseUrl?: string | null;
}) {
  const when = formatShowingSlot({
    requestedStartAt: input.requestedStartAt,
    timezone: input.request.timezone
  });
  const details = [
    "Status: REQUESTED — not yet confirmed",
    `Property: ${input.property.title}`,
    `Address: ${input.property.addressLine}, ${input.property.city}`,
    `Listing: /rentals/${input.property.slug}`,
    `Requested time: ${when}`,
    `Name: ${input.request.name}`,
    `Phone: ${input.request.phone}`,
    `Email: ${input.request.email}`,
    `Desired move-in: ${input.request.desiredMoveInDate}`,
    `Pets: ${input.request.hasPets ? "Yes" : "No"}`,
    `Parking required: ${input.request.needsParking ? "Yes" : "No"}`,
    `Request ID: ${input.requestId}`
  ];
  const notes = input.request.notes || "No additional notes.";
  const contactActions = buildContactActionUris({
    email: input.request.email,
    phone: input.request.phone
  });
  const contactPageUrl = createShowingContactUrl({
    appBaseUrl: input.appBaseUrl,
    phone: input.request.phone,
    requesterName: input.request.name,
    propertyTitle: input.property.title,
    requestedTime: when
  });
  const messageUri = contactPageUrl ?? contactActions.text;
  const textActions = [
    messageUri && `Contact requester: ${messageUri}`,
    contactActions.call && `Call requester: ${contactActions.call}`
  ].filter((value): value is string => Boolean(value));
  const htmlActions = [
    messageUri && `<a href="${escapeHtml(messageUri)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:8px;background:#087a32;color:#ffffff;text-decoration:none;font-weight:700;">Message or call requester</a>`,
    contactActions.call && `<a href="${escapeHtml(contactActions.call)}" style="display:inline-block;margin:0 0 8px;padding:12px 18px;border:1px solid #cfd8d2;border-radius:8px;background:#ffffff;color:#173c29;text-decoration:none;font-weight:700;">Call requester</a>`
  ].filter((value): value is string => Boolean(value));

  return {
    subject: `Showing requested: ${input.property.title}`,
    text: [
      ...details,
      "",
      "Additional notes",
      notes,
      "",
      "Contact the requester to accept or arrange another time.",
      ...textActions
    ].join("\n"),
    html: [
      `<p><strong>REQUESTED — not yet confirmed</strong></p>`,
      `<p>${details.slice(1).map(escapeHtml).join("<br>")}</p>`,
      `<p><strong>Additional notes</strong><br>${escapeHtml(notes).replaceAll("\n", "<br>")}</p>`,
      `<p>Contact the requester to accept or arrange another time.</p>`,
      htmlActions.length ? `<p>${htmlActions.join("")}</p>` : "",
      contactActions.call
        ? `<p style="color:#68736d;font-size:13px;">Direct phone number: <strong>${escapeHtml(contactActions.call.replace("tel:", ""))}</strong></p>`
        : ""
    ].join(""),
    actions: {
      message: messageUri,
      call: contactActions.call
    }
  };
}
