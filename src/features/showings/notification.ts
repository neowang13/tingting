import type { z } from "zod";
import type { showingRequestInputSchema } from "@/lib/schemas";
import { formatShowingSlot } from "@/features/showings/scheduling";

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

  return {
    subject: `Showing requested: ${input.property.title}`,
    text: [...details, "", "Additional notes", notes, "", "Contact the requester to accept or arrange another time."].join("\n"),
    html: `<p><strong>REQUESTED — not yet confirmed</strong></p><p>${details.slice(1).map(escapeHtml).join("<br>")}</p><p><strong>Additional notes</strong><br>${escapeHtml(notes).replaceAll("\n", "<br>")}</p><p>Contact the requester to accept or arrange another time.</p>`
  };
}
