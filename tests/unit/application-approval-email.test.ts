import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDraftSchema } from "@/features/applications/schemas";
import type { EmailProvider } from "@/features/notifications/providers/types";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { resendApplicationApproval, updateApplicationStatus } from "@/features/applications/service";

const id = "30000000-0000-4000-8000-000000000009";
const ownerId = "00000000-0000-4000-8000-000000000009";
const admin = { userId: "00000000-0000-4000-8000-000000000001", email: "admin@example.test", displayName: "Admin", authenticatedAt: new Date().toISOString(), assuranceLevel: "aal2" as const };

function database(status = "approved") {
  const row = {
    id, owner_user_id: ownerId, status, property_title: "Test home", property_address: "Test address",
    assigned_at: "2026-10-17T12:00:00Z", updated_at: "2026-10-17T13:00:00Z",
    draft_payload: applicationDraftSchema.parse({ personal: { legalFirstName: "Test", legalLastName: "Applicant", email: "different-contact@example.test" } }),
    application_form_versions: { version: "1", sha256: "form", legal_review_status: "approved" },
    application_terms_versions: { version: "1", sha256: "terms", legal_review_status: "approved" },
    application_applicants: [], client_application_files: [], client_application_lease_files: []
  };
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), update: vi.fn(), maybeSingle };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.update.mockReturnValue(query);
  const insert = vi.fn().mockResolvedValue({ error: null });
  const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: ownerId, email: "account@example.test", email_confirmed_at: "2026-10-16T12:00:00Z" } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: "2026-10-17T14:00:00Z", error: null });
  mocks.createClient.mockReturnValue({ from: vi.fn((table: string) => table === "client_applications" ? query : { insert }), rpc, auth: { admin: { getUserById } } });
  return { row, query, insert, getUserById };
}
function notifier() {
  const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ providerMessageId: "provider-approval", status: "queued" });
  return { send };
}

beforeEach(() => {
  vi.stubEnv("DATA_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("approval email delivery to the verified account", () => {
  it("uses the verified login address rather than the independently editable form email", async () => {
    const db = database("under_review"); const mail = notifier();
    const result = await updateApplicationStatus(admin, id, "approved", { notifier: mail });
    expect(db.getUserById).toHaveBeenCalledWith(ownerId);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: "account@example.test" }));
    expect(result.applicantNotification).toMatchObject({ status: "queued", recipientEmail: "account@example.test" });
    expect(db.row.draft_payload.personal.email).toBe("different-contact@example.test");
  });

  it("resends an already approved decision without changing its status or version", async () => {
    const db = database(); const mail = notifier(); const deliveryId = crypto.randomUUID();
    const result = await resendApplicationApproval(admin, id, deliveryId, { notifier: mail });
    expect(result.status).toBe("approved");
    expect(result.updatedAt).toBe(db.row.updated_at);
    expect(db.query.update).not.toHaveBeenCalled();
    expect(mail.send.mock.calls[0][0].idempotencyKey).toContain(deliveryId);
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "application.applicant_approval_notification_requested", actor_user_id: admin.userId }));
  });

  it("never falls back to the form address when account verification is missing or unavailable", async () => {
    const db = database(); const mail = notifier();
    db.getUserById.mockResolvedValue({ data: { user: { id: ownerId, email: "unverified@example.test", email_confirmed_at: "" } }, error: null });
    const result = await resendApplicationApproval(admin, id, crypto.randomUUID(), { notifier: mail });
    expect(result.applicantNotification).toMatchObject({ status: "failed", recipientEmail: null });
    expect(mail.send).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ request_context: { safeErrorCode: "APPLICATION_APPLICANT_EMAIL_UNVERIFIED" } }));
  });

  it("refuses to send approval messages for applications that have not been approved", async () => {
    database("submitted"); const mail = notifier();
    await expect(resendApplicationApproval(admin, id, crypto.randomUUID(), { notifier: mail }))
      .rejects.toMatchObject({ code: "APPLICATION_NOT_APPROVED" });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("binds delivery keys to the recipient and reuses each explicit retry ID", async () => {
    const db = database(); const mail = notifier(); const deliveryId = crypto.randomUUID();
    await resendApplicationApproval(admin, id, deliveryId, { notifier: mail });
    await resendApplicationApproval(admin, id, deliveryId, { notifier: mail });
    expect(mail.send.mock.calls[0][0].idempotencyKey).toBe(mail.send.mock.calls[1][0].idempotencyKey);
    db.getUserById.mockResolvedValue({ data: { user: { id: ownerId, email: "changed-account@example.test", email_confirmed_at: "2026-10-17T14:00:00Z" } }, error: null });
    await resendApplicationApproval(admin, id, deliveryId, { notifier: mail });
    expect(mail.send.mock.calls[2][0].idempotencyKey).not.toBe(mail.send.mock.calls[0][0].idempotencyKey);
  });
});
