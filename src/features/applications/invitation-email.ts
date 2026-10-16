import { createClient } from "@supabase/supabase-js";
import { getRepository } from "@/data/repository";
import { ApiError } from "@/lib/api";
import { invitationBearerToken, hashGuestToken } from "@/lib/application-guest-auth";
import { createNotificationProviders, resolveEmailProviderMode } from "@/features/notifications/providers";
import type { EmailProvider } from "@/features/notifications/providers/types";

const memoryInvitations = new Map<string, { message: ReturnType<typeof invitationEmail>; active: () => boolean; onStatus: (status: "sent" | "failed") => void }>();
export function registerMemoryInvitationEmail(id: string, record: { message: ReturnType<typeof invitationEmail>; active: () => boolean; onStatus: (status: "sent" | "failed") => void }) { memoryInvitations.set(id, record); }
export function recordMemoryInvitationDelivery(id: string, status: "sent" | "failed") { memoryInvitations.get(id)?.onStatus(status); }

export function invitationEmail(input: { email: string; legalName: string; propertyTitle: string; token: string; invitationId?: string }) {
  const url = new URL(`/client/invitations${input.invitationId ? `?invitation=${input.invitationId}` : ""}#token=${encodeURIComponent(input.token)}`, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();
  const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return { to: input.email, subject: `Complete your rental application for ${input.propertyTitle}`,
    text: `Hello ${input.legalName},\n\nYou were invited to apply together for ${input.propertyTitle}. Sign in or register using this email address, verify it, and accept your invitation. Each applicant provides their own information and personally confirms any credit report they upload.\n\n${url}\n\nThis private invitation expires in 48 hours. If you were not expecting it, ignore this email.`,
    html: `<p>Hello ${escape(input.legalName)},</p><p>You were invited to apply together for ${escape(input.propertyTitle)}.</p><p>Sign in or register using this email address, verify it, and accept your invitation. Each applicant provides their own information and personally confirms any credit report they upload.</p><p><a href="${escape(url)}">Accept your invitation</a></p><p>This private invitation expires in 48 hours. If you were not expecting it, ignore this email.</p>` };
}

export async function prepareCoApplicantInvitationEmail(invitationId: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const record = memoryInvitations.get(invitationId);
    return record?.active() ? record.message : null;
  }
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const result = await service.from("application_applicant_invitations").select("id,applicant_id,status,expires_at,token_sha256").eq("id", invitationId).maybeSingle();
  if (result.error) throw new ApiError(503, "APPLICATION_INVITATION_LOAD_FAILED", "The invitation could not be loaded.");
  const invite = result.data;
  if (!invite || invite.status !== "active" || Date.parse(invite.expires_at) <= Date.now()) return null;
  const applicant = await service.from("application_applicants").select("email,legal_name,status,application_id").eq("id", invite.applicant_id).single();
  if (applicant.error) throw new ApiError(503, "APPLICATION_INVITATION_LOAD_FAILED", "The applicant could not be loaded.");
  if (["revoked", "signed"].includes(applicant.data.status)) return null;
  const application = await service.from("client_applications").select("property_title,status,deleted_at").eq("id", applicant.data.application_id).single();
  if (application.error) throw new ApiError(503, "APPLICATION_INVITATION_LOAD_FAILED", "The application could not be loaded.");
  if (application.data.deleted_at || application.data.status !== "draft") return null;
  const token = invitationBearerToken(invite.id);
  if (hashGuestToken(token) !== invite.token_sha256) throw new ApiError(503, "APPLICATION_INVITATION_KEY_CHANGED", "Send a new invitation.");
  return invitationEmail({ email: applicant.data.email, legalName: applicant.data.legal_name, propertyTitle: application.data.property_title, token, invitationId: invite.id });
}

export async function sendCoApplicantInvitationNow(input: { invitationId: string; applicationId: string; applicantId: string; email: string; notifier?: EmailProvider }) {
  const repository = getRepository();
  const notificationKey = `co-applicant-invite:${input.invitationId}`;
  // The database transaction already creates this outbox entry. This recovers its id.
  const id = await repository.enqueueOwnerNotification({ notificationKey, kind: "co_applicant_invitation", tenantId: null,
    payload: { invitationId: input.invitationId, applicationId: input.applicationId, applicantId: input.applicantId, recipient: input.email }, scheduledFor: new Date().toISOString() });
  try {
    if (!input.notifier && resolveEmailProviderMode() === "disabled") return "scheduled" as const;
    const message = await prepareCoApplicantInvitationEmail(input.invitationId);
    if (!message) return "scheduled" as const;
    const result = await (input.notifier ?? createNotificationProviders({ email: resolveEmailProviderMode(), sms: "disabled" }).email).send({ ...message, idempotencyKey: `owner-notification:${notificationKey}` });
    await repository.finishOwnerNotification(id, { status: "sent", providerMessageId: result.providerMessageId, safeErrorCode: null, nextAttemptAt: null });
    recordMemoryInvitationDelivery(input.invitationId, "sent");
    return "sent" as const;
  } catch (error) {
    await repository.finishOwnerNotification(id, { status: "failed", providerMessageId: null, safeErrorCode: error instanceof ApiError ? error.code : "APPLICATION_INVITATION_EMAIL_FAILED", nextAttemptAt: new Date(Date.now() + 60_000).toISOString() });
    recordMemoryInvitationDelivery(input.invitationId, "failed");
    return "failed" as const;
  }
}
